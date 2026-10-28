import { nextTick, onScopeDispose, ref, watch } from 'vue';
import { StorageKeys, storageGet, storageSet } from '~/utils/storageKeys';
import { defineFeature } from './useAppContext';

export type MainTab = 'chat' | 'trajectory';
export type SidePanelTab = 'todo' | 'tree';

export const MAIN_TABS: Array<{ id: MainTab; label: string; icon: string }> = [
  { id: 'chat', label: 'Chat', icon: 'lucide:message-square' },
  { id: 'trajectory', label: 'Trajectory', icon: 'lucide:git-commit-horizontal' },
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function readSidePanelCollapsed() {
  return storageGet(StorageKeys.state.sidePanelCollapsed) === '1';
}

function readSidePanelTab(): SidePanelTab {
  return storageGet(StorageKeys.state.sidePanelTab) === 'todo' ? 'todo' : 'tree';
}

function readMainTab(): MainTab {
  return storageGet(StorageKeys.state.mainTab) === 'trajectory' ? 'trajectory' : 'chat';
}

/**
 * Shell geometry and navigation state: side panel, main tab, mobile drawer and
 * the two drag resizers. Other features subscribe to layout changes instead of
 * being called directly, so this stays free of window/terminal knowledge.
 */
export const useShellLayout = defineFeature('shellLayout', () => {
  const mobileDrawerOpen = ref(false);
  const sidePanelCollapsed = ref(readSidePanelCollapsed());
  const sidePanelActiveTab = ref<SidePanelTab>(readSidePanelTab());
  const mainTab = ref<MainTab>(readMainTab());

  // Elements the resizers measure; bound by the shell templates via ref="...".
  const outputEl = ref<HTMLElement | null>(null);
  const inputEl = ref<HTMLElement | null>(null);
  const appBodyEl = ref<HTMLDivElement | null>(null);
  const sidePanelAreaEl = ref<HTMLDivElement | null>(null);

  const inputHeight = ref<number | null>(null);
  const sidePanelWidth = ref<number | null>(null);
  const inputResizeState = ref<{
    startY: number;
    startHeight: number;
    minHeight: number;
    maxHeight: number;
  } | null>(null);
  const sidePanelResizeState = ref<{
    startX: number;
    startWidth: number;
    minWidth: number;
    maxWidth: number;
  } | null>(null);

  // Function refs for the templates (`:ref="bindOutputEl"`): a plain `ref="name"`
  // string would need the ref in the calling component's own scope.
  const asElement = (el: unknown) => (el instanceof HTMLElement ? el : null);
  const bindOutputEl = (el: unknown) => {
    outputEl.value = asElement(el);
  };
  const bindInputEl = (el: unknown) => {
    inputEl.value = asElement(el);
  };
  const bindAppBodyEl = (el: unknown) => {
    appBodyEl.value = asElement(el) as HTMLDivElement | null;
  };
  const bindSidePanelAreaEl = (el: unknown) => {
    sidePanelAreaEl.value = asElement(el) as HTMLDivElement | null;
  };

  const layoutListeners = new Set<() => void>();
  const mainTabListeners = new Set<(tab: MainTab, previous: MainTab) => void>();

  function notifyLayoutChange() {
    layoutListeners.forEach((listener) => listener());
  }

  /** Called whenever panel sizes change (drag, collapse). */
  function onLayoutChange(listener: () => void) {
    layoutListeners.add(listener);
    return () => layoutListeners.delete(listener);
  }

  /** Called after the main tab switches. */
  function onMainTabChange(listener: (tab: MainTab, previous: MainTab) => void) {
    mainTabListeners.add(listener);
    return () => mainTabListeners.delete(listener);
  }

  function openMobileDrawer() {
    mobileDrawerOpen.value = true;
  }
  function closeMobileDrawer() {
    mobileDrawerOpen.value = false;
  }

  function setMainTab(value: MainTab) {
    if (mainTab.value === value) return;
    const previous = mainTab.value;
    mainTab.value = value;
    storageSet(StorageKeys.state.mainTab, value);
    mainTabListeners.forEach((listener) => listener(value, previous));
  }

  function toggleSidePanelCollapsed() {
    sidePanelCollapsed.value = !sidePanelCollapsed.value;
    sidePanelWidth.value = null;
    nextTick(notifyLayoutChange);
  }

  function setSidePanelTab(value: SidePanelTab) {
    if (sidePanelActiveTab.value === value) return;
    sidePanelActiveTab.value = value;
  }

  watch(sidePanelCollapsed, (value) => {
    storageSet(StorageKeys.state.sidePanelCollapsed, value ? '1' : '0');
  });
  watch(sidePanelActiveTab, (value) => {
    storageSet(StorageKeys.state.sidePanelTab, value);
  });

  function startInputResize(event: PointerEvent) {
    if (event.button !== 0) return;
    const output = outputEl.value;
    const input = inputEl.value;
    if (!output || !input) return;
    const outputRect = output.getBoundingClientRect();
    const inputRect = input.getBoundingClientRect();
    const totalHeight = Math.max(0, outputRect.height + inputRect.height);
    const minOutputHeight = 180;
    const maxInputHeight = Math.max(120, totalHeight - minOutputHeight);
    const minInputHeight = Math.min(200, maxInputHeight);
    inputResizeState.value = {
      startY: event.clientY,
      startHeight: inputRect.height,
      minHeight: minInputHeight,
      maxHeight: maxInputHeight,
    };
    inputHeight.value = inputRect.height;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function startSidePanelResize(event: PointerEvent) {
    if (event.button !== 0) return;
    const body = appBodyEl.value;
    const panel = sidePanelAreaEl.value;
    if (!body || !panel) return;
    const bodyRect = body.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const style = getComputedStyle(body);
    const gap = parseFloat(style.getPropertyValue('--todo-panel-gap')) || 10;
    const currentWidth = panelRect.width;
    const minW = 160;
    const maxW = Math.max(minW, bodyRect.width * 0.5 - gap);
    sidePanelResizeState.value = {
      startX: event.clientX,
      startWidth: currentWidth,
      minWidth: minW,
      maxWidth: maxW,
    };
    sidePanelWidth.value = currentWidth;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function handlePointerMove(event: PointerEvent) {
    if (sidePanelResizeState.value) {
      const { startX, startWidth, minWidth, maxWidth } = sidePanelResizeState.value;
      sidePanelWidth.value = clamp(startWidth + (event.clientX - startX), minWidth, maxWidth);
      notifyLayoutChange();
      return;
    }
    if (inputResizeState.value) {
      const { startY, startHeight, minHeight, maxHeight } = inputResizeState.value;
      inputHeight.value = clamp(startHeight - (event.clientY - startY), minHeight, maxHeight);
      notifyLayoutChange();
    }
  }

  function handlePointerUp() {
    const wasResizing = Boolean(inputResizeState.value || sidePanelResizeState.value);
    inputResizeState.value = null;
    sidePanelResizeState.value = null;
    if (wasResizing) notifyLayoutChange();
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    onScopeDispose(() => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    });
  }

  return {
    mobileDrawerOpen,
    openMobileDrawer,
    closeMobileDrawer,
    sidePanelCollapsed,
    sidePanelActiveTab,
    mainTab,
    mainTabs: MAIN_TABS,
    setMainTab,
    toggleSidePanelCollapsed,
    setSidePanelTab,
    outputEl,
    inputEl,
    appBodyEl,
    sidePanelAreaEl,
    bindOutputEl,
    bindInputEl,
    bindAppBodyEl,
    bindSidePanelAreaEl,
    inputHeight,
    sidePanelWidth,
    startInputResize,
    startSidePanelResize,
    onLayoutChange,
    onMainTabChange,
  };
});
