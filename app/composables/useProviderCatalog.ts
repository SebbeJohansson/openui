import { computed, ref, watch } from 'vue';
import type { MessageTokens } from '~/types/message';
import type {
  AgentInfo,
  AgentOption,
  CommandInfo,
  ModelOption,
  ProviderInfo,
  ProviderResponse,
} from '~/types/provider';
import { describeLoadError } from '~/utils/loadError';
import * as opencodeApi from '~/utils/opencode';
import { opencodeTheme, resolveAgentColor, resolveTheme } from '~/utils/opencodeTheme';
import { useAgentModelMemory } from './useAgentModelMemory';
import { defineFeature } from './useAppContext';
import { useHiddenModels } from './useHiddenModels';

export function buildThinkingOptions(variants?: Record<string, unknown>) {
  const keys = Object.keys(variants ?? {}).sort();
  return [undefined, ...keys] as Array<string | undefined>;
}

export function buildProviderModelKey(providerID?: string, modelID?: string) {
  const normalizedProvider = providerID?.trim() ?? '';
  const normalizedModel = modelID?.trim() ?? '';
  if (!normalizedProvider || !normalizedModel) return '';
  return `${normalizedProvider}/${normalizedModel}`;
}

export function parseProviderModelKey(value: string) {
  const normalized = value.trim();
  const slashIndex = normalized.indexOf('/');
  if (slashIndex <= 0 || slashIndex >= normalized.length - 1) {
    return { providerID: '', modelID: '' };
  }
  const providerID = normalized.slice(0, slashIndex).trim();
  const modelID = normalized.slice(slashIndex + 1).trim();
  if (!providerID || !modelID) return { providerID: '', modelID: '' };
  return { providerID, modelID };
}

function sameList<T>(a: T[], b: T[]) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Provider/model/agent/command catalogs fetched from OpenCode, plus the current
 * agent/model/variant selection and the rules that keep it valid when the
 * catalogs or the hidden-model list change.
 */
