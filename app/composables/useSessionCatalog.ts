import { computed, ref } from 'vue';
import type { TopPanelWorktree } from '~/components/TopPanel.vue';
import type { SessionEntry, SessionRetryStatus } from '~/types/session';
import { isClaudeSessionId } from '#shared/utils/claude-ids';
import { normalizeDirectory } from '~/utils/path';
import { resolveProjectColorHex } from '~/utils/stateBuilder';
import { defineFeature } from './useAppContext';
import { useBrowserNotifications } from './useBrowserNotifications';

const NAVIGABLE_MAX_SESSIONS = 5;

/**
 * Read models over the worker state for the selected project: session lists,
 * the header tree, allowed (root + descendant) session ids, and helpers that
 * resolve sessions to projects and paths to the selected worktree.
 */
export const useSessionCatalog = defineFeature('sessionCatalog', (context) => {
  const { serverState, selection, homePath, sendStatus, reasoning } = context;
  const { selectedProjectId, selectedSessionId, activeDirectory } = selection;

  function toSessionInfo(
    directory: string,
    session: {
      id: string;
      parentID?: string;
      title?: string;
      slug?: string;
      status?: 'busy' | 'idle' | 'retry';
      timeCreated?: number;
      timeUpdated?: number;
      timeArchived?: number;
      revert?: SessionEntry['revert'];
    },
  ): SessionEntry {
    return {
      id: session.id,
      parentID: session.parentID,
      title: session.title,
      slug: session.slug,
      directory,
      status: session.status,
      source: isClaudeSessionId(session.id) ? 'claude' : 'opencode',
      time: {
        created: session.timeCreated,
        updated: session.timeUpdated,
        archived: session.timeArchived,
      },
      revert: session.revert,
    };
  }

  const sessionsByProject = computed(() => {
    const byProject: Record<string, SessionEntry[]> = {};
    Object.values(serverState.projects).forEach((project) => {
      const list: SessionEntry[] = [];
      Object.values(project.sandboxes).forEach((sandbox) => {
        Object.values(sandbox.sessions).forEach((session) => {
          list.push(toSessionInfo(sandbox.directory, session));
        });
      });
      byProject[project.id] = list;
    });
    return byProject;
  });

  /** Root sessions of the selected project, filtered to the active directory, newest first. */
  const sessions = computed<SessionEntry[]>(() => {
    const projectId = selectedProjectId.value.trim();
    if (!projectId) return [];
    const directory = activeDirectory.value.trim();
    const all = sessionsByProject.value[projectId] ?? [];
    const roots = all.filter((session) => !session.parentID);
    const filtered = directory
      ? roots.filter((session) => !session.directory || session.directory === directory)
      : roots;
    return filtered.slice().sort((a, b) => (b.time?.created ?? 0) - (a.time?.created ?? 0));
  });

  const sessionParentById = computed(() => {
    const map = new Map<string, string | undefined>();
    const projectId = selectedProjectId.value.trim();
    if (!projectId) return map;
    (sessionsByProject.value[projectId] ?? []).forEach((session) => {
      map.set(session.id, session.parentID);
    });
    return map;
  });

  const currentProjectColor = computed(() => {
    const project = serverState.projects[selectedProjectId.value];
    return resolveProjectColorHex(project?.icon?.color);
  });

  const currentProjectName = computed(() => {
    const project = serverState.projects[selectedProjectId.value];
    if (!project) return undefined;
    const name = project.name?.trim();
    if (name) return name;
    return project.worktree?.replace(/\/+$/, '').split('/').pop() || undefined;
  });

  const filteredSessions = computed(() =>
    sessions.value.filter((session) => {
      if (session.parentID) return false;
      const directory = activeDirectory.value;
      if (directory && session.directory && session.directory !== directory) return false;
      return true;
    }),
  );

  function replaceHomePrefix(path: string) {
    const normalizedPath = normalizeDirectory(path);
    const normalizedHome = normalizeDirectory(homePath.value);
    if (!normalizedHome || !normalizedPath.startsWith('/')) return normalizedPath;
    if (normalizedPath === normalizedHome) return '~';
    const prefix = `${normalizedHome}/`;
    if (normalizedPath.startsWith(prefix)) {
      return `~/${normalizedPath.slice(prefix.length)}`;
    }
    return normalizedPath;
  }

  const topPanelTreeData = computed<TopPanelWorktree[]>(() => {
    return Object.values(serverState.projects)
      .map((project) => {
        const worktreeDirectory = project.worktree;
        const sandboxEntries = Object.values(project.sandboxes)
          .map((sandbox) => {
            const sessionsForSandbox = sandbox.rootSessions
              .map((sessionId) => sandbox.sessions[sessionId])
              .filter((session): session is NonNullable<typeof session> => Boolean(session))
              .map((session) => ({
                id: session.id,
                title: session.title,
                slug: session.slug,
                status: (session.status ?? 'unknown') as 'busy' | 'idle' | 'retry' | 'unknown',
                timeCreated: session.timeCreated,
                timeUpdated: session.timeUpdated ?? session.timeCreated,
                archivedAt: session.timeArchived,
              }))
              .sort(
                (a, b) =>
                  (b.timeUpdated ?? b.timeCreated ?? 0) - (a.timeUpdated ?? a.timeCreated ?? 0),
              );
            const latestUpdated = sessionsForSandbox[0]?.timeUpdated ?? 0;
            const oldestCreated =
              sessionsForSandbox.length > 0
                ? Math.min(...sessionsForSandbox.map((session) => session.timeUpdated ?? Infinity))
                : 0;
            return {
              directory: sandbox.directory,
              branch: sandbox.name || undefined,
              sessions: sessionsForSandbox,
              latestUpdated,
              oldestCreated,
            };
          })
          .sort((a, b) => {
            const aIsPrimary = a.directory === worktreeDirectory;
            const bIsPrimary = b.directory === worktreeDirectory;
            if (aIsPrimary !== bIsPrimary) return aIsPrimary ? -1 : 1;
            return (b.oldestCreated || 0) - (a.oldestCreated || 0);
          });
        const latestSandboxUpdated = sandboxEntries
          .flatMap((sandbox) => sandbox.sessions)
          .reduce((max, session) => Math.max(max, session.timeUpdated ?? 0), 0);
        const name =
          project.name?.trim() ||
          worktreeDirectory.replace(/\/+$/, '').split('/').pop() ||
          undefined;
        return {
          directory: worktreeDirectory,
          label: replaceHomePrefix(worktreeDirectory),
          name,
          projectId: project.id,
          projectColor: resolveProjectColorHex(project.icon?.color),
          sandboxes: sandboxEntries,
          latestUpdated: latestSandboxUpdated,
        };
      })
      .sort((a, b) => {
        if (a.directory === '/' && b.directory !== '/') return 1;
        if (b.directory === '/' && a.directory !== '/') return -1;
        return (a.name || a.label).localeCompare(b.name || b.label);
      });
  });

  /** The header tree trimmed to what keyboard navigation cycles through. */
  const navigableTree = computed(() =>
    topPanelTreeData.value
      .map((worktree) => ({
        ...worktree,
        sandboxes: worktree.sandboxes
          .map((sandbox) => ({
            ...sandbox,
            sessions: sandbox.sessions
              .filter((s) => !s.archivedAt)
              .slice(0, NAVIGABLE_MAX_SESSIONS),
          }))
          .filter((sandbox) => worktree.projectId !== 'global' || sandbox.sessions.length > 0),
      }))
      .filter((worktree) => worktree.sandboxes.some((sandbox) => sandbox.sessions.length > 0)),
  );

  /** Selected session plus all of its descendants (subagents). */
  const allowedSessionIds = computed(() => {
    const rootId = selectedSessionId.value;
    if (!rootId) return new Set<string>();
    const childrenByParent = new Map<string, string[]>();
    sessionParentById.value.forEach((parentId, sessionId) => {
      if (!parentId) return;
      const bucket = childrenByParent.get(parentId) ?? [];
      bucket.push(sessionId);
      childrenByParent.set(parentId, bucket);
    });
    const allowed = new Set<string>();
    const stack = [rootId];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (allowed.has(current)) continue;
      allowed.add(current);
      const children = childrenByParent.get(current);
      if (children) stack.push(...children);
    }
    return allowed;
  });

  const treeDirectoryName = computed(() => {
    const raw = activeDirectory.value.trim();
    if (!raw) return '';
    const normalized = raw.replace(/\\/g, '/').replace(/\/+$/, '');
    if (!normalized) return '/';
    return normalized.split('/').filter(Boolean).at(-1) ?? '/';
  });

  const hasSession = computed(() => Boolean(selectedSessionId.value));

  function sessionLabel(session: SessionEntry) {
    return session.title || session.slug || session.id;
  }

  function getSelectedWorktreeDirectory() {
    return activeDirectory.value.trim();
  }

  function resolveWorktreeRelativePath(path?: string) {
    if (!path) return undefined;
    const normalizedPath = normalizeDirectory(path);
    const base = normalizeDirectory(getSelectedWorktreeDirectory());
    // Absolute on Unix ('/…') or Windows ('C:/…')
    const isAbsolute = normalizedPath.startsWith('/') || /^[A-Za-z]:\//.test(normalizedPath);
    if (!base) return replaceHomePrefix(normalizedPath);
    if (!isAbsolute) return normalizedPath;
    if (normalizedPath === base) return '.';
    const prefix = `${base}/`;
    if (normalizedPath.startsWith(prefix)) return normalizedPath.slice(prefix.length);
    return replaceHomePrefix(normalizedPath);
  }

  function requireSelectedWorktree() {
    const directory = getSelectedWorktreeDirectory();
    if (directory) return directory;
    sendStatus.value = 'No worktree selected.';
    return '';
  }

  function sessionSortKey(session: SessionEntry) {
    return session.time?.updated ?? session.time?.created ?? 0;
  }

  function pickPreferredSessionId(list: SessionEntry[]) {
    if (!Array.isArray(list) || list.length === 0) return '';
    const sorted = list
      .filter((session) => !session.parentID && !session.time?.archived)
      .slice()
      .sort((a, b) => sessionSortKey(b) - sessionSortKey(a));
    return sorted[0]?.id ?? '';
  }

  /** Drop the selection if it no longer points at a root session; pick another. */
  function validateSelectedSession() {
    const sessionId = selectedSessionId.value.trim();
    if (!sessionId) return;
    const projectId = selectedProjectId.value.trim();
    const allSessions = projectId ? (sessionsByProject.value[projectId] ?? []) : [];
    const current = allSessions.find((session) => session.id === sessionId);
    if (current && !current.parentID) return;
    selectedSessionId.value = pickPreferredSessionId(
      allSessions.filter((session) => session.id !== sessionId),
    );
  }

  function resolveProjectIdForSession(sessionId: string) {
    const preferredProjectId = selectedProjectId.value.trim();
    if (preferredProjectId) {
      const preferredSessions = sessionsByProject.value[preferredProjectId] ?? [];
      if (preferredSessions.some((session) => session.id === sessionId)) {
        return preferredProjectId;
      }
    }
    for (const [projectId, projectSessions] of Object.entries(sessionsByProject.value)) {
      if (projectSessions.some((session) => session.id === sessionId)) return projectId;
    }
    return '';
  }

  function resolveProjectIdForDirectory(directory?: string) {
    const normalized = directory?.trim() || '';
    if (!normalized) return '';
    for (const [projectId, project] of Object.entries(serverState.projects)) {
      if (project.worktree === normalized) return projectId;
      if (project.sandboxes[normalized]) return projectId;
    }
    return '';
  }

  function getSessionStatus(sessionId: string, projectId?: string) {
    if (!sessionId) return undefined;
    const preferredProjectId = projectId?.trim() || resolveProjectIdForSession(sessionId);
    const candidates = preferredProjectId
      ? (sessionsByProject.value[preferredProjectId] ?? [])
      : Object.values(sessionsByProject.value).flat();
    const status = candidates.find((session) => session.id === sessionId)?.status;
    return status === 'busy' || status === 'idle' || status === 'retry' ? status : undefined;
  }

  const retryStatus = ref<SessionRetryStatus | null>(null);

  function applySessionStatusEvent(
    sessionId: string,
    status: {
      type: 'busy' | 'idle' | 'retry';
      message?: string;
      next?: number;
      attempt?: number;
    },
  ) {
    const isAllowedSession = allowedSessionIds.value.has(sessionId);
    const isSelectedSession = sessionId === selectedSessionId.value;

    if (status.type === 'busy' || status.type === 'idle') {
      if (isAllowedSession) {
        if (isSelectedSession) retryStatus.value = null;
        reasoning.updateReasoningExpiry(sessionId, status.type);
      }
      return;
    }
    if (status.type !== 'retry') return;
    if (!isSelectedSession || !isAllowedSession) return;

    reasoning.updateReasoningExpiry(sessionId, 'busy');
    if (status.message && typeof status.next === 'number') {
      retryStatus.value = {
        message: status.message,
        next: status.next,
        attempt: status.attempt || 1,
      };
    }
  }

  useBrowserNotifications(context).setSessionLabelResolver((projectId, sessionId) => {
    const session = sessions.value.find(
      (entry) => entry.id === sessionId && resolveProjectIdForSession(entry.id) === projectId,
    );
    return session ? sessionLabel(session) : undefined;
  });

  return {
    sessionsByProject,
    sessions,
    sessionParentById,
    currentProjectColor,
    currentProjectName,
    filteredSessions,
    topPanelTreeData,
    navigableTree,
    allowedSessionIds,
    treeDirectoryName,
    hasSession,
    retryStatus,
    toSessionInfo,
    sessionLabel,
    replaceHomePrefix,
    getSelectedWorktreeDirectory,
    resolveWorktreeRelativePath,
    requireSelectedWorktree,
    sessionSortKey,
    pickPreferredSessionId,
    validateSelectedSession,
    resolveProjectIdForSession,
    resolveProjectIdForDirectory,
    getSessionStatus,
    applySessionStatusEvent,
  };
});
