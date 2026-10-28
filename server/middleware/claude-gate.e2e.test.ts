import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { $fetch, fetch as fetchRaw, setup } from '@nuxt/test-utils/e2e';

/**
 * The Claude routes must not exist at all on a server started without the
 * experimental flag. Boots a real build with Claude disabled, which is the
 * default configuration the npm package ships.
 */
await setup({
  rootDir: fileURLToPath(new URL('../..', import.meta.url)),
  server: true,
  build: true,
  nuxtConfig: {
    runtimeConfig: { opencodeUrl: '', claudeEnabled: false },
  },
});

describe('with Claude support disabled', () => {
  it('reports no OpenCode url and no Claude api base', async () => {
    const config = await $fetch<Record<string, unknown>>('/api/config', { responseType: 'json' });

    expect(config).toEqual({
      openCodeUrl: null,
      claudeEnabled: false,
      claudeApiBase: null,
    });
  });

  it.each([
    ['GET', '/api/claude/sessions'],
    ['GET', '/api/claude/projects'],
    ['GET', '/api/claude/events'],
    ['GET', '/api/claude/sessions/abc'],
    ['GET', '/api/claude/sessions/abc/messages'],
    ['POST', '/api/claude/sessions'],
    ['POST', '/api/claude/sessions/abc/prompt'],
    ['POST', '/api/claude/sessions/abc/abort'],
    ['POST', '/api/claude/permissions/abc/reply'],
  ])('404s on %s %s', async (method, path) => {
    const response = await fetchRaw(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'POST' ? '{}' : undefined,
    });

    expect(response.status).toBe(404);
  });

  it('still serves the app itself', async () => {
    const response = await fetchRaw('/');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
  });
});
