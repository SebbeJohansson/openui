import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OpenCodeApiError,
  createSession,
  createWsUrl,
  getPathInfo,
  listFiles,
  listSessions,
  setAuthorization,
  setBaseUrl,
} from './opencode';

type Call = { url: string; init: RequestInit | undefined };

let calls: Call[];

function respond(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(text, {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return Promise.resolve(handler(url, init));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  calls = [];
  setBaseUrl('http://localhost:4096');
  setAuthorization(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  // Reset module-level configuration for the next file/test.
  setBaseUrl('');
  setAuthorization(undefined);
});

describe('base url configuration', () => {
  it('strips trailing slashes so paths join with a single slash', async () => {
    setBaseUrl('http://localhost:4096///');
    mockFetch(() => respond({}));
    await getPathInfo();
    expect(calls[0]!.url).toBe('http://localhost:4096/path');
  });

  it('throws a clear error when no base url is configured', async () => {
    setBaseUrl('');
    mockFetch(() => respond({}));
    await expect(getPathInfo()).rejects.toThrow('OpenCode base URL is not configured.');
  });
});

describe('query building', () => {
  it('drops undefined params and keeps the rest', async () => {
    mockFetch(() => respond([]));
    await listSessions({ directory: '/w', roots: true });
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe('/session');
    expect(url.searchParams.get('directory')).toBe('/w');
    expect(url.searchParams.get('roots')).toBe('true');
    expect(url.searchParams.has('search')).toBe(false);
    expect(url.searchParams.has('limit')).toBe(false);
  });

  it('omits the query string entirely when every param is undefined', async () => {
    mockFetch(() => respond([]));
    await listSessions();
    expect(calls[0]!.url).toBe('http://localhost:4096/session');
  });

  it('url-encodes param values', async () => {
    mockFetch(() => respond([]));
    await listFiles({ directory: '/w/a b', path: 'c&d' });
    expect(calls[0]!.url).toContain('directory=%2Fw%2Fa+b');
    expect(calls[0]!.url).toContain('path=c%26d');
  });
});

describe('headers', () => {
  it('sends no headers when nothing is configured', async () => {
    mockFetch(() => respond({}));
    await getPathInfo();
    expect(calls[0]!.init?.headers).toBeUndefined();
  });

  it('adds Authorization and the directory header', async () => {
    setAuthorization('Basic abc');
    mockFetch(() => respond({}));
    await getPathInfo({ instanceDirectory: '/w' });
    expect(calls[0]!.init?.headers).toEqual({
      Authorization: 'Basic abc',
      'x-opencode-directory': '/w',
    });
  });

  it('sets a JSON content type on writes', async () => {
    mockFetch(() => respond({ id: 'ses_1' }));
    await createSession('/w');
    expect(calls[0]!.init?.method).toBe('POST');
    expect(calls[0]!.init?.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(calls[0]!.init?.body).toBe('{}');
  });
});

describe('response parsing', () => {
  it('returns null for a 204 and for an explicitly empty body', async () => {
    mockFetch(() => new Response(null, { status: 204 }));
    await expect(getPathInfo()).resolves.toBeNull();

    mockFetch(() => new Response('', { status: 200, headers: { 'content-length': '0' } }));
    await expect(getPathInfo()).resolves.toBeNull();

    mockFetch(() => new Response('   ', { status: 200 }));
    await expect(getPathInfo()).resolves.toBeNull();
  });

  it('returns the raw text when the body is not JSON', async () => {
    mockFetch(() => new Response('not json', { status: 200 }));
    await expect(getPathInfo()).resolves.toBe('not json');
  });
});

describe('OpenCodeApiError', () => {
  it('carries the path, status and server message', async () => {
    mockFetch(() => respond({ message: 'no such session' }, { status: 404 }));
    const error = await getPathInfo().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OpenCodeApiError);
    const apiError = error as OpenCodeApiError;
    expect(apiError.path).toBe('/path');
    expect(apiError.status).toBe(404);
    expect(apiError.detail).toBe('no such session');
    expect(apiError.message).toBe('/path failed (404): no such session');
  });

  it('reads the detail from error, data.message or the raw body', async () => {
    mockFetch(() => respond({ error: 'boom' }, { status: 500 }));
    await expect(getPathInfo()).rejects.toThrow('/path failed (500): boom');

    mockFetch(() => respond({ data: { message: 'nested' } }, { status: 500 }));
    await expect(getPathInfo()).rejects.toThrow('/path failed (500): nested');

    mockFetch(() => new Response('plain failure', { status: 502 }));
    await expect(getPathInfo()).rejects.toThrow('/path failed (502): plain failure');
  });

  it('omits the detail when the error body is empty', async () => {
    mockFetch(() => new Response('', { status: 500 }));
    await expect(getPathInfo()).rejects.toThrow('/path failed (500)');
  });
});

describe('createWsUrl', () => {
  it('swaps the http scheme for ws and appends the query', () => {
    expect(createWsUrl('/pty/1', { directory: '/w' })).toBe(
      'ws://localhost:4096/pty/1?directory=%2Fw',
    );
  });

  it('upgrades https to wss', () => {
    setBaseUrl('https://remote.example');
    expect(createWsUrl('/pty/1')).toBe('wss://remote.example/pty/1');
  });

  it('embeds credentials when given', () => {
    const url = new URL(createWsUrl('/pty/1', undefined, { username: 'u', password: 'p' }));
    expect(url.username).toBe('u');
    expect(url.password).toBe('p');
    expect(url.protocol).toBe('ws:');
  });

  it('leaves the url alone for blank credentials', () => {
    expect(createWsUrl('/pty/1', undefined, { username: '', password: '' })).toBe(
      'ws://localhost:4096/pty/1',
    );
  });
});
