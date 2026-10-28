import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { SessionEntry as SessionInfo } from '~/types/session';
import type { SsePacket } from '~/types/sse';
import type { PtyInfo } from '~/utils/pty';
import * as opencodeApi from '~/utils/opencode';
import { normalizeDirectory } from '~/utils/path';
import { createStateBuilder } from '~/utils/stateBuilder';
import { StorageKeys, storageGet, storageRemove, storageSet } from '~/utils/storageKeys';
import { asObjectArray, asRecord, asString, asStringArray, toErrorMessage } from '~/utils/strings';
import { defineFeature } from './useAppContext';
import { useBrowserNotifications } from './useBrowserNotifications';
import { useClaudeIntegration } from './useClaudeIntegration';
import { useComposer } from './useComposer';
import { useConnectionState } from './useConnectionState';
import { useFileTree } from './useFileTree';
import { useFloatingCanvas } from './useFloatingCanvas';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import { usePermissionRouting } from './usePermissionRouting';
import { useProviderCatalog } from './useProviderCatalog';
import { useSelectionRouting } from './useSelectionRouting';
import { useServerConfig } from './useServerConfig';
import { useSessionActions } from './useSessionActions';
import { useSessionCatalog } from './useSessionCatalog';
import { useTerminalWindows } from './useTerminalWindows';
import { useToolWindows } from './useToolWindows';

/**
 * Application startup and teardown: connect the event stream, load the server
 * path, projects and sessions, restore the selection, then subscribe to the
 * live events that keep everything in sync. Also owns the login form state.
 */
