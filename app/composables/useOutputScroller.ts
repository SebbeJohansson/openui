import { computed, nextTick, ref } from 'vue';
import { defineFeature } from './useAppContext';
import { useAutoScroller, type ScrollMode } from './useAutoScroller';
import { useFloatingCanvas } from './useFloatingCanvas';
import { useShellLayout } from './useShellLayout';

const FOLLOW_THRESHOLD_PX = 24;

/**
 * Follow-the-tail scrolling for the chat output panel, plus the handlers the
 * panel emits into. Tracking is paused while the trajectory tab is showing,
 * because a hidden element reports no scroll height and would otherwise be
 * read as "the user scrolled away from the bottom".
 */
export const useOutputScroller = defineFeature('outputScroller', (context) => {
  const { uiHooks } = context;
  const { syncFloatingExtent } = useFloatingCanvas(context);
  const layout = useShellLayout(context);

  const panelRef = ref<{ panelEl: HTMLDivElement | null } | null>(null);
  const bindPanelRef = (instance: unknown) => {
    panelRef.value = (instance as { panelEl: HTMLDivElement | null } | null) ?? null;
  };
  const containerEl = computed(() => panelRef.value?.panelEl ?? undefined);
  const scrollMode = computed<ScrollMode>(() => 'follow');

  const scroller = useAutoScroller(containerEl, scrollMode, {
    bottomThresholdPx: FOLLOW_THRESHOLD_PX,
    observeDelayMs: 0,
    smoothEngine: 'native',
    smoothOnInitialFollow: false,
  });

  layout.onMainTabChange((value) => {
    if (value === 'chat') {
      const wasFollowing = scroller.isFollowing.value;
      nextTick(() => {
        scroller.resumeTracking({ syncToBottom: wasFollowing });
        syncFloatingExtent();
      });
      return;
    }
    scroller.pauseTracking();
  });

  // Restored straight into the trajectory tab: the chat panel starts hidden.
  if (layout.mainTab.value === 'trajectory') scroller.pauseTracking();

  function handleInitialRenderComplete() {
    nextTick(() => {
      scroller.scrollToBottom(false);
      syncFloatingExtent();
      uiHooks.focusComposer();
    });
  }

  function handleContentChange() {
    scroller.notifyContentChange();
  }

  return {
    panelRef,
    bindPanelRef,
    containerEl,
    isFollowing: scroller.isFollowing,
    pauseTracking: scroller.pauseTracking,
    resumeTracking: scroller.resumeTracking,
    enableFollow: scroller.enableFollow,
    resetFollow: scroller.resetFollow,
    resumeFollow: scroller.resumeFollow,
    scrollToBottom: scroller.scrollToBottom,
    notifyContentChange: scroller.notifyContentChange,
    handleInitialRenderComplete,
    handleContentChange,
  };
});
