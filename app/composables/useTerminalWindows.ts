import { nextTick } from 'vue';
import { Terminal } from '@xterm/xterm';
import ShellContent from '~/components/ToolWindow/Shell.vue';
import * as opencodeApi from '~/utils/opencode';
import { parsePtyInfo, type PtyInfo } from '~/utils/pty';
import {
  TERM_COLUMNS,
  TERM_FONT_FAMILY,
  TERM_FONT_SIZE_PX,
  TERM_INNER_PADDING_X_PX,
  TERM_INNER_PADDING_Y_PX,
  TERM_LINE_HEIGHT,
  TERM_ROWS,
  TERM_TITLEBAR_HEIGHT_PX,
  TERM_WINDOW_BORDER_PX,
} from '~/utils/terminalMetrics';
import { defineFeature } from './useAppContext';
import { useFileTree } from './useFileTree';
import { getTerminalWindowSize, useFloatingCanvas } from './useFloatingCanvas';

const SHELL_LINGER_MS = 1000;
const SHELL_KEY_PREFIX = 'shell:';
/** ANSI red, used for the failed-command notice written into the terminal. */
const ANSI_RED = '\u001b[31m';
const ANSI_RESET = '\u001b[0m';

type ShellSession = {
  pty: PtyInfo;
  terminal: Terminal;
  socket?: WebSocket;
  exiting?: boolean;
  closeOnSuccess?: boolean;
};

export type PtyEvent = {
  type: 'pty.created' | 'pty.updated' | 'pty.exited';
  info: PtyInfo | null;
  id?: string;
  exitCode?: number;
};

function getTerminalCellSize(terminal: Terminal): { width: number; height: number } | null {
  // Prefer measuring from the rendered screen (most accurate)
  const termEl = terminal.element;
  if (termEl && terminal.cols > 0 && terminal.rows > 0) {
    const screen = termEl.querySelector('.xterm-screen');
    if (screen) {
      const rect = screen.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return { width: rect.width / terminal.cols, height: rect.height / terminal.rows };
      }
    }
  }
  // Fallback: xterm's internal renderer dimensions
  const core = (terminal as unknown as { _core?: Record<string, never> })._core;
  const dims = (
    core as unknown as
      | { _renderService?: { dimensions?: { css?: { cell?: { width: number; height: number } } } } }
      | undefined
  )?._renderService?.dimensions?.css?.cell;
  if (dims && dims.width > 0 && dims.height > 0) {
    return { width: dims.width, height: dims.height };
  }
  return null;
}

/**
 * Embedded shell windows: one xterm.js Terminal per OpenCode PTY, connected
 * over WebSocket, sized to the floating window, and cleaned up on exit.
 */