export const useAppBootstrap = defineFeature('appBootstrap', (context) => {
  const {
    ge,
    serverState,
    credentials,
    settings,
    selection,
    sendStatus,
    sessionScope,
    mainSessionScope,
    uiHooks,
  } = context;
  const {
    selectedSessionId,
    activeDirectory,
    initialize: initializeSessionSelection,
    switchSession: switchSessionSelection,
  } = selection;
  const { suppressAutoWindows } = settings;
  const {
    uiInitState,
    connectionState,
    initLoadingMessage,
    initErrorMessage,
    reconnectingMessage,
    isBootstrapping,
  } = useConnectionState(context);
  const serverConfig = useServerConfig(context);
  const { initialSelection: initialQuery } = useSelectionRouting(context);
  const { fetchCommands, fetchProviders, fetchAgents } = useProviderCatalog(context);
  const { validateSelectedSession, applySessionStatusEvent } = useSessionCatalog(context);
  const { fetchPendingPermissions, fetchPendingQuestions } = usePermissionRouting(context);
  const { syncClaudeProjects } = useClaudeIntegration(context);
  const { openToolPartAsWindow } = useToolWindows(context);
  const terminals = useTerminalWindows(context);
  const { disposeShellWindows, handlePtyEvent, restoreShellSessions } = terminals;
  const { handleWindowResize, syncFloatingExtent } = useFloatingCanvas(context);
  const notifications = useBrowserNotifications(context);
  const {
    notificationSessionOrder,
    syncActiveSelectionToWorker,
    ensureBrowserNotificationPermission,
  } = notifications;
  const sessionActions = useSessionActions(context);
  const { fetchHomePath, reloadSelectedSessionState, todos } = sessionActions;
  const { todosBySessionId, todoErrorBySessionId, normalizeTodoItems } = todos;
  const { feed, refreshGitStatus } = useFileTree({ activeDirectory });
  // These register their own global listeners (keydown, storage) and are
  // instantiated here so startup wires them exactly once.
  useKeyboardShortcuts(context);
  useComposer(context);

  // The app shell only mounts once the UI is ready, so the canvas extent, the
  // composer focus and the saved shell windows can only be set up after the
  // switch away from the loading screen.
  watch(uiInitState, (state) => {
    if (state !== 'ready') return;
    void nextTick(() => {
      syncFloatingExtent();
      uiHooks.focusComposer();
      void restoreShellSessions();
    });
  });

  // Slash commands are defined per directory, so a worktree change reloads them.
  watch(activeDirectory, (directory) => {
    if (isBootstrapping.value) return;
    if (!directory) return;
    void fetchCommands(directory);
  });

  const bootstrapReady = serverState.bootstrapped;
  const loginUrl = ref('http://localhost:4096');
  const loginUsername = ref('');
  const loginPassword = ref('');
  const loginRequiresAuth = ref(false);
  const globalEventUnsubscribers: Array<() => void> = [];
  let initializationInFlight = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // Used by the direct transport path (mobile / no SharedWorker) to process
  // real-time SSE state events and keep serverState in sync.
  let directStateBuilder: ReturnType<typeof createStateBuilder> | null = null;

  async function performDirectBootstrap() {
    // When SharedWorker is unavailable (e.g. mobile browsers), the SSE worker
    // never sends 'state.bootstrap'. We replicate the bootstrap logic here so
    // that serverState.bootstrapped becomes true and loading can proceed.
    const builder = createStateBuilder();

    function asStatusMap(value: unknown): Record<string, { type?: string }> {
      const record = asRecord(value);
      if (!record) return {};
      return record as Record<string, { type?: string }>;
    }

    const projects = asObjectArray<Record<string, unknown>>(await opencodeApi.listProjects());
    const directories = new Set<string>(['']);

    builder.applyProjects(projects as Parameters<typeof builder.applyProjects>[0]);

    projects.forEach((project) => {
      const worktree = normalizeDirectory(asString(project.worktree) ?? '');
      if (worktree) directories.add(worktree);
      const sandboxes = asStringArray(project.sandboxes) ?? [];
      sandboxes.forEach((sandbox) => {
        const dir = normalizeDirectory(sandbox);
        if (dir) directories.add(dir);
      });
    });

    await Promise.all(
      Array.from(directories).map(async (directory) => {
        const [sessions, statuses] = await Promise.all([
          opencodeApi.listSessions({ directory, roots: true }),
          opencodeApi.getSessionStatusMap(directory),
        ]);
        builder.applySessions(
          asObjectArray(sessions) as Parameters<typeof builder.applySessions>[0],
        );
        builder.applyStatuses(asStatusMap(statuses));
      }),
    );

    await Promise.all(
      Array.from(directories).map(async (directory) => {
        const raw = await opencodeApi.getVcsInfo(directory).catch(() => null);
        const vcsInfo = asRecord(raw);
        if (!vcsInfo) return;
        const branch = asString(vcsInfo.branch);
        if (!branch) return;
        builder.applyVcsInfo(directory, { branch });
      }),
    );

    builder.getDefaultProjectId();

    // Keep the builder around so real-time SSE events can update state.
    directStateBuilder = builder;

    serverState.handleStateMessage({
      type: 'state.bootstrap',
      projects: builder.getState().projects,
      notifications: {},
    });
  }

  async function bootstrapSelections() {
    if (isBootstrapping.value) return;
    isBootstrapping.value = true;
    try {
      if (!serverState.bootstrapped.value) {
        await new Promise<void>((resolve) => {
          const stop = watch(
            bootstrapReady,
            (ready) => {
              if (!ready) return;
              stop();
              resolve();
            },
            { immediate: true },
          );
        });
      }

      const initialProjectId = initialQuery.projectId.trim();
      const initialSessionId = initialQuery.sessionId.trim();
      if (initialProjectId && initialSessionId) {
        await switchSessionSelection(initialProjectId, initialSessionId);
      } else {
        await initializeSessionSelection();
      }

      if (activeDirectory.value) {
        await fetchCommands(activeDirectory.value);
      }
    } finally {
      isBootstrapping.value = false;
    }
  }

  async function startInitialization() {
    if (initializationInFlight) return;
    initializationInFlight = true;
    uiInitState.value = 'loading';
    initErrorMessage.value = '';
    reconnectingMessage.value = '';
    try {
      connectionState.value = 'connecting';
      initLoadingMessage.value = 'Connecting to SSE stream...';
      await ge.connect({ failFast: true, timeoutMs: 10000 });
      connectionState.value = 'bootstrapping';
      initLoadingMessage.value = 'Loading server path...';
      await fetchHomePath();
      initLoadingMessage.value = 'Loading projects and sessions...';
      if (!ge.usingSharedWorker && !serverState.bootstrapped.value) {
        await performDirectBootstrap();
      }
      await syncClaudeProjects();
      await bootstrapSelections();
      if (selectedSessionId.value) {
        initLoadingMessage.value = 'Loading session history...';
        await reloadSelectedSessionState();
      }
      if (activeDirectory.value) {
        initLoadingMessage.value = 'Loading worktree state...';
        await fetchCommands(activeDirectory.value || undefined);
        const directory = activeDirectory.value || undefined;
        await fetchPendingPermissions(directory);
        await fetchPendingQuestions(directory);
        void refreshGitStatus();
      }
      connectionState.value = 'ready';
      uiInitState.value = 'ready';
      await fetchProviders();
      await fetchAgents();
    } catch (error) {
      if (!initializationInFlight) return;
      ge.disconnect();
      const msg = toErrorMessage(error);
      connectionState.value = 'error';
      if (/\(40[13]\)/.test(msg)) {
        storageSet(StorageKeys.state.lastAuthError, msg);
        credentials.clear();
        initErrorMessage.value = msg;
        uiInitState.value = 'login';
      } else {
        initErrorMessage.value = msg;
        uiInitState.value = 'login';
      }
    } finally {
      initializationInFlight = false;
    }
  }

  function handleLogin() {
    const u = loginRequiresAuth.value ? loginUsername.value : '';
    const p = loginRequiresAuth.value ? loginPassword.value : '';
    credentials.save(loginUrl.value, u, p);
    void startInitialization();
  }

  function handleAbortInit() {
    ge.disconnect();
    initializationInFlight = false;
    connectionState.value = 'connecting';
    uiInitState.value = 'login';
    initErrorMessage.value = '';
  }

  function handleLogout() {
    credentials.clear();
    ge.disconnect();
    disposeShellWindows();
    uiInitState.value = 'login';
    initErrorMessage.value = '';
    connectionState.value = 'connecting';
  }
  onMounted(async () => {
    ensureBrowserNotificationPermission();
    handleWindowResize();
    credentials.load();

    // Try to auto-configure from the server. If the server provides a URL,
    // use it (overriding any stored credentials). If not, fall through to
    // the stored credentials or the manual login screen.
    const autoConfigured = await serverConfig.load();

    if (autoConfigured || credentials.isConfigured.value) {
      loginUrl.value = credentials.url.value;
      loginUsername.value = credentials.username.value;
      loginPassword.value = credentials.password.value;
      loginRequiresAuth.value = !!(credentials.username.value || credentials.password.value);
      void startInitialization();
    } else {
      uiInitState.value = 'login';
      const savedError = storageGet(StorageKeys.state.lastAuthError);
      if (savedError) {
        initErrorMessage.value = savedError;
        storageRemove(StorageKeys.state.lastAuthError);
      }
    }

    globalEventUnsubscribers.push(
      ge.on('connection.open', () => {
        if (connectionState.value === 'reconnecting' || connectionState.value === 'error') {
          connectionState.value = 'ready';
          reconnectingMessage.value = '';
          sendStatus.value = 'Ready';
        }
        if (bootstrapReady.value) {
          syncActiveSelectionToWorker();
          return;
        }
      }),
    );
    globalEventUnsubscribers.push(
      ge.on('connection.reconnected', () => {
        connectionState.value = 'ready';
        reconnectingMessage.value = '';
        sendStatus.value = 'Ready';
        syncActiveSelectionToWorker();
        void fetchProviders(true);
      }),
    );
    globalEventUnsubscribers.push(
      ge.on('connection.error', (payload) => {
        if (payload.statusCode === 401 || payload.statusCode === 403) {
          const msg = `${payload.message} (HTTP ${payload.statusCode})`;
          storageSet(StorageKeys.state.lastAuthError, msg);
          credentials.clear();
          uiInitState.value = 'login';
          initErrorMessage.value = msg;
          connectionState.value = 'error';
          return;
        }
        if (uiInitState.value === 'loading') {
          connectionState.value = 'error';
          initErrorMessage.value = 'Failed to connect to SSE stream.';
          uiInitState.value = 'login';
          return;
        }
        connectionState.value = 'reconnecting';
        reconnectingMessage.value = 'Reconnecting...';
      }),
    );
    globalEventUnsubscribers.push(
      ge.on('worktree.ready', () => {
        // Worker owns project/worktree graph updates.
      }),
    );
    globalEventUnsubscribers.push(
      ge.on('session.updated', () => {
        validateSelectedSession();
      }),
    );
    globalEventUnsubscribers.push(
      ge.on('session.deleted', ({ info }) => {
        const sessionInfo = info as SessionInfo;
        notificationSessionOrder.value = notificationSessionOrder.value.filter(
          (notificationKey) => notificationKey !== sessionInfo.id,
        );
        validateSelectedSession();
      }),
    );
    globalEventUnsubscribers.push(
      ge.on('file.watcher.updated', (packet) => {
        feed(packet);
      }),
    );
    globalEventUnsubscribers.push(
      ge.on('session.status', ({ sessionID, status }) => {
        applySessionStatusEvent(sessionID, status);
      }),
    );
    globalEventUnsubscribers.push(
      sessionScope.on('todo.updated', ({ sessionID, todos: nextTodos }) => {
        todosBySessionId.value = {
          ...todosBySessionId.value,
          [sessionID]: normalizeTodoItems(nextTodos),
        };
        if (todoErrorBySessionId.value[sessionID]) {
          const nextErrors = { ...todoErrorBySessionId.value };
          delete nextErrors[sessionID];
          todoErrorBySessionId.value = nextErrors;
        }
      }),
    );
    globalEventUnsubscribers.push(
      ge.on('pty.created', ({ info }) => {
        handlePtyEvent({ type: 'pty.created', info: info as PtyInfo });
      }),
    );
    globalEventUnsubscribers.push(
      ge.on('pty.updated', ({ info }) => {
        handlePtyEvent({ type: 'pty.updated', info: info as PtyInfo });
      }),
    );
    globalEventUnsubscribers.push(
      ge.on('pty.exited', ({ id, exitCode }) => {
        handlePtyEvent({ type: 'pty.exited', info: null, id, exitCode });
      }),
    );
    globalEventUnsubscribers.push(
      ge.on('pty.deleted', ({ id }) => {
        terminals.handlePtyDeleted(id);
      }),
    );
    globalEventUnsubscribers.push(
      sessionScope.on('message.part.updated', ({ part }) => {
        if (part.type !== 'tool') return;
        if (suppressAutoWindows.value) return;
        openToolPartAsWindow(part);
      }),
    );

    // ── Direct-transport real-time state sync ─────────────────────────────
    // When SharedWorker is unavailable (mobile browsers) we process raw SSE
    // packets here to keep serverState.projects in sync, mirroring the logic
    // in the SharedWorker's handleStatePacket().
    if (!ge.usingSharedWorker) {
      globalEventUnsubscribers.push(
        ge.onRawPacket((packet: SsePacket) => {
          const builder = directStateBuilder;
          if (!builder) return;

          const packetType = packet.payload.type;
          const properties = packet.payload.properties;
          const packetDirectory = (packet.directory || '').trim().replace(/\/+$/, '') || '/';
          let changedProjectId: string | null = null;

          switch (packetType) {
            case 'session.created': {
              const info = (properties as { info?: unknown }).info;
              if (info && typeof info === 'object') {
                changedProjectId = builder.processSessionCreated(
                  info as Parameters<typeof builder.processSessionCreated>[0],
                );
              }
              break;
            }
            case 'session.updated': {
              const info = (properties as { info?: unknown }).info;
              if (info && typeof info === 'object') {
                changedProjectId = builder.processSessionUpdated(
                  info as Parameters<typeof builder.processSessionUpdated>[0],
                );
              }
              break;
            }
            case 'session.deleted': {
              const info = (properties as { info?: { id?: string; directory?: string } }).info;
              if (info && typeof info === 'object' && typeof info.id === 'string') {
                const deletedDirectory = (info.directory || '').trim().replace(/\/+$/, '') || '/';
                const deletedProjectId = builder.resolveProjectIdForDirectory(deletedDirectory);
                changedProjectId = builder.processSessionDeleted(
                  info.id,
                  deletedProjectId || undefined,
                );
              }
              break;
            }
            case 'session.status': {
              const sessionID = (properties as { sessionID?: string }).sessionID;
              const status = (properties as { status?: { type?: string } }).status;
              if (typeof sessionID === 'string' && status && typeof status.type === 'string') {
                const statusProjectId = builder.resolveProjectIdForDirectory(packetDirectory);
                if (statusProjectId) {
                  changedProjectId = builder.processSessionStatus(
                    sessionID,
                    status.type,
                    statusProjectId,
                  );
                }
              }
              break;
            }
            case 'project.updated': {
              changedProjectId = builder.processProjectUpdated(
                properties as Parameters<typeof builder.processProjectUpdated>[0],
              );
              break;
            }
            case 'vcs.branch.updated': {
              const branch = (properties as { branch?: string }).branch ?? '';
              changedProjectId = builder.processVcsBranchUpdated(packetDirectory, branch);
              break;
            }
            case 'worktree.ready': {
              const readyBranch = (properties as { branch?: string }).branch ?? '';
              changedProjectId = builder.processVcsBranchUpdated(packetDirectory, readyBranch);
              break;
            }
            default:
              // Not a state event — ignore.
              return;
          }

          if (changedProjectId) {
            const project = builder.getProject(changedProjectId);
            if (project) {
              serverState.handleStateMessage({
                type: 'state.project-updated',
                projectId: changedProjectId,
                project,
              });
            }
          }
        }),
      );
    }
  });

  onBeforeUnmount(() => {
    while (globalEventUnsubscribers.length > 0) {
      const dispose = globalEventUnsubscribers.pop();
      dispose?.();
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    mainSessionScope.dispose();
    sessionScope.dispose();
    ge.disconnect();
    disposeShellWindows();
  });

  return {
    uiInitState,
    connectionState,
    initLoadingMessage,
    initErrorMessage,
    loginUrl,
    loginUsername,
    loginPassword,
    loginRequiresAuth,
    startInitialization,
    handleLogin,
    handleAbortInit,
    handleLogout,
  };
});
