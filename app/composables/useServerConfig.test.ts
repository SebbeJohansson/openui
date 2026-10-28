// @vitest-environment nuxt
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountAppContext } from '../../test/nuxt/app-context';
import type { AppContext } from './useAppContext';
import { useServerConfig } from './useServerConfig';

const mounted: Array<() => void> = [];
let requested: string[];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mockFetch(handler: (url: string) => Response | Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url);
      return Promise.resolve(handler(url));
    }),
  );
}

async function freshContext(): Promise<AppContext> {
  const { context, unmount } = await mountAppContext();
  mounted.push(unmount);
  return context;
}

beforeEach(() => {
  requested = [];
  localStorage.clear();
});

afterEach(() => {
  while (mounted.length) mounted.pop()?.();
  vi.unstubAllGlobals();
});

describe('load', () => {
  it('reads the config and reports that the server configured the connection', async () => {
    mockFetch(() =>
      jsonResponse({
        openCodeUrl: 'http://localhost:4096',
        claudeEnabled: true,
        claudeApiBase: '/api/claude',
      }),
    );
    const context = await freshContext();
    const config = useServerConfig(context);

    await expect(config.load()).resolves.toBe(true);

    expect(requested).toEqual(['/api/config']);
    expect(config.serverConfig.value).toEqual({
      openCodeUrl: 'http://localhost:4096',
      claudeEnabled: true,
      claudeApiBase: '/api/claude',
    });
    // The OpenCode URL from the server wins over anything stored locally.
    expect(context.credentials.url.value).toBe('http://localhost:4096');
  });

  it('fills in defaults for a partial response', async () => {
    mockFetch(() => jsonResponse({}));
    const config = useServerConfig(await freshContext());

    await expect(config.load()).resolves.toBe(false);

    expect(config.serverConfig.value).toEqual({
      openCodeUrl: null,
      claudeEnabled: false,
      claudeApiBase: null,
    });
  });

  it('reports no server config when the route 404s', async () => {
    mockFetch(() => jsonResponse({ error: 'nope' }, 404));
    const config = useServerConfig(await freshContext());

    await expect(config.load()).resolves.toBe(false);
    expect(config.serverConfig.value).toBeNull();
  });

  it('ignores a 200 that is not JSON, which is how a static host serves the SPA shell', async () => {
    mockFetch(() => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }));
    const config = useServerConfig(await freshContext());

    await expect(config.load()).resolves.toBe(false);
    expect(config.serverConfig.value).toBeNull();
  });

  it('swallows a network failure', async () => {
    mockFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    const config = useServerConfig(await freshContext());

    await expect(config.load()).resolves.toBe(false);
    expect(config.serverConfig.value).toBeNull();
  });

  it('does not save credentials when the server supplies no OpenCode url', async () => {
    mockFetch(() => jsonResponse({ openCodeUrl: null, claudeEnabled: false }));
    const context = await freshContext();
    context.credentials.save('http://stored:4096', '', '');

    await expect(useServerConfig(context).load()).resolves.toBe(false);

    expect(context.credentials.url.value).toBe('http://stored:4096');
  });

  it('requests /api/config relative to the app base url', async () => {
    // baseURL is '/' in tests; assert the join produces no double slash.
    mockFetch(() => jsonResponse({}));
    await useServerConfig(await freshContext()).load();
    expect(requested[0]).toBe('/api/config');
  });
});

describe('claudeEnabled / claudeApiUrl', () => {
  it('is disabled before the config loads', async () => {
    const config = useServerConfig(await freshContext());

    expect(config.claudeEnabled.value).toBe(false);
    expect(config.claudeApiBase.value).toBe('');
    expect(() => config.claudeApiUrl('/sessions')).toThrow(
      'Claude Code support is not enabled on this server.',
    );
  });

  it('builds same-origin urls under the base the server reported', async () => {
    mockFetch(() =>
      jsonResponse({ openCodeUrl: null, claudeEnabled: true, claudeApiBase: '/openui/api/claude' }),
    );
    const config = useServerConfig(await freshContext());
    await config.load();

    expect(config.claudeEnabled.value).toBe(true);
    expect(config.claudeApiUrl('/sessions')).toBe('/openui/api/claude/sessions');
    expect(config.claudeApiUrl('/sessions/abc/messages')).toBe(
      '/openui/api/claude/sessions/abc/messages',
    );
  });

  it('still refuses to build a url when claude is on but no base came back', async () => {
    mockFetch(() => jsonResponse({ claudeEnabled: true, claudeApiBase: null }));
    const config = useServerConfig(await freshContext());
    await config.load();

    expect(config.claudeEnabled.value).toBe(true);
    expect(() => config.claudeApiUrl('/sessions')).toThrow(
      'Claude Code support is not enabled on this server.',
    );
  });
});

describe('feature identity', () => {
  it('is one instance per app context', async () => {
    const context = await freshContext();
    expect(useServerConfig(context)).toBe(useServerConfig(context));

    const other = await freshContext();
    expect(useServerConfig(other)).not.toBe(useServerConfig(context));
  });
});
