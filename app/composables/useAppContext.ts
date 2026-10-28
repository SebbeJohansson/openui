/**
 * The one place where the app's core singletons are wired together: server
 * connection, state mirror, selection, messages and floating windows.
 *
 * Created once by the page (`provideAppContext`) and read by every feature
 * composable through `useAppContext()`. provide/inject (not a module singleton)
 * ties the lifetime to the page so logout/login and tests start clean.
 */
import {
  computed,
  getCurrentScope,
  inject,
  provide,
  reactive,
  ref,
  watch,
  watchEffect,
  type EffectScope,
  type InjectionKey,
} from 'vue';
import ReasoningContent from '~/components/ToolWindow/Reasoning.vue';
import SubagentContent from '~/components/ToolWindow/Subagent.vue';
import * as opencodeApi from '~/utils/opencode';
import { useCredentials } from './useCredentials';
import { useDeltaAccumulator } from './useDeltaAccumulator';
import { useFloatingWindows } from './useFloatingWindows';
import { useGlobalEvents } from './useGlobalEvents';
import { useIsMobile } from './useIsMobile';
import { useMessages } from './useMessages';
import { useOpenCodeApi } from './useOpenCodeApi';
import { useReasoningWindows } from './useReasoningWindows';
import { useServerState } from './useServerState';
import { useSessionSelection } from './useSessionSelection';
import { useSettings } from './useSettings';
import { useSubagentWindows } from './useSubagentWindows';

const REASONING_CLOSE_DELAY_MS = 3000;
const SUBAGENT_CLOSE_DELAY_MS = 3000;

export type ModelNameResolver = (providerID: string, modelID: string) => string | undefined;

/**
 * Callbacks that shell components register so feature composables can poke the
 * UI without holding template refs to components they do not own.
 */
export type UiHooks = {
  focusComposer: () => void;
  resetComposer: () => void;
  openSessionDropdown: () => void;
  closeSessionDropdown: () => void;
  toggleSessionDropdown: () => void;
  getOutputPanelEl: () => HTMLElement | undefined;
};

function noop() {}

