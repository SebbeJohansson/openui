// @vitest-environment nuxt
import { afterEach, describe, expect, it } from 'vitest';
import { mountAppContext } from '../../test/nuxt/app-context';
import type { AppContext } from './useAppContext';
import { useConnectionState } from './useConnectionState';

const mounted: Array<() => void> = [];

async function freshContext(): Promise<AppContext> {
  const { context, unmount } = await mountAppContext();
  mounted.push(unmount);
  return context;
}

afterEach(() => {
  while (mounted.length) mounted.pop()?.();
});

describe('initial state', () => {
  it('starts on the loading screen with a connecting connection', async () => {
    const state = useConnectionState(await freshContext());

    expect(state.uiInitState.value).toBe('loading');
    expect(state.connectionState.value).toBe('connecting');
    expect(state.initLoadingMessage.value).toBe('Connecting to server...');
    expect(state.initErrorMessage.value).toBe('');
    expect(state.reconnectingMessage.value).toBe('');
    expect(state.isBootstrapping.value).toBe(false);
  });
});

describe('ensureConnectionReady', () => {
  it('allows the action only when both machines are ready', async () => {
    const context = await freshContext();
    const state = useConnectionState(context);
    state.connectionState.value = 'ready';
    state.uiInitState.value = 'ready';
    context.sendStatus.value = 'Ready';

    expect(state.ensureConnectionReady('Send')).toBe(true);
    expect(context.sendStatus.value).toBe('Ready');
  });

  it('explains a reconnect through the status line', async () => {
    const context = await freshContext();
    const state = useConnectionState(context);
    state.connectionState.value = 'reconnecting';
    state.uiInitState.value = 'ready';

    expect(state.ensureConnectionReady('Send')).toBe(false);
    expect(context.sendStatus.value).toBe('Reconnecting... Send is temporarily disabled.');
  });

  it('explains that the app is still loading', async () => {
    const context = await freshContext();
    const state = useConnectionState(context);
    state.connectionState.value = 'connecting';
    state.uiInitState.value = 'loading';

    expect(state.ensureConnectionReady('New session')).toBe(false);
    expect(context.sendStatus.value).toBe('Still loading. New session is temporarily disabled.');
  });

  it('falls back to "not connected" for every other combination', async () => {
    const context = await freshContext();
    const state = useConnectionState(context);
    state.connectionState.value = 'error';
    state.uiInitState.value = 'login';

    expect(state.ensureConnectionReady('Send')).toBe(false);
    expect(context.sendStatus.value).toBe('Not connected. Send is unavailable.');
  });

  it('blocks an action when only the connection is ready', async () => {
    const context = await freshContext();
    const state = useConnectionState(context);
    state.connectionState.value = 'ready';
    state.uiInitState.value = 'loading';

    expect(state.ensureConnectionReady('Send')).toBe(false);
    expect(context.sendStatus.value).toBe('Still loading. Send is temporarily disabled.');
  });
});

describe('feature identity', () => {
  it('is shared by every feature in the same context', async () => {
    const context = await freshContext();
    expect(useConnectionState(context)).toBe(useConnectionState(context));

    const other = await freshContext();
    expect(useConnectionState(other).uiInitState).not.toBe(useConnectionState(context).uiInitState);
  });
});
