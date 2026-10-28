import { ref, watch } from 'vue';
import type { SessionEntry as SessionInfo, WorktreeInfo } from '~/types/session';
import * as opencodeApi from '~/utils/opencode';
import { normalizeDirectory } from '~/utils/path';
import { toErrorMessage } from '~/utils/strings';
import { defineFeature } from './useAppContext';
import { isClaudeSessionId } from '#shared/utils/claude-ids';
import { useClaudeIntegration } from './useClaudeIntegration';
import { useComposer } from './useComposer';
import { useConnectionState } from './useConnectionState';
import { decodeApiTextContent, type FileContentResponse } from './useFileViewers';
import { useModals } from './useModals';
import { useOutputScroller } from './useOutputScroller';
import { usePermissionRouting } from './usePermissionRouting';
import { useSessionCatalog } from './useSessionCatalog';
import { useTerminalWindows } from './useTerminalWindows';
import { useTodos } from './useTodos';

type UserMessageMeta = {
  agent?: string;
  providerId?: string;
  modelId?: string;
  variant?: string;
};

/**
 * Everything the user can do to a project, worktree or session: create, delete,
 * archive, fork, revert, plus loading a session's message history and resetting
 * the view when the selection changes.
 */
export const useSessionActions = defineFeature('sessionActions', (context) => {
  const {
    fw,
    msg,
    ge,
    serverState,
    openCodeApi,
    selection,
    homePath,
    serverWorktreePath,
    sendStatus,
    sessionError,
    worktreeError,
    reasoning,
    subagentWindows,
    uiHooks,
  } = context;
  const {
    selectedProjectId,
    selectedSessionId,
    projectDirectory,
    activeDirectory,
    switchSession: switchSessionSelection,
  } = selection;
  const { ensureConnectionReady, isBootstrapping, uiInitState } = useConnectionState(context);
  const { editingProject, isProjectPickerOpen } = useModals(context);
  const {
    sessionsByProject,
    filteredSessions,
    allowedSessionIds,
    pickPreferredSessionId,
    validateSelectedSession,
    getSelectedWorktreeDirectory,
    resolveProjectIdForDirectory,
    retryStatus,
  } = useSessionCatalog(context);
  const { fetchPendingPermissions, fetchPendingQuestions } = usePermissionRouting(context);
  const { restoreShellSessions } = useTerminalWindows(context);
  const scroller = useOutputScroller(context);
  const { notifyContentChange, resetFollow, scrollToBottom: scrollOutputPanelToBottom } = scroller;
  const todos = useTodos({
    selectedSessionId,
    allowedSessionIds,
    activeDirectory,
  });
  const {
    todosBySessionId,
    todoLoadingBySessionId,
    todoErrorBySessionId,
    reloadTodosForAllowedSessions,
  } = todos;

  /** Agent/model metadata of user messages, used to seed forked-session drafts. */
  const userMessageMetaById = ref<Record<string, UserMessageMeta>>({});
  const userMessageTimeById = ref<Record<string, number>>({});
  let primaryHistoryRequestId = 0;
  /** activeDirectory + allowed-session membership the todo lists were loaded for. */
  let loadedTodoScope = '';

  function currentTodoScope() {
    const members = Array.from(allowedSessionIds.value).sort().join(',');
    return `${activeDirectory.value}\n${members}`;
  }

  /**
   * Reload the todo lists unless they already match the current scope. Both the
   * selection reset and the scope watcher below call this, so whichever runs
   * first does the work and the other is a no-op.
   */
  function reloadTodosForCurrentScope() {
    const scope = currentTodoScope();
    if (scope === loadedTodoScope) return;
    loadedTodoScope = scope;
    void reloadTodosForAllowedSessions();
  }

  /** Drafts are seeded lazily to avoid a composer/session-actions import cycle. */
  const seedForkedSessionComposerDraft = (
    payload: { sessionId: string; messageId: string },
    forkedSession: SessionInfo,
  ) =>
    useComposer(context).seedForkedSessionDraft(payload, forkedSession, userMessageMetaById.value);

  async function fetchHomePath() {
    try {
      const data = (await opencodeApi.getPathInfo()) as {
        home?: string;
        worktree?: string;
      };
      if (typeof data.home === 'string' && data.home.trim()) {
        homePath.value = data.home.trim();
      }
      if (typeof data.worktree === 'string' && data.worktree.trim()) {
        serverWorktreePath.value = data.worktree.trim();
      }
    } catch {
      return;
    }
  }

  function handleEditProject(payload: { projectId: string; worktree: string }) {
    editingProject.value = payload;
  }

  async function handleSaveProject(payload: {
    projectId: string;
    worktree: string;
    name: string;
    icon: { color: string; override: string };
    commands: { start: string };
  }) {
    try {
      await openCodeApi.updateProject(payload.projectId, {
        directory: payload.worktree,
        name: payload.name,
        icon: payload.icon,
        commands: payload.commands,
      });
      editingProject.value = null;
    } catch (error) {
      console.error('Failed to update project:', error);
    }
  }

  async function createSessionInDirectory(directory: string) {
    const session = await openCodeApi.createSession(directory);
    if (!session?.id) return undefined;
    await switchSessionSelection(session.projectID, session.id);
    return session;
  }

  async function createWorktreeFromWorktree(worktree: string) {
    if (!ensureConnectionReady('Creating worktree')) return;
    worktreeError.value = '';
    if (!worktree) {
      worktreeError.value = 'Worktree base directory not set.';
      return;
    }
    try {
      const data = (await openCodeApi.createWorktree({
        directory: worktree,
        projectId: selectedProjectId.value,
      })) as WorktreeInfo;
      if (data && typeof data.directory === 'string') {
        await createSessionInDirectory(data.directory);
      }
    } catch (error) {
      worktreeError.value = `Worktree create failed: ${toErrorMessage(error)}`;
    }
  }

  async function deleteWorktree(directory: string) {
    if (!ensureConnectionReady('Deleting worktree')) return;
    worktreeError.value = '';
    if (!directory) return;
    if (!projectDirectory.value) {
      worktreeError.value = 'Worktree base directory not set.';
      return;
    }
    const baseDir = projectDirectory.value.replace(/\/+$/, '');
    const targetDir = directory.replace(/\/+$/, '');
    if (baseDir && targetDir === baseDir) return;
    try {
      await openCodeApi.deleteWorktree({
        directory: projectDirectory.value,
        targetDirectory: targetDir,
        projectId: selectedProjectId.value,
      });
      if (normalizeDirectory(activeDirectory.value) === targetDir) {
        const projectId = selectedProjectId.value.trim();
        const candidates = (sessionsByProject.value[projectId] ?? []).filter((session) => {
          if (session.parentID || session.time?.archived) return false;
          const sessionDirectory = normalizeDirectory(session.directory || projectDirectory.value);
          return sessionDirectory !== targetDir;
        });
        const nextSessionId = pickPreferredSessionId(candidates);
        if (projectId && nextSessionId) {
          selectedProjectId.value = projectId;
          selectedSessionId.value = nextSessionId;
        } else {
          await createSessionInDirectory(baseDir);
        }
      }
    } catch (error) {
      worktreeError.value = `Worktree delete failed: ${toErrorMessage(error)}`;
    }
  }

  function openProjectPicker() {
    isProjectPickerOpen.value = true;
  }

  async function createNewSession(): Promise<SessionInfo | undefined> {
    if (!ensureConnectionReady('Creating session')) return undefined;
    sessionError.value = '';
    try {
      const directory = activeDirectory.value.trim();
      if (!directory) {
        throw new Error('Session create failed: active directory is empty.');
      }
      const data = await openCodeApi.createSession(directory);
      if (data && typeof data.id === 'string') {
        const nextProjectId = data.projectID;
        await switchSessionSelection(nextProjectId, data.id);
      }
      return data;
    } catch (error) {
      sessionError.value = `Session create failed: ${toErrorMessage(error)}`;
      return undefined;
    }
  }

  async function handleNewSessionInSandbox(payload: { worktree: string; directory: string }) {
    await createSessionInDirectory(payload.directory);
  }

  function handleTopPanelSessionSelect(payload: {
    projectId?: string;
    worktree: string;
    directory: string;
    sessionId: string;
  }) {
    if (
      selectedSessionId.value === payload.sessionId &&
      activeDirectory.value === payload.directory &&
      projectDirectory.value === payload.worktree
    ) {
      return;
    }
    const projectId =
      payload.projectId ||
      resolveProjectIdForDirectory(payload.directory) ||
      resolveProjectIdForDirectory(payload.worktree) ||
      selectedProjectId.value;
    void switchSessionSelection(projectId, payload.sessionId);
  }

  async function deleteSession(sessionId: string) {
    if (!ensureConnectionReady('Deleting session')) return;
    sessionError.value = '';
    if (!sessionId) return;
    try {
      const directory = activeDirectory.value.trim();
      await openCodeApi.deleteSession({
        sessionId,
        projectId: selectedProjectId.value,
        directory: directory || undefined,
      });
    } catch (error) {
      sessionError.value = `Session delete failed: ${toErrorMessage(error)}`;
    }
  }

  async function archiveSession(sessionId: string) {
    if (!ensureConnectionReady('Archiving session')) return;
    sessionError.value = '';
    if (!sessionId) return;
    try {
      const directory = activeDirectory.value.trim();
      await openCodeApi.archiveSession({
        sessionId,
        projectId: selectedProjectId.value,
        directory: directory || undefined,
      });
    } catch (error) {
      sessionError.value = `Session archive failed: ${toErrorMessage(error)}`;
    }
  }

  async function archiveProject(payload: { projectId: string; worktree: string }) {
    if (!ensureConnectionReady('Archiving project')) return;
    sessionError.value = '';
    const { projectId } = payload;
    if (!projectId) return;
    const project = serverState.projects[projectId];
    if (!project) return;
    const toArchive: Array<{ sessionId: string; directory: string }> = [];
    for (const sandbox of Object.values(project.sandboxes)) {
      for (const session of Object.values(sandbox.sessions)) {
        if (!session.timeArchived) {
          toArchive.push({ sessionId: session.id, directory: sandbox.directory });
        }
      }
    }
    if (toArchive.length === 0) return;
    try {
      await Promise.all(
        toArchive.map(({ sessionId, directory }) =>
          openCodeApi.archiveSession({ sessionId, projectId, directory }),
        ),
      );
    } catch (error) {
      sessionError.value = `Project archive failed: ${toErrorMessage(error)}`;
    }
  }

  async function deleteProject(payload: { projectId: string; worktree: string }) {
    if (!ensureConnectionReady('Deleting project')) return;
    sessionError.value = '';
    const { projectId } = payload;
    if (!projectId) return;
    const project = serverState.projects[projectId];
    if (!project) return;
    const toDelete: Array<{ sessionId: string; directory: string }> = [];
    for (const sandbox of Object.values(project.sandboxes)) {
      for (const session of Object.values(sandbox.sessions)) {
        toDelete.push({ sessionId: session.id, directory: sandbox.directory });
      }
    }
    if (toDelete.length === 0) return;
    try {
      await Promise.all(
        toDelete.map(({ sessionId, directory }) =>
          openCodeApi.deleteSession({ sessionId, projectId, directory }),
        ),
      );
    } catch (error) {
      sessionError.value = `Project delete failed: ${toErrorMessage(error)}`;
    }
  }

  async function handleForkMessage(payload: { sessionId: string; messageId: string }) {
    if (!ensureConnectionReady('Fork')) return;
    sessionError.value = '';
    try {
      sendStatus.value = 'Forking...';
      const data = (await openCodeApi.forkSession({
        sessionId: payload.sessionId,
        messageId: payload.messageId,
        directory: activeDirectory.value.trim() || undefined,
        projectId: selectedProjectId.value,
      })) as SessionInfo;
      if (data && typeof data.id === 'string') {
        seedForkedSessionComposerDraft(payload, data);
        await switchSessionSelection(selectedProjectId.value, data.id);
      }
      sendStatus.value = 'Forked.';
    } catch (error) {
      sessionError.value = `Session fork failed: ${toErrorMessage(error)}`;
    }
  }

  async function handleRevertMessage(payload: { sessionId: string; messageId: string }) {
    if (!ensureConnectionReady('Revert')) return;
    sessionError.value = '';
    try {
      sendStatus.value = 'Reverting...';
      await openCodeApi.revertSession({
        sessionId: payload.sessionId,
        messageId: payload.messageId,
        projectId: selectedProjectId.value,
        directory: activeDirectory.value.trim() || undefined,
      });
      sendStatus.value = 'Reverted.';
      if (selectedSessionId.value === payload.sessionId) void reloadSelectedSessionState();
    } catch (error) {
      sessionError.value = `Session revert failed: ${toErrorMessage(error)}`;
    }
  }

  async function handleUndoRevert() {
    const sessionId = selectedSessionId.value;
    if (!sessionId) return;
    if (!ensureConnectionReady('Undo')) return;
    sessionError.value = '';
    try {
      sendStatus.value = 'Undoing...';
      await openCodeApi.unrevertSession({
        sessionId,
        projectId: selectedProjectId.value,
        directory: activeDirectory.value.trim() || undefined,
      });
      sendStatus.value = 'Undone.';
    } catch (error) {
      sessionError.value = `Session undo failed: ${toErrorMessage(error)}`;
    }
  }

  /** Set project name from package.json for newly created projects (fire-and-forget). */
  async function initProjectNameFromPackageJson(projectId: string, directory: string) {
    try {
      const result = (await opencodeApi.readFileContent({
        directory,
        path: 'package.json',
      })) as FileContentResponse | string;
      const content = typeof result === 'string' ? result : result?.content;
      if (!content) return;
      const isBase64 = typeof result !== 'string' && result?.encoding === 'base64';
      const decoded =
        typeof content === 'string' && isBase64
          ? decodeApiTextContent(result as FileContentResponse)
          : content;
      const parsed = JSON.parse(decoded);
      const name = parsed?.name;
      if (typeof name !== 'string' || !name.trim()) return;
      await openCodeApi.updateProject(projectId, { directory, name: name.trim() });
    } catch {
      // Silently ignore - package.json may not exist or be invalid
    }
  }

  async function handleProjectDirectorySelect(directory: string) {
    isProjectPickerOpen.value = false;
    if (!directory) return;

    const isNewProject = !Object.values(serverState.projects).some((p) => p.worktree === directory);

    const { projectId, sessionId } = await openCodeApi.openProject(directory);
    ge.sendToWorker({
      type: 'load-sessions',
      directory,
    });
    await switchSessionSelection(projectId, sessionId);

    if (isNewProject && projectId !== 'global') {
      void initProjectNameFromPackageJson(projectId, directory);
    }
  }

  function parseMessageTime(info?: Record<string, unknown>): number | undefined {
    if (!info) return undefined;
    const time = info.time as Record<string, unknown> | undefined;
    if (!time || typeof time !== 'object') return undefined;
    const created = time.created;
    return typeof created === 'number' ? created : undefined;
  }

  function parseUserMessageMeta(info?: Record<string, unknown>): UserMessageMeta | null {
    if (!info) return null;
    const agent = typeof info.agent === 'string' ? info.agent.trim() : '';
    const model = (info.model as Record<string, unknown> | undefined) ?? undefined;
    const providerId =
      typeof info.providerID === 'string'
        ? info.providerID.trim()
        : typeof model?.providerID === 'string'
          ? model.providerID.trim()
          : '';
    const modelId =
      typeof info.modelID === 'string'
        ? String(info.modelID).trim()
        : typeof model?.modelID === 'string'
          ? String(model.modelID).trim()
          : '';
    const variant = typeof info.variant === 'string' ? info.variant.trim() : '';
    if (!agent && !modelId && !providerId && !variant) return null;
    return {
      agent: agent || undefined,
      providerId: providerId || undefined,
      modelId: modelId || undefined,
      variant: variant || undefined,
    };
  }

  function storeUserMessageMeta(messageId: string | undefined, meta: UserMessageMeta | null) {
    if (!messageId || !meta) return;
    userMessageMetaById.value = { ...userMessageMetaById.value, [messageId]: meta };
  }

  function storeUserMessageTime(messageId: string | undefined, messageTime?: number) {
    if (!messageId || typeof messageTime !== 'number') return;
    userMessageTimeById.value = { ...userMessageTimeById.value, [messageId]: messageTime };
  }

  async function fetchHistory(sessionId: string, isSubagentMessage = false) {
    if (!sessionId) return;
    const requestId = !isSubagentMessage ? ++primaryHistoryRequestId : 0;
    const requestedDirectory = !isSubagentMessage ? getSelectedWorktreeDirectory() : '';
    try {
      const directory = getSelectedWorktreeDirectory();
      // Claude sessions are stored by this server, not by OpenCode.
      const data = isClaudeSessionId(sessionId)
        ? await useClaudeIntegration(context).fetchClaudeHistory(sessionId)
        : ((await opencodeApi.listSessionMessages(sessionId, {
            directory: directory || undefined,
          })) as Array<Record<string, unknown>>);
      if (!Array.isArray(data)) return;
      if (!isSubagentMessage) {
        if (requestId !== primaryHistoryRequestId) return;
        if (selectedSessionId.value !== sessionId) return;
        if (getSelectedWorktreeDirectory() !== requestedDirectory) return;
      }
      msg.loadHistory(data);

      data.forEach((message) => {
        const info = message.info as Record<string, unknown> | undefined;
        const id = typeof info?.id === 'string' ? info.id : undefined;
        if (!id) return;
        const meta = parseUserMessageMeta(info);
        const messageTime = parseMessageTime(info);
        storeUserMessageMeta(id, meta);
        storeUserMessageTime(id, messageTime);
      });

      if (!isSubagentMessage) {
        notifyContentChange(false);
      }
    } catch {
      // A failed history load leaves the thread empty; the user can retry by reselecting.
    }
  }

  async function reloadSelectedSessionState() {
    if (selectedSessionId.value && isBootstrapping.value && !activeDirectory.value) {
      return;
    }
    fw.closeAll({ exclude: (key) => key.startsWith('shell:') });
    msg.reset();
    resetFollow();
    reasoning.reset();
    subagentWindows.reset();
    retryStatus.value = null;
    todosBySessionId.value = {};
    todoLoadingBySessionId.value = {};
    todoErrorBySessionId.value = {};
    loadedTodoScope = '';
    if (selectedSessionId.value) {
      const sessionId = selectedSessionId.value;
      await fetchHistory(sessionId);
      if (msg.roots.value.length === 0) {
        scrollOutputPanelToBottom(false);
      }
      if (uiInitState.value === 'ready') {
        await restoreShellSessions();
      }
      reloadTodosForCurrentScope();
      const directory = activeDirectory.value || undefined;
      void fetchPendingPermissions(directory);
      void fetchPendingQuestions(directory);
    }
    uiHooks.focusComposer();
  }

  // Switching session must tear down the previous thread and load the new one.
  // Without this the selection changes but the UI keeps rendering the old
  // session's messages, windows and todos.
  //
  // Registered before the todo-scope watcher below so the reset it performs
  // runs first and that watcher's reload lands on a cleared todo map.
  watch(selectedSessionId, (sessionId, previousSessionId) => {
    if (sessionId === previousSessionId) return;
    void reloadSelectedSessionState();
  });

  // Subagents appearing or finishing changes which sessions own todo lists, and
  // the lists are fetched per directory, so both have to re-query.
  watch(currentTodoScope, () => {
    reloadTodosForCurrentScope();
  });

  // Keep the selection pointing at a live root session as the graph changes: an
  // empty selection picks the preferred session, a stale one is replaced.
  watch(filteredSessions, () => {
    if (isBootstrapping.value) return;
    if (!serverState.bootstrapped.value) return;
    if (!selectedSessionId.value) {
      const preferredId = pickPreferredSessionId(filteredSessions.value);
      if (preferredId) selectedSessionId.value = preferredId;
      return;
    }
    validateSelectedSession();
  });

  return {
    userMessageMetaById,
    userMessageTimeById,
    fetchHomePath,
    handleEditProject,
    handleSaveProject,
    createSessionInDirectory,
    createWorktreeFromWorktree,
    deleteWorktree,
    openProjectPicker,
    createNewSession,
    handleNewSessionInSandbox,
    handleTopPanelSessionSelect,
    deleteSession,
    archiveSession,
    archiveProject,
    deleteProject,
    handleForkMessage,
    handleRevertMessage,
    handleUndoRevert,
    handleProjectDirectorySelect,
    fetchHistory,
    reloadSelectedSessionState,
    todos,
  };
});
