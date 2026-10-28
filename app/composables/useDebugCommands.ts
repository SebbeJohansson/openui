import ContentViewer from '~/components/viewers/ContentViewer.vue';
import { defineFeature } from './useAppContext';
import { useBrowserNotifications } from './useBrowserNotifications';
import { useFileViewers } from './useFileViewers';
import {
  FILE_VIEWER_WINDOW_HEIGHT,
  FILE_VIEWER_WINDOW_WIDTH,
  useFloatingCanvas,
} from './useFloatingCanvas';
import { useSessionCatalog } from './useSessionCatalog';

const DEBUG_SUBCOMMANDS: Record<string, string> = {
  session: 'Show session graph tree',
  notification: 'Dump pending notification state',
};

/**
 * `/debug` slash-command subcommands: text dumps of the worker session graph and
 * of the notification state, opened in a plain content window.
 */
export const useDebugCommands = defineFeature('debugCommands', (context) => {
  const { fw, serverState, selection } = context;
  const { selectedSessionId } = selection;
  const { getFileViewerPosition } = useFloatingCanvas(context);
  const { shikiTheme } = useFileViewers(context);
  const { sessions, sessionParentById, allowedSessionIds, sessionLabel } =
    useSessionCatalog(context);
  const { notificationSessionOrder, notificationSessions } = useBrowserNotifications(context);

  /** Open a read-only text window, replacing any previous dump. */
  function openDumpWindow(
    key: string,
    title: string,
    content: string,
    factorX: number,
    factorY: number,
  ) {
    const pos = getFileViewerPosition(factorX, factorY);
    if (fw.has(key)) fw.close(key);
    fw.open(key, {
      component: ContentViewer,
      props: { fileContent: content, lang: 'text', gutterMode: 'none', theme: shikiTheme.value },
      closable: true,
      resizable: true,
      focusOnOpen: true,
      scroll: 'manual',
      title,
      x: pos.x,
      y: pos.y,
      width: FILE_VIEWER_WINDOW_WIDTH,
      height: FILE_VIEWER_WINDOW_HEIGHT,
      expiry: Infinity,
    });
  }

  function formatSessionGraphDump(): string {
    const lines: string[] = [];

    const allProjects = Object.values(serverState.projects).sort((a, b) =>
      a.worktree === b.worktree ? a.id.localeCompare(b.id) : a.worktree.localeCompare(b.worktree),
    );
    const totalSessions = allProjects.reduce((count, project) => {
      return (
        count +
        Object.values(project.sandboxes).reduce((projectCount, sandbox) => {
          return projectCount + Object.keys(sandbox.sessions).length;
        }, 0)
      );
    }, 0);

    lines.push('Project Tree (worker-state)');
    lines.push(`  projects: ${allProjects.length}  sessions(total): ${totalSessions}`);
    lines.push('');

    function fmtTime(ts?: number) {
      if (!ts) return '-';
      return new Date(ts).toLocaleString();
    }

    function fmtStatus(s: string) {
      if (s === 'busy') return '[BUSY]';
      if (s === 'retry') return '[RETRY]';
      if (s === 'idle') return '[idle]';
      return `[${s}]`;
    }

    for (const project of allProjects) {
      lines.push(`PROJECT ${project.id}`);
      lines.push(`  worktree: ${project.worktree || '-'}`);
      if (project.name) lines.push(`  name: ${project.name}`);
      if (project.icon?.color) lines.push(`  color: ${project.icon.color}`);
      lines.push(
        `  time: created=${fmtTime(project.time?.created)} updated=${fmtTime(project.time?.updated)} initialized=${fmtTime(project.time?.initialized)}`,
      );

      const sandboxEntries = Object.entries(project.sandboxes).sort(([a], [b]) =>
        a.localeCompare(b),
      );
      if (sandboxEntries.length === 0) {
        lines.push('  (no sandboxes)');
        lines.push('');
        continue;
      }

      for (let si = 0; si < sandboxEntries.length; si++) {
        const [sandboxDirectory, sandbox] = sandboxEntries[si];
        const isLastSandbox = si === sandboxEntries.length - 1;
        const sConnector = isLastSandbox ? '└── ' : '├── ';
        const sPrefix = isLastSandbox ? '    ' : '│   ';

        const branchMeta = sandbox.name ? `  (branch: ${sandbox.name})` : '';
        lines.push(`${sConnector}SANDBOX ${sandboxDirectory}${branchMeta}`);
        lines.push(`${sPrefix}rootSessions: [${sandbox.rootSessions.join(', ')}]`);

        const sessions = Object.values(sandbox.sessions).sort((a, b) => {
          const aTime = a.timeUpdated ?? a.timeCreated ?? 0;
          const bTime = b.timeUpdated ?? b.timeCreated ?? 0;
          return bTime - aTime;
        });

        if (sessions.length === 0) {
          lines.push(`${sPrefix}(no sessions)`);
          continue;
        }

        for (let i = 0; i < sessions.length; i++) {
          const session = sessions[i];
          const isLastSession = i === sessions.length - 1;
          const sessionConnector = isLastSession ? '└── ' : '├── ';
          const sessionPrefix = `${sPrefix}${isLastSession ? '    ' : '│   '}`;
          const status = fmtStatus(session.status ?? 'unknown');
          const title = session.title ? `  "${session.title}"` : '';
          const slug = session.slug ? `  slug=${session.slug}` : '';
          lines.push(`${sPrefix}${sessionConnector}${session.id}  ${status}${title}${slug}`);
          const revertLabel = session.revert
            ? `msg=${session.revert.messageID}${session.revert.partID ? ` part=${session.revert.partID}` : ''}`
            : '-';
          lines.push(
            `${sessionPrefix}dir=${session.directory || sandboxDirectory}  parent=${session.parentID || '(root)'}  archived=${fmtTime(session.timeArchived)}  revert=${revertLabel}`,
          );
          lines.push(
            `${sessionPrefix}created=${fmtTime(session.timeCreated)}  updated=${fmtTime(session.timeUpdated)}`,
          );
        }
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  function formatNotificationDump(): string {
    const lines: string[] = [];
    const map = serverState.notifications;
    const order = notificationSessionOrder.value;
    const parentMap = sessionParentById.value;

    lines.push(`Notification State`);
    lines.push(`  pendingNotificationsBySessionId: ${Object.keys(map).length} session(s)`);
    lines.push(`  notificationSessionOrder: [${order.length}] ${order.join(', ') || '(empty)'}`);
    lines.push(`  selectedSessionId: ${selectedSessionId.value || '(none)'}`);
    lines.push(`  allowedSessionIds: [${allowedSessionIds.value.size}]`);
    lines.push('');

    // Computed notificationSessions (what TopPanel sees)
    const computed = notificationSessions.value;
    lines.push(
      `Computed notificationSessions (TopPanel badge): ${computed.length} entry(s), total count = ${computed.reduce((s, e) => s + e.count, 0)}`,
    );
    for (const entry of computed) {
      const session = sessions.value.find((s) => s.id === entry.sessionId);
      const label = session ? sessionLabel(session) : '(unknown session)';
      const parentId = parentMap.get(entry.sessionId);
      const parentInfo = parentId ? ` parent=${parentId}` : ' (root)';
      lines.push(`  ${entry.sessionId}  count=${entry.count}  "${label}"${parentInfo}`);
    }
    lines.push('');

    // Full map dump
    lines.push(`Full pendingNotificationsBySessionId:`);
    if (Object.keys(map).length === 0) {
      lines.push('  (empty)');
    }
    for (const entry of Object.values(map)) {
      const projectId = entry.projectId;
      const sessionId = entry.sessionId;
      const session = sessions.value.find((s) => s.id === sessionId);
      const label = session ? sessionLabel(session) : '(unknown session)';
      const parentId = parentMap.get(sessionId);
      const parentInfo = parentId ? ` parent=${parentId}` : ' (root)';
      const isAllowed = allowedSessionIds.value.has(sessionId);
      const isSelected = sessionId === selectedSessionId.value;
      const flags: string[] = [];
      if (isSelected) flags.push('SELECTED');
      if (isAllowed) flags.push('ALLOWED');
      if (parentId) flags.push('CHILD');
      const flagStr = flags.length > 0 ? `  [${flags.join(', ')}]` : '';
      lines.push(`  ${projectId}:${sessionId}  "${label}"${parentInfo}${flagStr}`);
      for (const requestId of entry.requestIds) {
        const isIdle = requestId.startsWith('idle:');
        const type = isIdle ? 'idle' : 'permission/question';
        lines.push(`    - ${requestId}  (${type})`);
      }
    }
    lines.push('');

    // Order vs Map consistency check
    const mapKeys = Object.keys(map);
    const orphanedInOrder = order.filter((id) => !mapKeys.includes(id));
    const missingFromOrder = mapKeys.filter((id) => !order.includes(id));
    if (orphanedInOrder.length > 0 || missingFromOrder.length > 0) {
      lines.push(`Consistency Issues:`);
      if (orphanedInOrder.length > 0) {
        lines.push(`  In notificationSessionOrder but NOT in map: ${orphanedInOrder.join(', ')}`);
      }
      if (missingFromOrder.length > 0) {
        lines.push(`  In map but NOT in notificationSessionOrder: ${missingFromOrder.join(', ')}`);
      }
      lines.push('');
    }

    // Pending permissions & questions currently shown as floating windows
    const permissionEntries = fw.entries.value.filter((e) => e.key.startsWith('permission:'));
    const questionEntries = fw.entries.value.filter((e) => e.key.startsWith('question:'));
    lines.push(`Active Floating Windows:`);
    lines.push(`  Permission windows: ${permissionEntries.length}`);
    for (const entry of permissionEntries) {
      const req = entry.props?.request as { id?: string; sessionID?: string } | undefined;
      lines.push(`    - ${entry.key}  session=${req?.sessionID ?? '?'}  request=${req?.id ?? '?'}`);
    }
    lines.push(`  Question windows: ${questionEntries.length}`);
    for (const entry of questionEntries) {
      const req = entry.props?.request as { id?: string; sessionID?: string } | undefined;
      lines.push(`    - ${entry.key}  session=${req?.sessionID ?? '?'}  request=${req?.id ?? '?'}`);
    }

    return lines.join('\n');
  }

  function openDebugSessionViewer() {
    openDumpWindow(
      'debug:session-graph',
      'Debug: Session Graph',
      formatSessionGraphDump(),
      0.12,
      0.08,
    );
  }

  function openDebugNotificationViewer() {
    openDumpWindow(
      'debug:notification',
      'Debug: Notifications',
      formatNotificationDump(),
      0.15,
      0.1,
    );
  }

  function runDebugCommand(args: string): { ok: boolean; message: string } {
    const sub = args.trim().toLowerCase();
    if (!sub || sub === 'help') {
      const lines = ['Available /debug subcommands:'];
      for (const [name, desc] of Object.entries(DEBUG_SUBCOMMANDS)) {
        lines.push(`  ${name} — ${desc}`);
      }
      return { ok: true, message: lines.join('\n') };
    }
    if (sub === 'session' || sub === 'sessions') {
      openDebugSessionViewer();
      return { ok: true, message: 'Session graph opened.' };
    }
    if (sub === 'notification' || sub === 'notifications') {
      openDebugNotificationViewer();
      return { ok: true, message: 'Notification dump opened.' };
    }
    return { ok: false, message: `Unknown debug subcommand: ${sub}. Type /debug help for a list.` };
  }

  return { runDebugCommand, DEBUG_SUBCOMMANDS };
});
