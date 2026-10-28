// @vitest-environment nuxt
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mountAppContext, projectState } from '../../test/nuxt/app-context';
import { useAppBootstrap } from './useAppBootstrap';
import type { AppContext } from './useAppContext';
import { useConnectionState } from './useConnectionState';

const OPENCODE_URL = 'http://localhost:4096';

type Call = { method: string; url: string };

const mounted: Array<() => void> = [];
let requests: Call[];
let routes: Record<string, unknown>;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function installFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ method: init?.method ?? 'GET', url });
      const key = Object.keys(routes).find((route) => url === route || url.startsWith(`${route}?`));
      if (!key) return Promise.resolve(jsonResponse({ error: 'not found' }, 404));
      return Promise.resolve(jsonResponse(routes[key]));
    }),
  );
}

/**
 * Mount the bootstrap feature without letting it start up: /api/config 404s
 * and localStorage is empty, so it settles on the login screen. Credentials are
 * saved afterwards so the API helpers point at the stubbed server, which lets a
 * test drive the startup watchers by hand.
 */
async function bootstrappedContext(): Promise<AppContext> {
  const Host = defineComponent({
    name: 'AppBootstrapTestHost',
    setup() {
      useAppBootstrap();
      return () => h('div');
    },
  });
  const { context, unmount } = await mountAppContext({ slot: Host });
  mounted.push(unmount);
  context.msg.reset();
  await vi.waitFor(() => expect(useConnectionState(context).uiInitState.value).toBe('login'));
  context.credentials.save(OPENCODE_URL, '', '');
  await nextTick();
  requests.length = 0;
  return context;
}

function twoProjects(context: AppContext) {
  context.serverState.projects.pa = projectState('pa', '/a', ['ses_a']) as never;
  context.serverState.projects.pb = projectState('pb', '/b', ['ses_b']) as never;
  routes[`${OPENCODE_URL}/session/ses_a/message`] = [];
  routes[`${OPENCODE_URL}/session/ses_b/message`] = [];
}

/** GETs only, so a one-shot PTY created elsewhere is not mistaken for a listing. */
function loads(path: string) {
  const prefix = `${OPENCODE_URL}${path}`;
  return requests
    .filter((call) => call.method === 'GET')
    .map((call) => call.url)
    .filter((url) => url === prefix || url.startsWith(`${prefix}?`));
}

/**
 * Switch session and wait for the resulting session reload to go quiet, so a
 * later assertion cannot be satisfied by that reload's own requests. Focusing
 * the composer is the reload's last step, which makes it the completion signal.
 */
async function selectAndSettle(context: AppContext, projectId: string, sessionId: string) {
  const restore = context.uiHooks.focusComposer;
  let reloads = 0;
  context.uiHooks.focusComposer = () => {
    reloads += 1;
  };
  await context.selection.switchSession(projectId, sessionId);
  await vi.waitFor(async () => {
    const seen = reloads;
    expect(seen).toBeGreaterThan(0);
    await nextTick();
    await nextTick();
    expect(reloads).toBe(seen);
  });
  context.uiHooks.focusComposer = restore;
  requests.length = 0;
}

beforeEach(() => {
  requests = [];
  routes = {};
  localStorage.clear();
  installFetch();
});

afterEach(() => {
  while (mounted.length) mounted.pop()?.();
  vi.unstubAllGlobals();
});

describe('becoming ready', () => {
  it('restores the saved shell windows once the app shell is up', async () => {
    // Regression guard: reloadSelectedSessionState only restores shells while
    // uiInitState is already 'ready', which it never is during startup, so
    // without this watcher shell windows were lost on every page load.
    const context = await bootstrappedContext();
    twoProjects(context);
    routes[`${OPENCODE_URL}/pty`] = [];
    await selectAndSettle(context, 'pa', 'ses_a');
    // The selection reset itself only restores shells once the UI is ready.
    expect(loads('/pty')).toEqual([]);

    useConnectionState(context).uiInitState.value = 'ready';

    await vi.waitFor(() => {
      const url = loads('/pty').at(-1);
      expect(url && new URL(url).searchParams.get('directory')).toBe('/a');
    });
  });

  it('does not restore shells while the UI is still loading', async () => {
    const context = await bootstrappedContext();
    twoProjects(context);
    routes[`${OPENCODE_URL}/pty`] = [];

    await selectAndSettle(context, 'pa', 'ses_a');

    useConnectionState(context).uiInitState.value = 'loading';
    await nextTick();
    await nextTick();

    expect(loads('/pty')).toEqual([]);
  });
});

describe('active directory changes', () => {
  it('reloads the slash commands for the new worktree', async () => {
    const context = await bootstrappedContext();
    twoProjects(context);
    routes[`${OPENCODE_URL}/command`] = [];
    await context.selection.switchSession('pa', 'ses_a');
    await vi.waitFor(() => expect(loads('/command').length).toBeGreaterThan(0));
    requests.length = 0;

    await context.selection.switchSession('pb', 'ses_b');

    await vi.waitFor(() => {
      const url = loads('/command').at(-1);
      expect(url && new URL(url).searchParams.get('directory')).toBe('/b');
    });
  });

  it('stays quiet while the bootstrap owns the selection', async () => {
    const context = await bootstrappedContext();
    twoProjects(context);
    routes[`${OPENCODE_URL}/command`] = [];
    useConnectionState(context).isBootstrapping.value = true;

    await context.selection.switchSession('pa', 'ses_a');
    await nextTick();
    await nextTick();

    expect(loads('/command')).toEqual([]);
  });
});