export const useProviderCatalog = defineFeature('providerCatalog', (context) => {
  const { hiddenModels, isHidden: isModelHidden } = useHiddenModels();
  const { recall: recallAgentModel } = useAgentModelMemory();
  const { rememberModelPerAgent } = context.settings;

  const providers = ref<ProviderInfo[]>([]);
  const agents = ref<AgentInfo[]>([]);
  const commands = ref<CommandInfo[]>([]);
  const allModelOptions = ref<ModelOption[]>([]);
  const modelOptions = computed(() => allModelOptions.value.filter((m) => !isModelHidden(m.id)));
  const agentOptions = ref<AgentOption[]>([]);
  const thinkingOptions = ref<Array<string | undefined>>([]);
  const providersLoaded = ref(false);
  const providersLoading = ref(false);
  const agentsLoading = ref(false);
  const commandsLoading = ref(false);
  let commandsRequestId = 0;
  /** Non-empty when the last provider/model catalog fetch failed. */
  const providersError = ref('');
  /** Non-empty when the last agent list fetch failed. */
  const agentsError = ref('');

  // Current composer selection.
  const selectedMode = ref('build');
  const selectedModel = ref('');
  const selectedThinking = ref<string | undefined>(undefined);

  const hasAgentOptions = computed(() => agentOptions.value.length > 0);
  const hasModelOptions = computed(() => modelOptions.value.length > 0);
  const hasThinkingOptions = computed(() => thinkingOptions.value.length > 0);

  const canAttach = computed(() => {
    const selected =
      modelOptions.value.find((m) => m.id === selectedModel.value) ??
      allModelOptions.value.find((m) => m.id === selectedModel.value);
    return selected?.attachmentCapable !== false;
  });

  const commandOptions = computed(() => {
    const list = commands.value.slice();
    if (!list.some((command) => command.name.toLowerCase() === 'shell')) {
      list.push({ name: 'shell', description: 'Open a local shell session.', source: 'local' });
    }
    if (!list.some((command) => command.name.toLowerCase() === 'debug')) {
      list.push({
        name: 'debug',
        description: 'Debug utilities. Use /debug help for subcommands.',
        source: 'local',
      });
    }
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  });

  const resolvedTheme = computed(() => resolveTheme(opencodeTheme, 'dark'));
  const visibleAgents = computed(() => agents.value.filter((a) => !a.hidden));

  function resolveAgentColorForName(agentName?: string) {
    const agent = agentName ? agents.value.find((a) => a.name === agentName) : undefined;
    return resolveAgentColor(
      agentName ?? '',
      agent?.color,
      visibleAgents.value,
      resolvedTheme.value,
    );
  }

  function resolveModelMetaForPath(modelPath?: string) {
    if (!modelPath) return undefined;
    const matched = modelOptions.value.find((model) => model.id === modelPath);
    if (!matched) return undefined;
    return { displayName: matched.displayName, providerLabel: matched.providerLabel };
  }

  const currentAgentColor = computed(() => resolveAgentColorForName(selectedMode.value));

  function syncThinkingOptions(variants: Record<string, unknown> | undefined) {
    const next = buildThinkingOptions(variants);
    if (!sameList(next, thinkingOptions.value)) thinkingOptions.value = next;
    return next;
  }

  function applyModelVariantSelection(
    model: string | undefined,
    variant: string | undefined,
    allowHidden = false,
  ) {
    if (modelOptions.value.length === 0) {
      if (model) selectedModel.value = model;
      selectedThinking.value = variant;
      return;
    }
    // When allowHidden is true, also accept models from allModelOptions (hidden models)
    const lookupOptions = allowHidden ? allModelOptions.value : modelOptions.value;
    if (model && lookupOptions.some((option) => option.id === model)) {
      selectedModel.value = model;
    }
    if (!selectedModel.value && modelOptions.value.length > 0) {
      selectedModel.value = modelOptions.value[0]?.id ?? '';
    }
    const selectedInfo = allModelOptions.value.find((option) => option.id === selectedModel.value);
    const next = syncThinkingOptions(selectedInfo?.variants);
    selectedThinking.value = next.includes(variant) ? variant : next[0];
  }

  /** Apply an agent's recommended model + variant when the catalog knows it. */
  function applyAgentDefaults(agentName: string) {
    const agent = agents.value.find((a) => a.name === agentName);
    const defaultModel = agent?.model;
    if (!defaultModel?.providerID || !defaultModel?.modelID) return;
    const match = modelOptions.value.find(
      (m) => m.modelID === defaultModel.modelID && m.providerID === defaultModel.providerID,
    );
    if (match) applyModelVariantSelection(match.id, agent?.variant);
  }

  function resolveDefaultAgentModel(): {
    agent: string;
    model: string;
    variant: string | undefined;
  } {
    // Prefer 'build' if it exists, otherwise the first available agent
    const defaultAgent =
      agentOptions.value.find((o) => o.id === 'build')?.id ?? agentOptions.value[0]?.id ?? '';
    selectedMode.value = defaultAgent;
    applyAgentDefaults(defaultAgent);
    if (!selectedModel.value && modelOptions.value.length > 0) {
      selectedModel.value = modelOptions.value[0]?.id || '';
    }
    return {
      agent: selectedMode.value,
      model: selectedModel.value,
      variant: selectedThinking.value,
    };
  }

  async function fetchProviders(force = false) {
    if (providersLoading.value || (!force && providersLoaded.value)) return;
    providersLoading.value = true;
    providersError.value = '';
    try {
      const data = (await opencodeApi.listProviders()) as ProviderResponse;
      providers.value = Array.isArray(data.providers) ? data.providers : [];
      const models: ModelOption[] = [];
      providers.value.forEach((provider) => {
        Object.values(provider.models ?? {}).forEach((model) => {
          const providerID = model.providerID?.trim() || provider.id?.trim() || 'unknown';
          const providerLabel = provider.name?.trim() || providerID;
          const modelDisplayName = model.name?.trim() || model.id;
          const id = buildProviderModelKey(providerID, model.id);
          if (!id) return;
          models.push({
            id,
            modelID: model.id,
            label: `${modelDisplayName} [${providerID}/${model.id}]`,
            displayName: modelDisplayName,
            providerID,
            providerLabel,
            variants: model.variants,
            attachmentCapable: model.capabilities?.attachment !== false,
          });
        });
      });
      models.sort((a, b) => {
        const providerCompare = (a.providerLabel ?? a.providerID ?? 'unknown').localeCompare(
          b.providerLabel ?? b.providerID ?? 'unknown',
        );
        return providerCompare !== 0 ? providerCompare : a.label.localeCompare(b.label);
      });
      const sameModels =
        models.length === allModelOptions.value.length &&
        models.every((model, index) => model.id === allModelOptions.value[index]?.id);
      if (!sameModels) allModelOptions.value = models;

      if (!selectedModel.value) {
        const preferredModelId = Object.entries(data.default ?? {})
          .map(([providerID, modelID]) => buildProviderModelKey(providerID, modelID))
          .find((value) => Boolean(value));
        selectedModel.value = preferredModelId || modelOptions.value[0]?.id || '';
      }
      const selectedInfo = modelOptions.value.find((model) => model.id === selectedModel.value);
      const next = syncThinkingOptions(selectedInfo?.variants);
      if (selectedThinking.value === undefined || !next.includes(selectedThinking.value)) {
        selectedThinking.value = thinkingOptions.value[0];
      }
      providersLoaded.value = true;
      if (models.length === 0) {
        // The request succeeded but the server exposes no usable models, which
        // otherwise leaves the picker stuck on "Loading..." with no explanation.
        providersError.value =
          'No models available. Check that a provider is authenticated (`opencode auth login`).';
      }
    } catch (error) {
      providersError.value = describeLoadError(error);
    } finally {
      providersLoading.value = false;
    }
  }

  async function fetchAgents() {
    if (agentsLoading.value) return;
    agentsLoading.value = true;
    agentsError.value = '';
    try {
      const data = (await opencodeApi.listAgents()) as AgentInfo[];
      agents.value = Array.isArray(data) ? data : [];
      const options: AgentOption[] = agents.value
        .filter((agent) => agent.mode === 'primary' || agent.mode === 'all')
        .filter((agent) => !agent.hidden)
        .map((agent) => ({
          id: agent.name,
          label: agent.name
            ? `${agent.name.charAt(0).toUpperCase()}${agent.name.slice(1)}`
            : agent.name,
          description: agent.description,
          color: agent.color,
        }));
      agentOptions.value = options;
      if (!selectedMode.value || !options.some((option) => option.id === selectedMode.value)) {
        const preferred = options.find((option) => option.id === 'build')?.id ?? options[0]?.id;
        if (preferred) {
          selectedMode.value = preferred;
          // Apply the recommended model+variant for the initially selected agent
          // (a restored composer draft may override this afterwards).
          applyAgentDefaults(preferred);
        }
      }
    } catch (error) {
      agentsError.value = describeLoadError(error);
    } finally {
      agentsLoading.value = false;
    }
  }

  /**
   * Last write wins. A blanket in-flight guard here used to drop the reload
   * that follows a worktree change, leaving the previous directory's commands
   * in place, so a newer request supersedes an older one instead.
   */
  async function fetchCommands(directory?: string) {
    const requestId = ++commandsRequestId;
    commandsLoading.value = true;
    try {
      const data = (await opencodeApi.listCommands(directory)) as CommandInfo[];
      if (requestId !== commandsRequestId) return;
      const list = Array.isArray(data) ? data : [];
      list.sort((a, b) => a.name.localeCompare(b.name));
      commands.value = list;
    } catch {
      // A missing command list only degrades slash-command completion.
    } finally {
      if (requestId === commandsRequestId) commandsLoading.value = false;
    }
  }

  function resolveProviderModelLimit(providerId?: string, modelId?: string) {
    const normalizedProvider = providerId?.trim() ?? '';
    const normalizedModel = modelId?.trim() ?? '';
    if (!normalizedProvider || !normalizedModel) return null;
    const provider = providers.value.find((item) => item.id === normalizedProvider);
    const model = provider?.models?.[normalizedModel];
    return model?.limit ?? null;
  }

  function computeContextPercent(tokens: MessageTokens, providerId?: string, modelId?: string) {
    const contextLimit = resolveProviderModelLimit(providerId, modelId)?.context;
    if (!contextLimit || !Number.isFinite(contextLimit) || contextLimit <= 0) return null;
    const total =
      tokens.input + tokens.output + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0);
    if (!Number.isFinite(total) || total <= 0) return 0;
    return Math.round((total / contextLimit) * 100);
  }

  // Auto-switch away from the selected model if it gets hidden
  // (but keep it if it was set via per-agent model memory).
  watch(hiddenModels, () => {
    if (selectedModel.value && isModelHidden(selectedModel.value)) {
      if (rememberModelPerAgent.value) {
        const remembered = recallAgentModel(selectedMode.value);
        if (remembered?.model === selectedModel.value) return;
      }
      const first = modelOptions.value[0]?.id;
      if (first) selectedModel.value = first;
    }
  });

  watch(selectedModel, () => {
    // During bootstrap, modelOptions may not be loaded yet; fetchProviders normalizes later.
    if (modelOptions.value.length === 0) return;
    const selectedInfo =
      modelOptions.value.find((model) => model.id === selectedModel.value) ??
      allModelOptions.value.find((model) => model.id === selectedModel.value);
    const next = syncThinkingOptions(selectedInfo?.variants);
    if (selectedThinking.value === undefined || !next.includes(selectedThinking.value)) {
      selectedThinking.value = next[0];
    }
  });

  context.modelNameResolver.value = (providerID, modelID) =>
    modelOptions.value.find((m) => m.id === `${providerID}/${modelID}`)?.displayName;

  return {
    providers,
    agents,
    commands,
    allModelOptions,
    modelOptions,
    agentOptions,
    thinkingOptions,
    providersLoading,
    agentsLoading,
    commandsLoading,
    providersError,
    agentsError,
    selectedMode,
    selectedModel,
    selectedThinking,
    hasAgentOptions,
    hasModelOptions,
    hasThinkingOptions,
    canAttach,
    commandOptions,
    resolvedTheme,
    visibleAgents,
    currentAgentColor,
    resolveAgentColorForName,
    resolveModelMetaForPath,
    applyModelVariantSelection,
    applyAgentDefaults,
    resolveDefaultAgentModel,
    fetchProviders,
    fetchAgents,
    fetchCommands,
    resolveProviderModelLimit,
    computeContextPercent,
  };
});