export function createAppContext() {
  const credentials = useCredentials();
  const settings = useSettings();
  const { isMobile } = useIsMobile();
  const fw = useFloatingWindows();

  const serverState = useServerState();
  const openCodeApi = useOpenCodeApi(serverState.projects);
  const selection = useSessionSelection(
    computed(() => serverState.projects),
    async (projectId) => {
      const directory = serverState.projects[projectId]?.worktree?.trim();
      if (!directory) {
        throw new Error('Session create failed: project worktree is empty.');
      }
      const created = await openCodeApi.createSession(directory);
      if (!created?.id) {
        throw new Error('Session create failed: invalid response.');
      }
      return { id: created.id, projectId };
    },
  );
  const { selectedProjectId, selectedSessionId } = selection;

  /** sessionId -> parentID for the selected project; feeds the event scope filter. */
  const sessionParentRecord = reactive<Record<string, string | undefined>>({});
  watch(
    () => {
      const project = serverState.projects[selectedProjectId.value.trim()];
      const map = new Map<string, string | undefined>();
      if (!project) return map;
      Object.values(project.sandboxes).forEach((sandbox) => {
        Object.values(sandbox.sessions).forEach((session) => {
          map.set(session.id, session.parentID);
        });
      });
      return map;
    },
    (parentMap) => {
      Object.keys(sessionParentRecord).forEach((sessionId) => {
        if (!parentMap.has(sessionId)) delete sessionParentRecord[sessionId];
      });
      parentMap.forEach((parentId, sessionId) => {
        sessionParentRecord[sessionId] = parentId;
      });
    },
    { immediate: true },
  );

  const ge = useGlobalEvents(credentials);
  ge.setWorkerMessageHandler(serverState.handleStateMessage);
  const deltaAccumulator = useDeltaAccumulator();
  deltaAccumulator.listen(ge);
  const sessionScope = ge.session(selectedSessionId, sessionParentRecord);
  const mainSessionScope = ge.mainSession(selectedSessionId);
  const msg = useMessages();
  msg.bindScope(mainSessionScope);

  // Set by the provider catalog once model metadata is loaded.
  const modelNameResolver = ref<ModelNameResolver | null>(null);
  const resolveModelName: ModelNameResolver = (providerID, modelID) =>
    modelNameResolver.value?.(providerID, modelID);

  const reasoning = useReasoningWindows({
    selectedSessionId,
    fw,
    reasoningComponent: ReasoningContent,
    theme: () => 'github-dark',
    reasoningCloseDelayMs: REASONING_CLOSE_DELAY_MS,
    resolveModelName,
    suppressAutoWindows: settings.suppressAutoWindows,
  });
  const subagentWindows = useSubagentWindows({
    selectedSessionId,
    fw,
    subagentComponent: SubagentContent,
    theme: () => 'github-dark',
    closeDelayMs: SUBAGENT_CLOSE_DELAY_MS,
    resolveModelName,
    suppressAutoWindows: settings.suppressAutoWindows,
  });
  reasoning.bindScope(sessionScope);
  subagentWindows.bindScope(sessionScope);

  watchEffect(() => {
    opencodeApi.setBaseUrl(credentials.baseUrl.value);
    opencodeApi.setAuthorization(credentials.authHeader.value);
  });

  const uiHooks: UiHooks = {
    focusComposer: noop,
    resetComposer: noop,
    openSessionDropdown: noop,
    closeSessionDropdown: noop,
    toggleSessionDropdown: noop,
    getOutputPanelEl: () => undefined,
  };

  return {
    /** Effect scope of the providing component; feature factories run inside it. */
    scope: getCurrentScope() as EffectScope | undefined,
    /** Lazily created feature singletons, see defineFeature(). */
    features: new Map<string, unknown>(),
    credentials,
    settings,
    isMobile,
    fw,
    serverState,
    openCodeApi,
    selection,
    sessionParentRecord,
    ge,
    deltaAccumulator,
    sessionScope,
    mainSessionScope,
    msg,
    reasoning,
    subagentWindows,
    modelNameResolver,
    uiHooks,
    // Cross-cutting UI state shared by several feature composables.
    homePath: ref(''),
    serverWorktreePath: ref(''),
    sendStatus: ref('Ready'),
    sessionError: ref(''),
    projectError: ref(''),
    worktreeError: ref(''),
  };
}

export type AppContext = ReturnType<typeof createAppContext>;

const APP_CONTEXT_KEY: InjectionKey<AppContext> = Symbol('openui.app-context');

/** Call once in the page's setup. */
export function provideAppContext(): AppContext {
  const context = createAppContext();
  provide(APP_CONTEXT_KEY, context);
  return context;
}

/** Read the shared context from any descendant of the page (setup only). */
export function useAppContext(): AppContext {
  const context = inject(APP_CONTEXT_KEY, null);
  if (!context) {
    throw new Error('useAppContext() must be called inside a component under provideAppContext().');
  }
  return context;
}

/**
 * Define a feature composable whose state is created once per app context, the
 * first time any component asks for it, inside the page's effect scope (so its
 * watchers outlive the component that happened to call it first).
 *
 * Factories must not use component lifecycle hooks; use `onScopeDispose`.
 */
export function defineFeature<T>(
  key: string,
  factory: (context: AppContext) => T,
): (context?: AppContext) => T {
  // The optional argument lets one feature reach another without a second
  // inject() call, which only works during setup.
  return (injected?: AppContext) => {
    const context = injected ?? useAppContext();
    if (!context.features.has(key)) {
      const created = context.scope ? context.scope.run(() => factory(context)) : factory(context);
      context.features.set(key, created as T);
    }
    return context.features.get(key) as T;
  };
}
