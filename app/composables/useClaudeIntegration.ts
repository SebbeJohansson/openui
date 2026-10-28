import { computed } from 'vue';
import type { ClaudeMessagesResponse, ClaudeSessionInfo } from '#shared/types/events';
import {
  ccProjectId,
  isClaudeProjectId,
  isClaudeSessionId,
  rawSessionId,
} from '#shared/utils/claude-ids';
import type { SessionState } from '~/types/worker-state';
import { toErrorMessage } from '~/utils/strings';
import { defineFeature } from './useAppContext';
import { useServerConfig } from './useServerConfig';

type ClaudeSessionPayload = {
  id: string;
  projectID: string;
  directory: string;
  title?: string;
  time?: { created?: number; updated?: number };
};

function toSessionState(session: {
  id: string;
  title?: string;
  directory?: string;
  time?: { created?: number; updated?: number };
}): SessionState {
  return {
    id: session.id,
    title: session.title,
    directory: session.directory,
    timeCreated: session.time?.created,
    timeUpdated: session.time?.updated,
  };
}

/**
 * Experimental Claude Code CLI support. Claude sessions live on the Nitro
 * server rather than in OpenCode, so they are fetched separately and merged
 * into the same project tree; ids carry a `cc_` / `ccp_` prefix.
 */
export const useClaudeIntegration = defineFeature('claudeIntegration', (context) => {
  const { serverState, selection, sessionError } = context;
  const serverConfig = useServerConfig(context);
  const { activeDirectory, selectedSessionId, switchSession } = selection;

  const isClaudeSession = computed(() => isClaudeSessionId(selectedSessionId.value));

  /** An OpenCode project whose worktree matches `directory`, if any. */
  function findOpenCodeProjectFor(directory: string) {
    return Object.values(serverState.projects).find(
      (project) =>
        !isClaudeProjectId(project.id) &&
        (project.worktree === directory || Object.keys(project.sandboxes).includes(directory)),
    );
  }

  /**
   * Put a newly created Claude session into the project tree straight away so
   * the selection can switch to it without waiting for the next sync.
   * Mutates `session.projectID` when the session is merged into an OpenCode project.
   */
  function injectClaudeSession(session: ClaudeSessionPayload): void {
    const { id, directory } = session;
    const sessionState = toSessionState(session);
    const targetProject =
      findOpenCodeProjectFor(directory) ?? serverState.projects[session.projectID];

    if (!targetProject) {
      serverState.projects[session.projectID] = {
        id: session.projectID,
        name: directory.split('/').pop() ?? directory,
        worktree: directory,
        sandboxes: {
          [directory]: {
            directory,
            name: 'main',
            rootSessions: [id],
            sessions: { [id]: sessionState },
          },
        },
      };
      return;
    }

    const sandbox =
      targetProject.sandboxes[directory] ??
      targetProject.sandboxes[Object.keys(targetProject.sandboxes)[0] ?? ''];
    if (sandbox) {
      sandbox.sessions[id] = sessionState;
      if (!sandbox.rootSessions.includes(id)) sandbox.rootSessions.unshift(id);
    } else {
      targetProject.sandboxes[directory] = {
        directory,
        name: 'main',
        rootSessions: [id],
        sessions: { [id]: sessionState },
      };
    }
    // Merged into an OpenCode project, so the caller must select that project.
    session.projectID = targetProject.id;
  }

  /** Create a Claude session in `directory` (defaults to the active one) and select it. */
  async function createClaudeSession(directory?: string): Promise<void> {
    sessionError.value = '';
    try {
      const target = (directory ?? activeDirectory.value).trim();
      if (!target) throw new Error('Active directory is empty.');
      const res = await fetch(serverConfig.claudeApiUrl('/sessions'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ directory: target }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { sessionID: string; session: ClaudeSessionPayload };
      if (!data?.session?.id) return;
      injectClaudeSession(data.session);
      await switchSession(data.session.projectID, data.session.id);
    } catch (error) {
      sessionError.value = `Claude session create failed: ${toErrorMessage(error)}`;
    }
  }

  /** Send a prompt to a Claude session. Attachments are not supported yet. */
  async function sendClaudePrompt(sessionId: string, text: string): Promise<void> {
    const res = await fetch(
      serverConfig.claudeApiUrl(`/sessions/${rawSessionId(sessionId)}/prompt`),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      },
    );
    if (!res.ok) throw new Error(`Claude prompt failed: HTTP ${res.status}`);
  }

  /**
   * Stored history for a Claude session, reshaped into the `{ info, parts }`
   * entries the message store expects (the server returns flat arrays).
   */
  async function fetchClaudeHistory(sessionId: string): Promise<Array<Record<string, unknown>>> {
    const res = await fetch(
      serverConfig.claudeApiUrl(`/sessions/${rawSessionId(sessionId)}/messages`),
    );
    if (!res.ok) throw new Error(`Claude history failed: HTTP ${res.status}`);
    const { messages, parts } = (await res.json()) as ClaudeMessagesResponse;
    const partsByMessage = new Map<string, unknown[]>();
    for (const part of parts) {
      const messageId = (part as { messageID?: string }).messageID;
      if (!messageId) continue;
      const bucket = partsByMessage.get(messageId) ?? [];
      bucket.push(part);
      partsByMessage.set(messageId, bucket);
    }
    return messages.map((info) => ({
      info,
      parts: partsByMessage.get((info as { id?: string }).id ?? '') ?? [],
    }));
  }

  /** Merge every Claude session on the server into the project tree. */
  async function syncClaudeProjects(): Promise<void> {
    if (!serverConfig.claudeEnabled.value) return;
    try {
      const res = await fetch(serverConfig.claudeApiUrl('/sessions'), {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return;
      const sessions = (await res.json()) as ClaudeSessionInfo[];

      const byProject = new Map<string, ClaudeSessionInfo[]>();
      for (const session of sessions) {
        const projectId = session.projectID ?? ccProjectId(session.directory ?? 'unknown');
        const bucket = byProject.get(projectId) ?? [];
        bucket.push(session);
        byProject.set(projectId, bucket);
      }

      for (const [projectId, projectSessions] of byProject) {
        const directory = projectSessions[0]?.directory ?? '';
        const existing =
          findOpenCodeProjectFor(directory) ?? serverState.projects[projectId] ?? null;

        if (existing) {
          // Merge into the existing sandbox without overwriting OpenCode data.
          const sandbox =
            existing.sandboxes[directory] ??
            existing.sandboxes[Object.keys(existing.sandboxes)[0] ?? ''];
          if (!sandbox) continue;
          for (const session of projectSessions) {
            if (sandbox.sessions[session.id]) continue;
            sandbox.sessions[session.id] = toSessionState(session);
            if (!sandbox.rootSessions.includes(session.id)) {
              sandbox.rootSessions.unshift(session.id);
            }
          }
          continue;
        }

        const sessionsMap: Record<string, SessionState> = {};
        const rootSessions: string[] = [];
        for (const session of projectSessions) {
          sessionsMap[session.id] = toSessionState(session);
          rootSessions.push(session.id);
        }
        serverState.projects[projectId] = {
          id: projectId,
          name: directory.split('/').pop() ?? directory,
          worktree: directory,
          sandboxes: {
            [directory]: { directory, name: 'main', rootSessions, sessions: sessionsMap },
          },
        };
      }
    } catch {
      // Server not reachable: Claude sessions simply do not appear.
    }
  }

  return {
    isClaudeSession,
    claudeEnabled: serverConfig.claudeEnabled,
    createClaudeSession,
    sendClaudePrompt,
    fetchClaudeHistory,
    syncClaudeProjects,
  };
});
