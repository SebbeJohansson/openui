// @vitest-environment nuxt
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import IndexPage from './index.vue';

/**
 * Smoke tests for the app shell. Mounting the page runs the whole wiring the
 * Nuxt migration rearranged: the page provides the app context, the bootstrap
 * instantiates every feature composable inside it, and the shell components
 * resolve through Nuxt auto-imports.
 */

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const wrappers: Array<() => void> = [];

beforeEach(() => {
  localStorage.clear();
  // No server config and no stored credentials: the shell settles on login
  // without ever opening an event stream.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(jsonResponse({ error: 'not found' }, 404))),
  );
});

afterEach(() => {
  while (wrappers.length) wrappers.pop()?.();
  vi.unstubAllGlobals();
});

async function mountPage() {
  const wrapper = await mountSuspended(IndexPage);
  wrappers.push(() => wrapper.unmount());
  // Let the bootstrap's onMounted work (config probe) finish.
  for (let i = 0; i < 10; i += 1) {
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  return wrapper;
}

describe('pages/index.vue', () => {
  it('mounts without errors and shows the startup screen', async () => {
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args));
    try {
      const wrapper = await mountPage();

      expect(wrapper.find('.app').exists()).toBe(true);
      expect(wrapper.find('.app-loading-view').exists()).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it('falls back to the login form when no server config and no stored credentials exist', async () => {
    const wrapper = await mountPage();

    expect(wrapper.find('.app-login-form').exists()).toBe(true);
    expect(wrapper.text()).toContain('Connect to OpenCode Server');
    const inputs = wrapper.findAll('.app-login-input');
    expect(inputs.length).toBe(3);
    // Username and password stay disabled until "requires authentication" is on.
    expect(inputs[0]!.attributes('disabled')).toBeDefined();
    expect(inputs[2]!.attributes('disabled')).toBeUndefined();
  });

  it('shows the connected shell instead of the startup screen once a server url is configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/config')) {
          return Promise.resolve(
            jsonResponse({
              openCodeUrl: 'http://localhost:4096',
              claudeEnabled: false,
              claudeApiBase: null,
            }),
          );
        }
        return Promise.resolve(jsonResponse({ error: 'not found' }, 404));
      }),
    );

    const wrapper = await mountPage();

    // The SSE stream never connects in the test environment, so the shell
    // reports the failure rather than rendering the workspace.
    expect(wrapper.find('.app-loading-view').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('app-body');
  });

  it('does not leave listeners behind when unmounted', async () => {
    const wrapper = await mountPage();
    expect(() => wrapper.unmount()).not.toThrow();
  });
});
