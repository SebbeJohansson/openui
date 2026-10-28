// @vitest-environment nuxt
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { projectState } from '../../../test/nuxt/app-context';
import { provideAppContext, type AppContext } from '~/composables/useAppContext';
import { useShellLayout } from '~/composables/useShellLayout';
import ShellLayout from './Layout.vue';

/**
 * The connected shell, mounted straight into a provided app context (no
 * bootstrap, no server). This is the test that catches a shell component that
 * no longer resolves through Nuxt auto-imports, or a feature composable that
 * a component can no longer reach.
 */

const wrappers: Array<() => void> = [];
let warnings: string[];

async function mountShell(seed?: (context: AppContext) => void) {
  let context: AppContext | null = null;
  const Host = defineComponent({
    name: 'ShellLayoutTestHost',
    setup() {
      context = provideAppContext();
      seed?.(context);
      return () => h(ShellLayout);
    },
  });
  const wrapper = await mountSuspended(Host);
  wrappers.push(() => wrapper.unmount());
  await nextTick();
  return { wrapper, context: context! };
}

beforeEach(() => {
  localStorage.clear();
  warnings = [];
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(new Response('{}', { headers: { 'content-type': 'application/json' } })),
    ),
  );
});

afterEach(() => {
  while (wrappers.length) wrappers.pop()?.();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ShellLayout', () => {
  it('renders the app body with the side panel, workspace and window canvas', async () => {
    const { wrapper } = await mountShell();

    expect(wrapper.find('.app-body').exists()).toBe(true);
    expect(wrapper.html()).not.toBe('');
  });

  it('resolves every shell component it references', async () => {
    await mountShell();

    // A renamed component or a broken components.dirs entry shows up here.
    expect(warnings.filter((line) => line.includes('Failed to resolve component'))).toEqual([]);
  });

  it('reflects the collapsed side panel in the body class', async () => {
    const { wrapper, context } = await mountShell();

    expect(wrapper.find('.app-body').classes()).not.toContain('todo-collapsed');

    useShellLayout(context).sidePanelCollapsed.value = true;
    await nextTick();

    expect(wrapper.find('.app-body').classes()).toContain('todo-collapsed');
  });

  it('renders with a session selected', async () => {
    const { wrapper } = await mountShell((context) => {
      context.serverState.projects.p1 = projectState('p1', '/w', ['ses_1']) as never;
      context.selection.selectedProjectId.value = 'p1';
      context.selection.selectedSessionId.value = 'ses_1';
    });

    expect(wrapper.find('.app-body').exists()).toBe(true);
    expect(warnings.filter((line) => line.includes('Failed to resolve component'))).toEqual([]);
  });
});