export const useTerminalWindows = defineFeature('terminalWindows', (context) => {
  const { fw, selection } = context;
  const { activeDirectory } = selection;
  const { canvasEl, getRandomWindowPosition } = useFloatingCanvas(context);

  const sessionsByPtyId = new Map<string, ShellSession>();
  const pendingFits = new Set<string>();
  const exitWaiters = new Map<string, (exitCode: number) => void>();
  const metaDecoder = new TextDecoder();
  let shellDirectory = '';

  async function fetchPtyList(directory?: string) {
    const data = await opencodeApi.listPtys(directory);
    if (!Array.isArray(data)) return [] as PtyInfo[];
    return data.map(parsePtyInfo).filter((pty): pty is PtyInfo => Boolean(pty));
  }

  async function createPtySession(command?: string, args?: string[]) {
    const directory = activeDirectory.value || undefined;
    const data = await opencodeApi.createPty({
      directory,
      command,
      args,
      cwd: directory,
      title: 'Shell',
    });
    return parsePtyInfo(data);
  }

  function notifyPtySize(session: ShellSession) {
    const { rows, cols } = session.terminal;
    if (rows <= 0 || cols <= 0) return;
    const directory = session.pty.cwd || activeDirectory.value || undefined;
    opencodeApi.updatePtySize(session.pty.id, { directory, rows, cols }).catch(() => {});
  }

  function fitTerminalToContainer(session: ShellSession): boolean {
    const termEl = session.terminal.element;
    if (!termEl?.isConnected) return false;
    const parent = termEl.parentElement;
    if (!parent) return false;
    const parentRect = parent.getBoundingClientRect();
    if (parentRect.width <= 0 || parentRect.height <= 0) return false;
    const cell = getTerminalCellSize(session.terminal);
    if (!cell) return false;
    const viewport = termEl.querySelector('.xterm-viewport') as HTMLElement | null;
    const scrollbarWidth = viewport ? viewport.offsetWidth - viewport.clientWidth : 0;
    const cols = Math.max(2, Math.floor((parentRect.width - scrollbarWidth) / cell.width));
    const rows = Math.max(1, Math.floor(parentRect.height / cell.height));
    if (cols !== session.terminal.cols || rows !== session.terminal.rows) {
      session.terminal.resize(cols, rows);
    }
    return true;
  }

  /** Re-fit a terminal to its window over a few frames until the size settles. */
  function scheduleShellFit(ptyId: string) {
    if (pendingFits.has(ptyId)) return;
    pendingFits.add(ptyId);
    nextTick(() => {
      pendingFits.delete(ptyId);
      const session = sessionsByPtyId.get(ptyId);
      if (!session) return;
      let prevCols = -1;
      let prevRows = -1;
      let attempts = 0;
      const tick = () => {
        if (attempts >= 30 || !session.terminal.element?.isConnected) {
          notifyPtySize(session);
          return;
        }
        attempts++;
        fitTerminalToContainer(session);
        const { cols, rows } = session.terminal;
        if (cols === prevCols && rows === prevRows) {
          notifyPtySize(session);
          return;
        }
        prevCols = cols;
        prevRows = rows;
        requestAnimationFrame(tick);
      };
      tick();
    });
  }

  function scheduleShellFitAll() {
    sessionsByPtyId.forEach((_, ptyId) => scheduleShellFit(ptyId));
  }

  function resizeWindowToFitTerminal(key: string, terminal: Terminal) {
    const cell = getTerminalCellSize(terminal);
    if (!cell) return;
    const viewport = terminal.element?.querySelector('.xterm-viewport') as HTMLElement | null;
    const scrollbarWidth = viewport ? viewport.offsetWidth - viewport.clientWidth : 0;
    const contentWidth = terminal.cols * cell.width + scrollbarWidth;
    const contentHeight = terminal.rows * cell.height;
    // Window chrome from known CSS values: border 1px per side, titlebar 22px plus a
    // 1px border, body padding 2px vertical / 4px horizontal.
    const chromeX = TERM_WINDOW_BORDER_PX + 2 * TERM_INNER_PADDING_X_PX;
    const chromeY = TERM_WINDOW_BORDER_PX + TERM_TITLEBAR_HEIGHT_PX + 1 + TERM_INNER_PADDING_Y_PX;
    fw.updateOptions(key, {
      width: Math.ceil(contentWidth + chromeX),
      height: Math.ceil(contentHeight + chromeY),
    });
    const session = sessionsByPtyId.get(key.slice(SHELL_KEY_PREFIX.length));
    if (session) notifyPtySize(session);
  }

  function removeShellWindow(ptyId: string, options?: { kill?: boolean }) {
    const session = sessionsByPtyId.get(ptyId);
    if (!session) return;
    pendingFits.delete(ptyId);
    session.socket?.close();
    session.terminal.dispose();
    sessionsByPtyId.delete(ptyId);
    exitWaiters.delete(ptyId);
    fw.close(`${SHELL_KEY_PREFIX}${ptyId}`);
    if (options?.kill) {
      const directory = session.pty.cwd || activeDirectory.value || undefined;
      opencodeApi.deletePty(ptyId, directory).catch(() => {});
    }
  }

  function lingerAndRemoveShellWindow(ptyId: string) {
    const session = sessionsByPtyId.get(ptyId);
    if (!session || session.exiting) return;
    session.exiting = true;
    session.terminal.options.cursorBlink = false;
    // If the socket is already closed, linger now; otherwise its close handler does it
    // once all data has been flushed.
    if (!session.socket || session.socket.readyState >= WebSocket.CLOSING) {
      setTimeout(() => removeShellWindow(ptyId), SHELL_LINGER_MS);
    }
  }

  function isCursorOnlyMeta(json: string): boolean {
    try {
      const meta = JSON.parse(json) as Record<string, unknown>;
      const keys = Object.keys(meta);
      return (
        keys.length === 1 &&
        keys[0] === 'cursor' &&
        typeof meta.cursor === 'number' &&
        Number.isSafeInteger(meta.cursor) &&
        meta.cursor >= 0
      );
    } catch {
      return false;
    }
  }

  function connectShellSocket(ptyId: string) {
    const session = sessionsByPtyId.get(ptyId);
    if (!session) return;
    const directory = session.pty.cwd || activeDirectory.value || undefined;
    const socket = new WebSocket(opencodeApi.createWsUrl(`/pty/${ptyId}/connect`, { directory }));
    session.socket = socket;
    socket.binaryType = 'arraybuffer';
    socket.addEventListener('message', (event) => {
      if (event.data instanceof ArrayBuffer) {
        const bytes = new Uint8Array(event.data);
        // A leading NUL byte marks a JSON metadata frame (cursor position), never output.
        if (bytes.length > 0 && bytes[0] === 0) {
          metaDecoder.decode(bytes.subarray(1));
          return;
        }
        session.terminal.write(bytes);
        return;
      }
      if (typeof event.data === 'string') {
        const trimmed = event.data.trim();
        if (trimmed.startsWith('{') && trimmed.endsWith('}') && isCursorOnlyMeta(trimmed)) return;
        session.terminal.write(event.data);
      }
    });
    socket.addEventListener('open', () => {
      // focus() requires the terminal to be mounted; defer if not yet attached.
      if (session.terminal.element) session.terminal.focus();
      else nextTick(() => session.terminal.focus());
    });
    session.terminal.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(data);
    });
    socket.addEventListener('close', () => {
      if (session.exiting) setTimeout(() => removeShellWindow(ptyId), SHELL_LINGER_MS);
    });
  }

  function ensureShellWindow(pty: PtyInfo) {
    if (sessionsByPtyId.has(pty.id)) return;
    const key = `${SHELL_KEY_PREFIX}${pty.id}`;
    const { width, height } = getTerminalWindowSize();
    const randomPosition = getRandomWindowPosition({ width, height });
    fw.open(key, {
      component: ShellContent,
      props: { shellId: pty.id },
      closable: true,
      resizable: true,
      scroll: 'none',
      color: '#a855f7',
      title: pty.title || 'Shell',
      width,
      height,
      x: randomPosition.x,
      y: randomPosition.y,
      expiry: Infinity,
      onResize: () => scheduleShellFit(pty.id),
    });
    const terminal = new Terminal({
      cols: TERM_COLUMNS,
      rows: TERM_ROWS,
      fontFamily: TERM_FONT_FAMILY,
      fontSize: TERM_FONT_SIZE_PX,
      lineHeight: TERM_LINE_HEIGHT,
      cursorBlink: true,
      theme: {
        background: '#050505',
        foreground: '#e2e8f0',
        cursor: '#e2e8f0',
        selectionBackground: 'rgba(148, 163, 184, 0.3)',
      },
    });
    sessionsByPtyId.set(pty.id, { pty, terminal });
    // Connect immediately so the server's buffer replay arrives before a fast-exiting
    // command deletes the session; xterm buffers write() calls made before open().
    connectShellSocket(pty.id);
    nextTick(() => {
      const host = canvasEl.value?.querySelector(
        `[data-shell-id="${pty.id}"]`,
      ) as HTMLElement | null;
      if (!host) return;
      terminal.open(host);
      // Wait for first paint so xterm has rendered cell dimensions
      requestAnimationFrame(() => resizeWindowToFitTerminal(key, terminal));
    });
  }

  /** Returns true when `key` was a shell window and has been handled. */
  function onWindowClosed(key: string): boolean {
    if (!key.startsWith(SHELL_KEY_PREFIX)) return false;
    removeShellWindow(key.slice(SHELL_KEY_PREFIX.length), { kill: true });
    return true;
  }

  function disposeShellWindows() {
    Array.from(sessionsByPtyId.keys()).forEach((ptyId) => removeShellWindow(ptyId));
  }

  /** Re-open windows for PTYs still running on the server in the active directory. */
  async function restoreShellSessions() {
    const directory = activeDirectory.value || '';
    const sandboxChanged = directory !== shellDirectory;
    shellDirectory = directory;
    if (sandboxChanged) disposeShellWindows();
    try {
      const ptys = await fetchPtyList(directory || undefined);
      ptys.forEach((pty) => {
        if (pty.status === 'exited') return;
        if (pty.title === 'One-shot PTY' || pty.title === 'Commit Snapshot') return;
        ensureShellWindow(pty);
      });
    } catch {
      // Restoring windows is best effort.
    }
  }

  async function openShellFromInput(input: string) {
    const script = input.trim();
    const hasCommand = script.length > 0;
    const pty = hasCommand
      ? await createPtySession('/bin/sh', ['-c', script])
      : await createPtySession();
    if (!pty) return;
    ensureShellWindow(pty);
    if (!hasCommand) return;
    const session = sessionsByPtyId.get(pty.id);
    if (session) session.closeOnSuccess = true;
  }

  /** Run a command in a shell window and refresh git state when it succeeds. */
  async function runTreeShellCommand(command: string) {
    const script = command.trim();
    if (!script) return;
    const pty = await createPtySession('/bin/sh', ['-c', script]);
    if (!pty) return;
    ensureShellWindow(pty);
    const session = sessionsByPtyId.get(pty.id);
    if (session) session.closeOnSuccess = true;
    const exitCode = await new Promise<number>((resolve) => {
      exitWaiters.set(pty.id, resolve);
    });
    if (exitCode === 0) {
      const { refreshGitStatus, refreshBranchEntries } = useFileTree();
      void refreshGitStatus();
      void refreshBranchEntries();
    }
  }

  function handlePtyEvent(event: PtyEvent) {
    const ptyId = event.id ?? event.info?.id;
    if (!ptyId || !sessionsByPtyId.has(ptyId)) return;
    if (event.type === 'pty.exited') {
      const exitCode = typeof event.exitCode === 'number' ? event.exitCode : -1;
      const waiter = exitWaiters.get(ptyId);
      if (waiter) {
        exitWaiters.delete(ptyId);
        waiter(exitCode);
      }
      const session = sessionsByPtyId.get(ptyId);
      if (session?.closeOnSuccess && exitCode !== 0) {
        session.terminal.write(`\r\n${ANSI_RED}[Command failed: ${exitCode}]${ANSI_RESET}\r\n`);
        return;
      }
      lingerAndRemoveShellWindow(ptyId);
      return;
    }
    if (event.info) {
      const existing = sessionsByPtyId.get(event.info.id);
      if (existing) {
        existing.pty = event.info;
        if (event.info.title) fw.setTitle(`${SHELL_KEY_PREFIX}${event.info.id}`, event.info.title);
      }
      if (event.info.status === 'exited') {
        if (existing?.closeOnSuccess) return;
        lingerAndRemoveShellWindow(event.info.id);
      }
    }
  }

  return {
    scheduleShellFitAll,
    /** A PTY vanished server-side: let its window linger briefly, then drop it. */
    handlePtyDeleted: lingerAndRemoveShellWindow,
    onWindowClosed,
    disposeShellWindows,
    restoreShellSessions,
    openShellFromInput,
    runTreeShellCommand,
    handlePtyEvent,
  };
});
