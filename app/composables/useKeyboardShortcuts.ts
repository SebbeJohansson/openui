import { nextTick, onScopeDispose } from 'vue';
import { defineFeature } from './useAppContext';
import { useBrowserNotifications } from './useBrowserNotifications';
import { useComposer } from './useComposer';
import { useModals } from './useModals';
import { usePermissionRouting } from './usePermissionRouting';
import { useSessionActions } from './useSessionActions';
import { useSessionCatalog } from './useSessionCatalog';
import { useTerminalWindows } from './useTerminalWindows';

const DOUBLE_ESC_THRESHOLD = 500;
const DOUBLE_CTRL_G_THRESHOLD = 500;

/**
 * Global keyboard shortcuts: session and project navigation, new session,
 * shell, the permissions panel, and the double-tap gestures (Escape to abort,
 * Ctrl-G to jump to the next session needing attention).
 */
export const useKeyboardShortcuts = defineFeature('keyboardShortcuts', (context) => {
  const { selection, uiHooks } = context;
  const { selectedProjectId, selectedSessionId, switchSession: switchSessionSelection } = selection;
  const { navigableTree } = useSessionCatalog(context);
  const { isSettingsOpen, isProjectPickerOpen } = useModals(context);
  const { notificationSessions, selectNextNotificationSession: handleNotificationSessionSelect } =
    useBrowserNotifications(context);
  const { openToolPermissions } = usePermissionRouting(context);
  const { openShellFromInput } = useTerminalWindows(context);
  const { canAbort, abortSession } = useComposer(context);
  const { createNewSession } = useSessionActions(context);

  let lastEscTime = 0;
  let lastCtrlGTime = 0;

  function focusInput() {
    nextTick(() => uiHooks.focusComposer());
  }

  function switchSessionByDirection(delta: number) {
    const tree = navigableTree.value;
    const currentProjectId = selectedProjectId.value;
    const worktree = tree.find((w) => w.projectId === currentProjectId);
    if (!worktree) return;

    // Flatten sessions across all sandboxes in display order
    const flatSessions = worktree.sandboxes.flatMap((s) => s.sessions);
    if (flatSessions.length === 0) return;

    const currentIndex = flatSessions.findIndex((s) => s.id === selectedSessionId.value);
    if (currentIndex < 0) {
      // Current session not in navigable list — jump to first
      void switchSessionSelection(currentProjectId, flatSessions[0].id);
      return;
    }

    const nextIndex = (currentIndex + delta + flatSessions.length) % flatSessions.length;
    const target = flatSessions[nextIndex];
    if (target.id !== selectedSessionId.value) {
      void switchSessionSelection(currentProjectId, target.id);
    }
  }

  function switchProjectByDirection(delta: number) {
    const tree = navigableTree.value;
    if (tree.length === 0) return;

    const currentIndex = tree.findIndex((w) => w.projectId === selectedProjectId.value);
    const baseIndex = currentIndex < 0 ? 0 : currentIndex;
    const nextIndex = (baseIndex + delta + tree.length) % tree.length;
    const target = tree[nextIndex];
    if (!target?.projectId) return;

    // Pick the most recently updated session in the target project
    const allSessions = target.sandboxes.flatMap((s) => s.sessions);
    if (allSessions.length === 0) return;

    const best = allSessions.reduce((a, b) =>
      (a.timeUpdated ?? 0) >= (b.timeUpdated ?? 0) ? a : b,
    );
    void switchSessionSelection(target.projectId, best.id);
  }

  function handleGlobalKeydown(event: KeyboardEvent) {
    // Ctrl-A: select all content in focused div (floating window body)
    if (
      event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === 'a'
    ) {
      const active = document.activeElement;
      if (active instanceof HTMLDivElement) {
        event.stopPropagation();
        event.preventDefault();
        const selection = window.getSelection();
        if (!selection) return;
        const range = document.createRange();
        range.selectNodeContents(active);
        selection.removeAllRanges();
        selection.addRange(range);
        return;
      }
    }

    // Ctrl-;: new chat
    if (event.ctrlKey && !event.metaKey && !event.altKey && event.key === ';') {
      event.preventDefault();
      createNewSession();
      return;
    }

    // Ctrl-Shift-P: open the tool permissions panel
    if (
      event.ctrlKey &&
      event.shiftKey &&
      !event.metaKey &&
      !event.altKey &&
      event.key.toLowerCase() === 'p'
    ) {
      event.preventDefault();
      openToolPermissions();
      return;
    }

    // Ctrl-G: single = open session dropdown, double = select notification
    if (event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 'g') {
      event.preventDefault();
      const now = Date.now();
      if (now - lastCtrlGTime < DOUBLE_CTRL_G_THRESHOLD) {
        lastCtrlGTime = 0;
        uiHooks.closeSessionDropdown();
        if (notificationSessions.value.length > 0) {
          handleNotificationSessionSelect();
        }
        focusInput();
      } else {
        lastCtrlGTime = now;
        uiHooks.toggleSessionDropdown();
      }
      return;
    }

    // Alt-N: new session
    if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      createNewSession();
      return;
    }

    // Alt-O: open shell
    if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'o') {
      event.preventDefault();
      openShellFromInput('');
      return;
    }

    // Alt-Left/Right: switch session within the same project
    if (
      event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
    ) {
      event.preventDefault();
      switchSessionByDirection(event.key === 'ArrowLeft' ? 1 : -1);
      return;
    }

    // Alt-Up/Down: switch to a different project
    if (
      event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      (event.key === 'ArrowUp' || event.key === 'ArrowDown')
    ) {
      event.preventDefault();
      switchProjectByDirection(event.key === 'ArrowUp' ? -1 : 1);
      return;
    }

    if (event.key !== 'Escape') return;

    // Priority 1: Close any open modal / overlay
    if (isSettingsOpen.value) {
      isSettingsOpen.value = false;
      lastEscTime = 0;
      return;
    }
    if (isProjectPickerOpen.value) {
      isProjectPickerOpen.value = false;
      lastEscTime = 0;
      return;
    }

    // Priority 2: Double-ESC to abort
    const now = Date.now();
    if (now - lastEscTime < DOUBLE_ESC_THRESHOLD) {
      lastEscTime = 0;
      if (canAbort.value) {
        abortSession();
      }
    } else {
      lastEscTime = now;
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', handleGlobalKeydown);
    onScopeDispose(() => window.removeEventListener('keydown', handleGlobalKeydown));
  }

  return { focusInput, switchSessionByDirection, switchProjectByDirection };
});
