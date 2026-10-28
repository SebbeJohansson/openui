import { ref } from 'vue';
import { defineFeature } from './useAppContext';

export type UiInitState = 'loading' | 'ready' | 'error' | 'login';
export type ConnectionPhase = 'connecting' | 'bootstrapping' | 'ready' | 'reconnecting' | 'error';

/**
 * The two state machines that gate the whole UI: `uiInitState` decides whether
 * the login screen, the loading screen or the app shell is shown, and
 * `connectionState` tracks the live SSE connection. Kept separate from the
 * bootstrap logic so any feature can ask "are we connected?" without pulling
 * the initialization sequence in with it.
 */
export const useConnectionState = defineFeature('connectionState', ({ sendStatus }) => {
  const uiInitState = ref<UiInitState>('loading');
  const connectionState = ref<ConnectionPhase>('connecting');
  const initLoadingMessage = ref('Connecting to server...');
  const initErrorMessage = ref('');
  const reconnectingMessage = ref('');
  /** True while the bootstrap sequence runs; suppresses directory-change side effects. */
  const isBootstrapping = ref(false);

  /**
   * Guard for actions that need a live connection. Reports why the action is
   * unavailable through the status line and returns false.
   */
  function ensureConnectionReady(action: string) {
    if (connectionState.value === 'ready' && uiInitState.value === 'ready') return true;
    if (connectionState.value === 'reconnecting') {
      sendStatus.value = `Reconnecting... ${action} is temporarily disabled.`;
    } else if (uiInitState.value === 'loading') {
      sendStatus.value = `Still loading. ${action} is temporarily disabled.`;
    } else {
      sendStatus.value = `Not connected. ${action} is unavailable.`;
    }
    return false;
  }

  return {
    uiInitState,
    connectionState,
    initLoadingMessage,
    initErrorMessage,
    reconnectingMessage,
    isBootstrapping,
    ensureConnectionReady,
  };
});
