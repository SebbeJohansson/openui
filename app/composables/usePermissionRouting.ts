import { computed, onScopeDispose, watch } from 'vue';
import type { MessageInfo, PermissionRule } from '~/types/sse';
import { normalizePermissionConfig, rulesFromToolsMap } from '~/utils/permissions';
import { defineFeature } from './useAppContext';
import { useConnectionState } from './useConnectionState';
import { usePermissions, type PermissionRequest } from './usePermissions';
import { useProviderCatalog } from './useProviderCatalog';
import { useQuestions, type QuestionRequest } from './useQuestions';
import { useSessionCatalog } from './useSessionCatalog';

/**
 * Permission and question prompts: the rule layers that describe what the
 * current agent and session allow, the pending-request windows, and the event
 * subscriptions that keep them in sync with the server.
 */
export const usePermissionRouting = defineFeature('permissionRouting', (context) => {
  const { fw, serverState, selection, msg, ge, sessionScope } = context;
  const { selectedProjectId, selectedSessionId, activeDirectory } = selection;
  const { ensureConnectionReady } = useConnectionState(context);
  const { agents, selectedMode } = useProviderCatalog(context);
  const { allowedSessionIds } = useSessionCatalog(context);

  /** Session-scoped rules, as stored on the session by the server. */
  const currentSessionPermissionRules = computed<PermissionRule[]>(() => {
    const projectId = selectedProjectId.value.trim();
    const sessionId = selectedSessionId.value.trim();
    if (!projectId || !sessionId) return [];
    const project = serverState.projects[projectId];
    if (!project) return [];
    for (const sandbox of Object.values(project.sandboxes)) {
      const session = sandbox.sessions[sessionId];
      if (session) return session.permission ?? [];
    }
    return [];
  });

  /**
   * Permission rules for the selected agent, including the deprecated `tools`
   * boolean map which the server still honours for backwards compatibility.
   */
  const currentAgentPermissionRules = computed<PermissionRule[]>(() => {
    const agent = agents.value.find((entry) => entry.name === selectedMode.value);
    if (!agent) return [];
    return [...rulesFromToolsMap(agent.tools), ...normalizePermissionConfig(agent.permission)];
  });

  const permissions = usePermissions({
    fw,
    allowedSessionIds,
    activeDirectory,
    ensureConnectionReady,
    globalRules: computed(() => []),
    agentRules: currentAgentPermissionRules,
    sessionRules: currentSessionPermissionRules,
    agentName: computed(() => selectedMode.value),
    sessionId: computed(() => selectedSessionId.value),
  });

  const questions = useQuestions({
    fw,
    allowedSessionIds,
    activeDirectory,
    ensureConnectionReady,
    getTextContent: (messageId: string) => msg.getTextContent(messageId) || '',
  });

  const pendingPermissionCount = computed(() => permissions.pendingRequests.value.length);

  /**
   * Match a thread root to a pending permission request so the error bar can
   * offer inline approval. Falls back to any pending request in the same session.
   */
  function resolvePendingPermissionForRoot(root: MessageInfo) {
    const sessionId = root.sessionID;
    if (!sessionId) return null;
    const request =
      permissions.findPendingRequestForTool(sessionId, root.id) ??
      permissions.findPendingRequestForSession(sessionId);
    if (!request) return null;
    return {
      id: request.id,
      permission: request.permission,
      isSubmitting: Boolean(permissions.permissionSendingById.value[request.id]),
    };
  }

  const unsubscribers = [
    sessionScope.on('permission.asked', (packet) => {
      permissions.upsertPermissionEntry(packet as PermissionRequest);
    }),
    sessionScope.on('permission.replied', ({ requestID }) => {
      permissions.removePermissionEntry(requestID);
    }),
    ge.on('permission.replied', ({ requestID }) => {
      permissions.removePermissionEntry(requestID);
    }),
    sessionScope.on('question.asked', (packet) => {
      questions.upsertQuestionEntry(packet as QuestionRequest);
    }),
    sessionScope.on('question.replied', ({ requestID }) => {
      questions.removeQuestionEntry(requestID);
    }),
    ge.on('question.replied', ({ requestID }) => {
      questions.removeQuestionEntry(requestID);
    }),
    sessionScope.on('question.rejected', ({ requestID }) => {
      questions.removeQuestionEntry(requestID);
    }),
  ];
  onScopeDispose(() => {
    unsubscribers.forEach((dispose) => dispose());
  });

  // Drop prompts for sessions that are no longer in scope.
  watch(
    allowedSessionIds,
    () => {
      permissions.prunePermissionEntries();
      questions.pruneQuestionEntries();
    },
    { immediate: true },
  );

  return {
    currentSessionPermissionRules,
    currentAgentPermissionRules,
    pendingPermissionCount,
    pendingPermissions: permissions.pendingRequests,
    openToolPermissions: permissions.openToolPermissions,
    handlePermissionReply: permissions.handlePermissionReply,
    resolvePendingPermissionForRoot,
    fetchPendingPermissions: permissions.fetchPendingPermissions,
    fetchPendingQuestions: questions.fetchPendingQuestions,
  };
});
