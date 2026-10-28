import { computed, nextTick, onScopeDispose, ref, watch } from 'vue';
import type { Attachment } from '~/types/composer';
import type { CommandInfo } from '~/types/provider';
import type { SessionEntry as SessionInfo } from '~/types/session';
import { isClaudeSessionId } from '#shared/utils/claude-ids';
import * as opencodeApi from '~/utils/opencode';
import { StorageKeys, storageGet, storageKey, storageSetJSON } from '~/utils/storageKeys';
import { toErrorMessage } from '~/utils/strings';
import { useAgentModelMemory } from './useAgentModelMemory';
import { defineFeature } from './useAppContext';
import { useAttachments } from './useAttachments';
import { useClaudeIntegration } from './useClaudeIntegration';
import { useConnectionState } from './useConnectionState';
import { useDebugCommands } from './useDebugCommands';
import { useHiddenModels } from './useHiddenModels';
import { useOutputScroller } from './useOutputScroller';
import { parseProviderModelKey, useProviderCatalog } from './useProviderCatalog';
import { useSessionCatalog } from './useSessionCatalog';
import { useTerminalWindows } from './useTerminalWindows';
import { useToolWindows } from './useToolWindows';

type ComposerDraft = {
  messageInput: string;
  attachments: Attachment[];
  agent: string;
  model: string;
  variant?: string;
  updatedAt: number;
  rev: number;
  writerTabId: string;
};

/**
 * The message composer: input state, the per-session draft that survives
 * reloads and other tabs, the status line, and sending or aborting a prompt.
 */
