import { computed, onScopeDispose, ref, watch } from 'vue';
import type { TopPanelNotificationSession } from '~/components/TopPanel.vue';
import { defineFeature } from './useAppContext';

export type SessionLabelResolver = (projectId: string, sessionId: string) => string | undefined;

/**
 * Pending-attention notifications: the ordered list shown in the header, the
 * browser Notification API bridge, and telling the worker which session the
 * user is currently looking at (so it does not notify about it).
 */
export const useBrowserNotifications = defineFeature(
  'browserNotifications',
  ({ serverState, selection, ge }) => {
    const { selectedProjectId, selectedSessionId, switchSession } = selection;
    const notificationSessionOrder = ref<string[]>([]);
    const permissionRequested = ref(false);
    // Set by the session catalog so notification bodies can name the session.
    let resolveSessionLabel: SessionLabelResolver = () => undefined;

    function setSessionLabelResolver(resolver: SessionLabelResolver) {
      resolveSessionLabel = resolver;
    }

    const notificationSessions = computed<TopPanelNotificationSession[]>(() =>
      notificationSessionOrder.value
        .map((key) => {
          const entry = serverState.notifications[key];
          if (!entry) return null;
          return {
            projectId: entry.projectId,
            sessionId: entry.sessionId,
            count: entry.requestIds.length,
          };
        })
        .filter((item): item is TopPanelNotificationSession => Boolean(item))
        .filter((item) => item.count > 0),
    );

    watch(
      () => serverState.notifications,
      (notifications) => {
        const keys = Object.keys(notifications);
        const keep = notificationSessionOrder.value.filter((key) => keys.includes(key));
        const next = keys.filter((key) => !keep.includes(key));
        notificationSessionOrder.value = [...keep, ...next];
      },
      { immediate: true, deep: true },
    );

    /** The window is visible AND focused: the user is likely paying attention. */
    function isWindowAttentive(): boolean {
      if (typeof document === 'undefined') return true;
      return !document.hidden && document.hasFocus();
    }

    function syncActiveSelectionToWorker() {
      ge.sendToWorker({
        type: 'selection.active',
        projectId: isWindowAttentive() ? selectedProjectId.value : '',
        sessionId: isWindowAttentive() ? selectedSessionId.value : '',
      });
    }

    function ensureBrowserNotificationPermission() {
      if (typeof window === 'undefined' || typeof Notification === 'undefined') return;
      if (Notification.permission !== 'default') return;
      if (permissionRequested.value) return;
      permissionRequested.value = true;
      void Notification.requestPermission();
    }

    function showBrowserNotification(
      projectId: string,
      sessionId: string,
      type: 'permission' | 'question' | 'idle',
    ) {
      if (typeof window === 'undefined' || typeof document === 'undefined') return;
      if (typeof Notification === 'undefined') return;
      if (isWindowAttentive()) return;
      if (Notification.permission !== 'granted') return;
      const label = resolveSessionLabel(projectId, sessionId);
      const kind =
        type === 'permission' ? 'Permission' : type === 'question' ? 'Question' : 'Session idle';
      const body =
        type === 'idle'
          ? label
            ? `${label} is now idle.`
            : `Session ${sessionId} is now idle.`
          : label
            ? `${label} requires your response.`
            : `Session ${sessionId} requires your response.`;
      const notification = new Notification(`${kind}`, {
        body,
        tag: `vis-${type}-${projectId}-${sessionId}`,
      });
      notification.onclick = () => {
        window.focus();
        void switchSession(projectId.trim(), sessionId.trim());
        notification.close();
      };
    }

    /** Jump to the next session that needs attention (header bell button). */
    function selectNextNotificationSession() {
      const queue = notificationSessionOrder.value.filter((key) => {
        const entry = serverState.notifications[key];
        return Boolean(entry && entry.requestIds.length > 0);
      });
      if (queue.length === 0) return;
      const currentSessionId = selectedSessionId.value;
      const nextKey = queue.find((key) => key !== currentSessionId) ?? queue[0];
      if (!nextKey) return;
      const entry = serverState.notifications[nextKey];
      if (!entry) return;
      const targetProjectId = entry.projectId.trim();
      const targetSessionId = entry.sessionId.trim();

      // Optimistically clear idle-only notifications when re-targeting the current session.
      // The worker's authoritative `state.notifications-updated` will reconcile shortly.
      if (targetSessionId === currentSessionId) {
        const idleOnly = entry.requestIds.every((id) => id.startsWith('idle:'));
        if (idleOnly) delete serverState.notifications[nextKey];
      }

      void switchSession(targetProjectId, targetSessionId).finally(() => {
        // Always re-sync to the worker so it can clear stale idle notifications even when
        // the target equals the current selection (no ref change, so no watcher trigger).
        syncActiveSelectionToWorker();
      });
    }

    serverState.setNotificationShowHandler((message) => {
      showBrowserNotification(message.projectId, message.sessionId, message.kind);
    });
    watch([selectedProjectId, selectedSessionId], syncActiveSelectionToWorker, {
      immediate: true,
    });

    if (typeof window !== 'undefined') {
      document.addEventListener('visibilitychange', syncActiveSelectionToWorker);
      window.addEventListener('focus', syncActiveSelectionToWorker);
      window.addEventListener('blur', syncActiveSelectionToWorker);
      onScopeDispose(() => {
        document.removeEventListener('visibilitychange', syncActiveSelectionToWorker);
        window.removeEventListener('focus', syncActiveSelectionToWorker);
        window.removeEventListener('blur', syncActiveSelectionToWorker);
      });
    }

    return {
      notificationSessionOrder,
      notificationSessions,
      setSessionLabelResolver,
      isWindowAttentive,
      syncActiveSelectionToWorker,
      ensureBrowserNotificationPermission,
      showBrowserNotification,
      selectNextNotificationSession,
    };
  },
);
