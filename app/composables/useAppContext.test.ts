// @vitest-environment nuxt
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, getCurrentScope, h, nextTick, ref, watch } from 'vue';
import { mountAppContext } from '../../test/nuxt/app-context';
import { defineFeature, provideAppContext, useAppContext, type AppContext } from './useAppContext';

const mounted: Array<() => void> = [];

afterEach(() => {
  while (mounted.length) mounted.pop()?.();
});

async function freshContext(): Promise<AppContext> {
  const { context, unmount } = await mountAppContext();
  mounted.push(unmount);
  return context;
}

describe('createAppContext', () => {
  it('wires the core singletons the whole app depends on', async () => {
    const context = await freshContext();

    expect(Object.keys(context)).toEqual(
      expect.arrayContaining([
        'scope',
        'features',
        'credentials',
        'settings',
        'isMobile',
        'fw',
        'serverState',
        'openCodeApi',
        'selection',
        'sessionParentRecord',
        'ge',
        'deltaAccumulator',
        'sessionScope',
        'mainSessionScope',
        'msg',
        'reasoning',
        'subagentWindows',
        'modelNameResolver',
        'uiHooks',
      ]),
    );
    expect(context.scope).toBeDefined();
    expect(context.features.size).toBe(0);
  });

  it('starts with no-op ui hooks so a feature can call them before the shell mounts', async () => {
    const context = await freshContext();

    expect(() => {
      context.uiHooks.focusComposer();
      context.uiHooks.resetComposer();
      context.uiHooks.openSessionDropdown();
      context.uiHooks.closeSessionDropdown();
      context.uiHooks.toggleSessionDropdown();
    }).not.toThrow();
    expect(context.uiHooks.getOutputPanelEl()).toBeUndefined();
  });

  it('mirrors the selected project session parents into sessionParentRecord', async () => {
    const context = await freshContext();

    context.serverState.projects.p1 = {
      id: 'p1',
      name: 'p1',
      worktree: '/w',
      sandboxes: {
        '/w': {
          directory: '/w',
          name: 'main',
          rootSessions: ['s1'],
          sessions: {
            s1: { id: 's1' },
            s2: { id: 's2', parentID: 's1' },
          },
        },
      },
    } as never;
    context.selection.selectedProjectId.value = 'p1';
    await nextTick();

    expect(context.sessionParentRecord).toEqual({ s1: undefined, s2: 's1' });

    // Selecting a project with no sessions clears the record again.
    context.selection.selectedProjectId.value = '';
    await nextTick();
    expect(context.sessionParentRecord).toEqual({});
  });
});

describe('useAppContext', () => {
  it('is readable from a descendant component', async () => {
    let seen: AppContext | null = null;
    const Child = defineComponent({
      setup() {
        seen = useAppContext();
        return () => h('span', 'child');
      },
    });
    const { context, unmount } = await mountAppContext({ slot: Child });
    mounted.push(unmount);

    expect(seen).toBe(context);
  });

  it('throws a helpful error with no provider above it', async () => {
    const Orphan = defineComponent({
      setup() {
        useAppContext();
        return () => h('div');
      },
    });

    // Vue logs the setup error before rethrowing it; keep the output clean.
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(mountSuspended(Orphan)).rejects.toThrow(
        'useAppContext() must be called inside a component under provideAppContext().',
      );
    } finally {
      spy.mockRestore();
    }
  });
});

describe('defineFeature', () => {
  it('creates the feature once per context and returns the same instance', async () => {
    const context = await freshContext();
    const factory = vi.fn(() => ({ value: ref(0) }));
    const useThing = defineFeature('test.once', factory);

    const first = useThing(context);
    const second = useThing(context);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(context.features.has('test.once')).toBe(true);
  });

  it('keeps separate instances for separate contexts', async () => {
    const a = await freshContext();
    const b = await freshContext();
    const useThing = defineFeature('test.isolated', () => ({ value: ref(0) }));

    const fromA = useThing(a);
    const fromB = useThing(b);
    fromA.value.value = 42;

    expect(fromB).not.toBe(fromA);
    expect(fromB.value.value).toBe(0);
  });

  it('runs the factory inside the providing component effect scope', async () => {
    const context = await freshContext();
    let scopeInFactory: unknown = null;
    const useThing = defineFeature('test.scope', () => {
      scopeInFactory = getCurrentScope();
      return {};
    });

    useThing(context);

    expect(scopeInFactory).toBe(context.scope);
  });

  it('keeps a feature watcher alive after the component that created it unmounts', async () => {
    const context = await freshContext();
    const source = ref(0);
    const seen: number[] = [];
    const useThing = defineFeature('test.watcher', () => {
      watch(source, (value) => seen.push(value));
      return {};
    });

    // A short-lived child is the first to ask for the feature.
    const Child = defineComponent({
      setup() {
        useThing(context);
        return () => h('span');
      },
    });
    const child = await mountSuspended(Child);
    child.unmount();

    source.value = 1;
    await nextTick();

    expect(seen).toEqual([1]);
  });

  it('resolves the context by injection when none is passed', async () => {
    const useThing = defineFeature('test.injected', () => ({ id: Symbol('thing') }));
    let fromChild: unknown = null;
    const Child = defineComponent({
      setup() {
        fromChild = useThing();
        return () => h('span');
      },
    });
    const { context, unmount } = await mountAppContext({ slot: Child });
    mounted.push(unmount);

    expect(fromChild).toBe(useThing(context));
  });

  it('lets one feature reach another without a second inject()', async () => {
    const context = await freshContext();
    const useInner = defineFeature('test.inner', () => ({ value: ref('inner') }));
    const useOuter = defineFeature('test.outer', (ctx) => ({ inner: useInner(ctx) }));

    // Called from the test body, i.e. outside any component setup.
    expect(useOuter(context).inner).toBe(useInner(context));
  });
});

describe('provideAppContext', () => {
  it('hands back the context it provided', async () => {
    let provided: AppContext | null = null;
    let injected: AppContext | null = null;
    const Child = defineComponent({
      setup() {
        injected = useAppContext();
        return () => h('span');
      },
    });
    const Host = defineComponent({
      setup() {
        provided = provideAppContext();
        return () => h('div', [h(Child)]);
      },
    });
    const wrapper = await mountSuspended(Host);
    mounted.push(() => wrapper.unmount());

    expect(injected).toBe(provided);
  });
});