export const useComposer = defineFeature('composer', (context) => {
  const {
    msg,
    openCodeApi,
    selection,
    settings,
    sendStatus,
    sessionError,
    projectError,
    worktreeError,
    reasoning,
    uiHooks,
  } = context;
  const { selectedSessionId, activeDirectory } = selection;
  const { rememberModelPerAgent } = settings;
  const { uiInitState, connectionState, reconnectingMessage, ensureConnectionReady } =
    useConnectionState(context);
  const attachmentsFeature = useAttachments(context);
  const { attachments } = attachmentsFeature;
  const { isHidden: isModelHidden } = useHiddenModels();
  const { remember: rememberAgentModel, recall: recallAgentModel } = useAgentModelMemory();
  const {
    agentOptions,
    modelOptions,
    allModelOptions,
    commands,
    selectedMode,
    selectedModel,
    selectedThinking,
    providersError,
    agentsError,
    applyAgentDefaults,
    applyModelVariantSelection,
    resolveDefaultAgentModel,
  } = useProviderCatalog(context);
  const {
    filteredSessions,
    allowedSessionIds,
    pickPreferredSessionId,
    requireSelectedWorktree,
    getSessionStatus,
    retryStatus,
  } = useSessionCatalog(context);
  const { runningToolIds } = useToolWindows(context);
  const { openShellFromInput } = useTerminalWindows(context);
  const { runDebugCommand } = useDebugCommands(context);
  const { sendClaudePrompt } = useClaudeIntegration(context);
  const { enableFollow } = useOutputScroller(context);
  const { updateReasoningExpiry } = reasoning;

  const messageInput = ref('');
  const isSending = ref(false);
  const isAborting = ref(false);
  /** Recent inputs, used by the composer's history navigation. */
  const recentUserInputs: { text: string; time: number }[] = [];
  /** Draft revision per session, so a remote tab's older write never wins. */
  const composerDraftRevisionByContext = new Map<string, number>();
  const composerDraftTabId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  /** Combined provider/agent load problem, shown in the status bar. */
  const modelLoadWarning = computed(() => {
    if (providersError.value) return `Models: ${providersError.value}`;
    if (agentsError.value) return `Agents: ${agentsError.value}`;
    return '';
  });

  const statusText = computed(() => {
    if (connectionState.value === 'reconnecting') {
      return reconnectingMessage.value || 'Reconnecting...';
    }
    if (retryStatus.value) {
      const timeStr = formatRetryTime(retryStatus.value.next);
      return `${retryStatus.value.message} | Next: ${timeStr}`;
    }
    if (openCodeApi.pending.value) {
      return 'Synchronizing with SSE updates...';
    }
    return (
      projectError.value ||
      worktreeError.value ||
      sessionError.value ||
      modelLoadWarning.value ||
      sendStatus.value
    );
  });

  const isStatusError = computed(() =>
    Boolean(
      projectError.value ||
      worktreeError.value ||
      sessionError.value ||
      modelLoadWarning.value ||
      retryStatus.value,
    ),
  );

  const busyDescendantSessionIds = computed(() => {
    const allowed = allowedSessionIds.value;
    const selected = selectedSessionId.value;
    const ids: string[] = [];
    for (const sid of allowed) {
      if (sid === selected) continue;
      const status = getSessionStatus(sid);
      if (status === 'busy' || status === 'retry') ids.push(sid);
    }
    return ids;
  });

  const isThinking = computed(() => {
    const selected = selectedSessionId.value;
    const ownStatus = selected ? getSessionStatus(selected) : undefined;
    return Boolean(
      ownStatus === 'busy' ||
      ownStatus === 'retry' ||
      busyDescendantSessionIds.value.length > 0 ||
      runningToolIds.size > 0,
    );
  });

  const canSend = computed(() =>
    Boolean(
      uiInitState.value === 'ready' &&
      connectionState.value === 'ready' &&
      selectedSessionId.value &&
      !isSending.value &&
      (messageInput.value.trim().length > 0 || attachments.value.length > 0),
    ),
  );

  const canAbort = computed(() =>
    Boolean(
      uiInitState.value === 'ready' &&
      connectionState.value === 'ready' &&
      selectedSessionId.value &&
      isThinking.value &&
      !isAborting.value,
    ),
  );

  function normalizeStoredAttachment(value: unknown): Attachment | null {
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const filename = typeof record.filename === 'string' ? record.filename.trim() : '';
    const mime = typeof record.mime === 'string' ? record.mime.trim() : '';
    const dataUrl = typeof record.dataUrl === 'string' ? record.dataUrl : '';
    if (!id || !filename || !mime || !dataUrl) return null;
    return { id, filename, mime, dataUrl };
  }

  function normalizeStoredComposerDraft(value: unknown): ComposerDraft | null {
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    const messageInput = typeof record.messageInput === 'string' ? record.messageInput : '';
    const attachments = Array.isArray(record.attachments)
      ? record.attachments
          .map((item) => normalizeStoredAttachment(item))
          .filter((item): item is Attachment => Boolean(item))
      : [];
    const agent = typeof record.agent === 'string' ? record.agent : '';
    const model = typeof record.model === 'string' ? record.model : '';
    const variant = typeof record.variant === 'string' ? record.variant : undefined;
    const updatedAt = typeof record.updatedAt === 'number' ? record.updatedAt : Date.now();
    const rev = typeof record.rev === 'number' ? record.rev : updatedAt;
    const writerTabId = typeof record.writerTabId === 'string' ? record.writerTabId : '';
    return {
      messageInput,
      attachments,
      agent,
      model,
      variant,
      updatedAt,
      rev,
      writerTabId,
    };
  }

  function parseComposerDraftStore(raw: string | null) {
    if (!raw) return {} as Record<string, ComposerDraft>;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object') return {} as Record<string, ComposerDraft>;
      const normalized: Record<string, ComposerDraft> = {};
      Object.entries(parsed).forEach(([key, value]) => {
        const draft = normalizeStoredComposerDraft(value);
        if (!draft) return;
        normalized[key] = draft;
      });
      return normalized;
    } catch {
      return {} as Record<string, ComposerDraft>;
    }
  }

  function readComposerDraftStore() {
    const raw = storageGet(StorageKeys.drafts.composer);
    return parseComposerDraftStore(raw);
  }

  function writeComposerDraftStore(store: Record<string, ComposerDraft>) {
    storageSetJSON(StorageKeys.drafts.composer, store);
  }

  function readComposerDraft(contextKey: string) {
    if (!contextKey) return null;
    const store = readComposerDraftStore();
    return store[contextKey] ?? null;
  }

  function nextComposerDraftRevision(contextKey: string, existingDraft?: ComposerDraft | null) {
    const storeRev = existingDraft?.rev ?? 0;
    const knownRev = composerDraftRevisionByContext.get(contextKey) ?? 0;
    const nextRev = Math.max(storeRev, knownRev) + 1;
    composerDraftRevisionByContext.set(contextKey, nextRev);
    return nextRev;
  }

  function writeComposerDraft(contextKey: string, draft: ComposerDraft) {
    if (!contextKey) return;
    const store = readComposerDraftStore();
    store[contextKey] = draft;
    composerDraftRevisionByContext.set(contextKey, draft.rev);
    writeComposerDraftStore(store);
  }

  function clearComposerInputState() {
    messageInput.value = '';
    attachments.value = [];
  }

  function draftKeyForSelectedContext() {
    return selectedSessionId.value;
  }

  function applyComposerDraftToComposerState(draft: ComposerDraft, contextKey: string) {
    composerDraftRevisionByContext.set(contextKey, draft.rev);
    messageInput.value = draft.messageInput;
    attachments.value = draft.attachments.slice();

    // Bootstrap guard: if options not loaded yet, apply draft values as-is
    if (agentOptions.value.length === 0 || modelOptions.value.length === 0) {
      if (draft.agent) selectedMode.value = draft.agent;
      if (draft.model) selectedModel.value = draft.model;
      selectedThinking.value = draft.variant;
      return;
    }

    // Validate and apply agent
    let agentToApply = draft.agent;
    if (draft.agent && !agentOptions.value.some((o) => o.id === draft.agent)) {
      // Agent not found, fall back to defaults
      const defaults = resolveDefaultAgentModel();
      agentToApply = defaults.agent;
    } else if (draft.agent) {
      agentToApply = draft.agent;
      selectedMode.value = agentToApply;
    }

    // Apply agent defaults to get correct model and variant
    if (agentToApply) {
      selectedMode.value = agentToApply;
      applyAgentDefaults(agentToApply);
    }

    const draftModelExists = !!(
      draft.model &&
      (modelOptions.value.some((model) => model.id === draft.model) ||
        (rememberModelPerAgent.value &&
          allModelOptions.value.some((model) => model.id === draft.model)))
    );
    const modelToApply = draftModelExists ? draft.model : undefined;
    applyModelVariantSelection(
      modelToApply,
      draft.variant,
      draftModelExists && isModelHidden(draft.model!),
    );
  }

  function restoreComposerDraftForContext(contextKey: string): boolean {
    if (!contextKey) return false;
    const draft = readComposerDraft(contextKey);
    if (!draft) return false;
    applyComposerDraftToComposerState(draft, contextKey);
    return true;
  }

  function persistComposerDraftForCurrentContext() {
    const contextKey = draftKeyForSelectedContext();
    if (!contextKey) return;
    const existingDraft = readComposerDraft(contextKey);
    const rev = nextComposerDraftRevision(contextKey, existingDraft);
    const draft: ComposerDraft = {
      messageInput: messageInput.value,
      attachments: attachments.value.map((item) => ({
        id: item.id,
        filename: item.filename,
        mime: item.mime,
        dataUrl: item.dataUrl,
      })),
      agent: selectedMode.value,
      model: selectedModel.value,
      variant: selectedThinking.value,
      updatedAt: Date.now(),
      rev,
      writerTabId: composerDraftTabId,
    };
    writeComposerDraft(contextKey, draft);
  }

  function clearComposerDraftForCurrentContext() {
    messageInput.value = '';
    attachments.value = [];
    persistComposerDraftForCurrentContext();
  }

  function handleMessageInputUpdate(value: string) {
    messageInput.value = value;
    persistComposerDraftForCurrentContext();
  }

  function handleSelectedModeUpdate(value: string) {
    // Save current model+variant for the outgoing agent before switching
    if (rememberModelPerAgent.value && selectedMode.value && selectedModel.value) {
      rememberAgentModel(selectedMode.value, selectedModel.value, selectedThinking.value);
    }

    selectedMode.value = value;

    // Try to restore remembered model for the new agent
    if (rememberModelPerAgent.value) {
      const remembered = recallAgentModel(value);
      if (remembered?.model) {
        // Check if the model still exists (in allModelOptions, including hidden)
        const exists = allModelOptions.value.some((m) => m.id === remembered.model);
        if (exists) {
          applyModelVariantSelection(remembered.model, remembered.variant, true);
          persistComposerDraftForCurrentContext();
          return;
        }
      }
    }

    // Fallback: apply server-defined agent defaults
    applyAgentDefaults(value);
    persistComposerDraftForCurrentContext();
  }

  function handleApplyHistoryEntry(entry: {
    text: string;
    agent?: string;
    model?: string;
    variant?: string;
  }) {
    messageInput.value = entry.text;
    if (entry.agent && agentOptions.value.some((option) => option.id === entry.agent)) {
      selectedMode.value = entry.agent;
      applyAgentDefaults(entry.agent);
    }
    applyModelVariantSelection(entry.model, entry.variant);
    persistComposerDraftForCurrentContext();
  }

  function handleSelectedModelUpdate(value: string) {
    selectedModel.value = value;
    if (rememberModelPerAgent.value && selectedMode.value) {
      rememberAgentModel(selectedMode.value, value, selectedThinking.value);
    }
    nextTick(() => {
      persistComposerDraftForCurrentContext();
    });
  }

  function handleSelectedThinkingUpdate(value: string | undefined) {
    selectedThinking.value = value;
    if (rememberModelPerAgent.value && selectedMode.value && selectedModel.value) {
      rememberAgentModel(selectedMode.value, selectedModel.value, value);
    }
    persistComposerDraftForCurrentContext();
  }

  function handleComposerDraftStorage(event: StorageEvent) {
    if (event.storageArea !== window.localStorage) return;
    if (event.key !== storageKey(StorageKeys.drafts.composer)) return;
    const contextKey = draftKeyForSelectedContext();
    if (!contextKey) return;
    const store = parseComposerDraftStore(event.newValue);
    const draft = store[contextKey] ?? null;
    const knownRev = composerDraftRevisionByContext.get(contextKey) ?? 0;
    if (!draft) {
      composerDraftRevisionByContext.delete(contextKey);
      clearComposerInputState();
      return;
    }
    if (draft.rev < knownRev) return;
    applyComposerDraftToComposerState(draft, contextKey);
  }

  function buildComposerDraftFromUserMessage(
    payload: { sessionId: string; messageId: string },
    metaById: Record<string, { agent?: string; modelId?: string; variant?: string }>,
  ): Omit<ComposerDraft, 'rev' | 'writerTabId'> {
    const message = msg.get(payload.messageId);
    const messageInput = (message ? msg.getTextContent(payload.messageId) : '') || '';
    const sourceAttachments =
      (message ? msg.getImageAttachments(payload.messageId) : undefined) ?? [];
    const attachmentsForDraft: Attachment[] = sourceAttachments.map((item) => ({
      id: item.id,
      filename: item.filename,
      mime: item.mime,
      dataUrl: item.url,
    }));
    const meta = metaById[payload.messageId];
    return {
      messageInput,
      attachments: attachmentsForDraft,
      agent: meta?.agent ?? '',
      model: meta?.modelId ?? '',
      variant: meta?.variant,
      updatedAt: Date.now(),
    };
  }

  async function handleAddAttachments(files: File[]) {
    if (await attachmentsFeature.addFiles(files)) persistComposerDraftForCurrentContext();
  }

  function removeAttachment(id: string) {
    attachmentsFeature.remove(id);
    persistComposerDraftForCurrentContext();
  }

  function formatRetryTime(timestamp: number): string {
    const nextDate = new Date(timestamp);
    const now = Date.now();
    const diffMs = timestamp - now;

    const absolute = nextDate
      .toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
      .replace(/(\d+)\/(\d+)\/(\d+),/, '$3/$1/$2');

    const diffSec = Math.max(0, Math.ceil(diffMs / 1000));
    const diffMin = Math.ceil(diffSec / 60);
    const diffHour = Math.ceil(diffMin / 60);

    let relative: string;
    if (diffHour > 1) {
      relative = `in ${diffHour} hours`;
    } else if (diffMin > 1) {
      relative = `in ${diffMin} minutes`;
    } else {
      relative = `in ${diffSec} seconds`;
    }

    return `${absolute} (${relative})`;
  }

  function parseSlashCommand(input: string) {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) return null;
    const match = trimmed.slice(1).match(/^(\S+)(?:\s+(.*))?$/);
    if (!match) return null;
    const name = match[1]?.trim();
    if (!name) return null;
    const args = match[2] ?? '';
    return { name, arguments: args };
  }

  function findCommandByName(name: string) {
    const target = name.toLowerCase();
    return commands.value.find((command) => command.name.toLowerCase() === target) ?? null;
  }

  async function sendCommand(sessionId: string, command: CommandInfo, commandArgs: string) {
    if (!ensureConnectionReady('Sending commands')) return;
    const directory = activeDirectory.value.trim();
    await opencodeApi.sendCommand(sessionId, {
      directory: directory || undefined,
      command: command.name,
      arguments: commandArgs,
      agent: command.agent || selectedMode.value,
      model: command.model || selectedModel.value,
      variant: selectedThinking.value,
    });
  }

  async function sendMessage() {
    if (!ensureConnectionReady('Sending')) return;
    if (!canSend.value) return;
    const text = messageInput.value.trim();
    const hasText = text.length > 0;
    const hasAttachments = attachments.value.length > 0;
    let sessionId = selectedSessionId.value;
    if ((!hasText && !hasAttachments) || !sessionId) return;
    if (!filteredSessions.value.some((session) => session.id === sessionId)) {
      const fallbackId = pickPreferredSessionId(filteredSessions.value);
      const fallback = fallbackId
        ? filteredSessions.value.find((session) => session.id === fallbackId)
        : filteredSessions.value[0];
      if (!fallback) {
        sendStatus.value = 'No session selected.';
        return;
      }
      selectedSessionId.value = fallback.id;
      sessionId = fallback.id;
    }
    const slash = hasText ? parseSlashCommand(text) : null;
    const commandMatch = slash ? findCommandByName(slash.name) : null;
    const selectedInfo = modelOptions.value.find((model) => model.id === selectedModel.value);
    const selectedModelIDs = parseProviderModelKey(selectedModel.value);
    const providerID = selectedInfo?.providerID ?? (selectedModelIDs.providerID || undefined);
    const modelID = selectedInfo?.modelID ?? (selectedModelIDs.modelID || undefined);
    if (hasText) {
      recentUserInputs.push({ text, time: Date.now() });
      while (recentUserInputs.length > 20) recentUserInputs.shift();
    }
    messageInput.value = '';
    enableFollow();
    isSending.value = true;
    sendStatus.value = 'Sending...';
    try {
      if (slash && slash.name.toLowerCase() === 'shell') {
        await openShellFromInput(slash.arguments ?? '');
        sendStatus.value = 'Shell ready.';
        clearComposerDraftForCurrentContext();
        return;
      }
      if (slash && slash.name.toLowerCase() === 'debug') {
        const debugResult = runDebugCommand(slash.arguments ?? '');
        sendStatus.value = debugResult.message;
        clearComposerDraftForCurrentContext();
        return;
      }
      if (slash && commandMatch) {
        await sendCommand(sessionId, commandMatch, slash.arguments ?? '');
        sendStatus.value = 'Sent.';
        clearComposerDraftForCurrentContext();
        return;
      }
      const directory = requireSelectedWorktree();
      if (!directory) return;
      const parts = [] as Array<Record<string, unknown>>;
      if (hasText) parts.push({ type: 'text', text });
      if (hasAttachments) {
        parts.push(
          ...attachments.value.map((item) => ({
            type: 'file',
            mime: item.mime,
            url: item.dataUrl,
            filename: item.filename,
          })),
        );
      }
      if (isClaudeSessionId(sessionId)) {
        await sendClaudePrompt(sessionId, text);
      } else {
        await opencodeApi.sendPromptAsync(sessionId, {
          directory,
          agent: selectedMode.value,
          model: {
            providerID,
            modelID: modelID || '',
          },
          variant: selectedThinking.value,
          parts,
        });
      }
      sendStatus.value = 'Sent.';
      attachments.value = [];
      clearComposerDraftForCurrentContext();
    } catch (error) {
      sendStatus.value = `Send failed: ${toErrorMessage(error)}`;
    } finally {
      isSending.value = false;
    }
  }

  async function abortSession() {
    if (!ensureConnectionReady('Stopping')) return;
    const sessionId = selectedSessionId.value;
    if (!sessionId || isAborting.value) return;
    isAborting.value = true;
    sendStatus.value = 'Stopping...';
    try {
      const directory = activeDirectory.value.trim();
      const busyDescendants = busyDescendantSessionIds.value;
      const abortPromises = [
        opencodeApi.abortSession(sessionId, directory || undefined),
        ...busyDescendants.map((sid) =>
          opencodeApi.abortSession(sid, directory || undefined).catch(() => {}),
        ),
      ];
      await Promise.all(abortPromises);
      sendStatus.value = 'Stopped.';
    } catch (error) {
      sendStatus.value = `Stop failed: ${toErrorMessage(error)}`;
    } finally {
      isAborting.value = false;
    }
  }

  /** Seed a forked session's draft from the message that was forked. */
  function seedForkedSessionDraft(
    payload: { sessionId: string; messageId: string },
    forkedSession: SessionInfo,
    metaById: Record<string, { agent?: string; modelId?: string; variant?: string }>,
  ) {
    if (!forkedSession.id) return;
    const contextKey = forkedSession.id.trim();
    if (!contextKey) return;
    const draft = buildComposerDraftFromUserMessage(payload, metaById);
    const existingDraft = readComposerDraft(contextKey);
    writeComposerDraft(contextKey, {
      ...draft,
      rev: nextComposerDraftRevision(contextKey, existingDraft),
      writerTabId: composerDraftTabId,
    });
  }

  // Switching session swaps the composer contents for that session's draft.
  watch(
    selectedSessionId,
    (contextKey, previousKey) => {
      const prevContextKey = previousKey ?? '';
      if (contextKey === prevContextKey) return;
      clearComposerInputState();
      nextTick(() => uiHooks.resetComposer());
      if (!contextKey) return;
      const hadDraft = restoreComposerDraftForContext(contextKey);
      if (!hadDraft && !prevContextKey) resolveDefaultAgentModel();
    },
    { immediate: true },
  );

  // Reasoning windows expire once the session stops working.
  watch(
    isThinking,
    (active) => {
      if (active) return;
      if (!selectedSessionId.value) return;
      updateReasoningExpiry(selectedSessionId.value, 'idle');
    },
    { immediate: true },
  );

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', handleComposerDraftStorage);
    onScopeDispose(() => window.removeEventListener('storage', handleComposerDraftStorage));
  }

  return {
    messageInput,
    isSending,
    isAborting,
    recentUserInputs,
    statusText,
    isStatusError,
    modelLoadWarning,
    canSend,
    canAbort,
    isThinking,
    busyDescendantSessionIds,
    handleMessageInputUpdate,
    handleSelectedModeUpdate,
    handleSelectedModelUpdate,
    handleSelectedThinkingUpdate,
    handleApplyHistoryEntry,
    handleAddAttachments,
    removeAttachment,
    persistComposerDraftForCurrentContext,
    clearComposerInputState,
    restoreComposerDraftForContext,
    seedForkedSessionDraft,
    sendMessage,
    abortSession,
  };
});
