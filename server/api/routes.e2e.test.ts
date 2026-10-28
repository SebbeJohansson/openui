import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { $fetch, fetch as fetchRaw, setup } from '@nuxt/test-utils/e2e';

/**
 * End-to-end tests for the Nitro routes that replaced the standalone Hono
 * server. They boot a real build, so this file is slower than the rest of the
 * suite; keep it to route-level contracts.
 *
 * HOME points at an empty directory so the Claude routes read no real
 * ~/.claude data.
 */
const FAKE_HOME = await mkdtemp(join(tmpdir(), 'openui-e2e-home-'));

await setup({
  rootDir: fileURLToPath(new URL('../..', import.meta.url)),
  server: true,
  build: true,
  nuxtConfig: {
    runtimeConfig: {
      opencodeUrl: 'http://localhost:4096',
      claudeEnabled: true,
    },
  },
  env: { HOME: FAKE_HOME, USERPROFILE: FAKE_HOME },
});

describe('GET /api/config', () => {
  it('reports the OpenCode url and the Claude api base', async () => {
    const response = await $fetch<Record<string, unknown>>('/api/config', {
      responseType: 'json',
    });

    expect(response).toEqual({
      openCodeUrl: 'http://localhost:4096',
      claudeEnabled: true,
      claudeApiBase: '/api/claude',
    });
  });

  it('is not cacheable, so a restarted server is picked up', async () => {
    const response = await fetchRaw('/api/config');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

describe('claude routes', () => {
  it('lists sessions as an array', async () => {
    const sessions = await $fetch<unknown[]>('/api/claude/sessions', { responseType: 'json' });
    expect(Array.isArray(sessions)).toBe(true);
  });

  it('lists projects as an array', async () => {
    const projects = await $fetch<unknown[]>('/api/claude/projects', { responseType: 'json' });
    expect(Array.isArray(projects)).toBe(true);
  });

  it('404s for an unknown session', async () => {
    const response = await fetchRaw('/api/claude/sessions/does-not-exist');
    expect(response.status).toBe(404);
  });

  it('returns empty history for an unknown session rather than failing', async () => {
    const history = await $fetch<{ messages: unknown[]; parts: unknown[] }>(
      '/api/claude/sessions/does-not-exist/messages',
      { responseType: 'json' },
    );
    expect(history).toEqual({ messages: [], parts: [] });
  });

  it('rejects a prompt with no text', async () => {
    const response = await fetchRaw('/api/claude/sessions/abc/prompt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '   ' }),
    });
    expect(response.status).toBe(400);
  });

  it('404s when replying to a permission request that does not exist', async () => {
    const response = await fetchRaw('/api/claude/permissions/nope/reply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reply: 'accept' }),
    });
    expect(response.status).toBe(404);
  });

  it('accepts an abort for any session id', async () => {
    const response = await $fetch<{ ok: boolean }>('/api/claude/sessions/abc/abort', {
      method: 'POST',
      responseType: 'json',
    });
    expect(response).toEqual({ ok: true });
  });
});
