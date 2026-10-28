// @vitest-environment nuxt
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import type { RouteLocationNormalizedLoaded, Router } from 'vue-router';
import { useRoute, useRouter } from '#imports';
import { projectState } from '../../test/nuxt/app-context';
import { provideAppContext, type AppContext } from './useAppContext';
import { useSelectionRouting } from './useSelectionRouting';

type Harness = {
  context: AppContext;
  route: RouteLocationNormalizedLoaded;
  router: Router;
  unmount: () => void;
};

const mounted: Array<() => void> = [];

async function mountHarness(route?: string): Promise<Harness> {
  let harness: Omit<Harness, 'unmount'> | null = null;
  const Host = defineComponent({
    name: 'SelectionRoutingTestHost',
    setup() {
      harness = { context: provideAppContext(), route: useRoute(), router: useRouter() };
      return () => h('div');
    },
  });
  const wrapper = await mountSuspended(Host, route ? { route } : {});
  const unmount = () => wrapper.unmount();
  mounted.push(unmount);
  return { ...harness!, unmount };
}

/**
 * Let the watcher run and the router finish its replace(). The watcher fires
 * `router.replace()` without awaiting it, so wait until the url stops moving.
 */
async function settle(router: Router) {
  let stable = 0;
  let last = router.currentRoute.value.fullPath;
  for (let i = 0; i < 100 && stable < 3; i += 1) {
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 2));
    const current = router.currentRoute.value.fullPath;
    stable = current === last ? stable + 1 : 0;
    last = current;
  }
}

/** The live query, read off the router rather than a captured route object. */
function query(router: Router) {
  return router.currentRoute.value.query;
}

afterEach(() => {
  while (mounted.length) mounted.pop()?.();
});

describe('initialSelection', () => {
  it('reads the project and session out of the query', async () => {
    const { context } = await mountHarness('/?project=p1&session=s1');

    expect(useSelectionRouting(context).initialSelection).toEqual({
      projectId: 'p1',
      sessionId: 's1',
    });
  });

  it('trims the values and ignores non-string query params', async () => {
    const { context } = await mountHarness('/?project=%20p1%20&session=s1&session=s2');

    // A repeated param arrives as an array, which is not a usable selection.
    expect(useSelectionRouting(context).initialSelection).toEqual({
      projectId: 'p1',
      sessionId: '',
    });
  });

  it('is empty with no query', async () => {
    const { context } = await mountHarness();

    expect(useSelectionRouting(context).initialSelection).toEqual({ projectId: '', sessionId: '' });
  });

  it('is a snapshot: a later url change does not rewrite it', async () => {
    const { context, router } = await mountHarness('/?project=p1&session=s1');
    const { initialSelection } = useSelectionRouting(context);

    await router.replace({ query: { project: 'p2', session: 's2' } });
    await settle(router);

    expect(initialSelection).toEqual({ projectId: 'p1', sessionId: 's1' });
  });
});

describe('selection to url', () => {
  it('writes both params once a project and a session are selected', async () => {
    const { context, router } = await mountHarness();
    useSelectionRouting(context);

    context.selection.selectedProjectId.value = 'p1';
    context.selection.selectedSessionId.value = 's1';
    await settle(router);

    expect(query(router)).toMatchObject({ project: 'p1', session: 's1' });
  });

  it('writes nothing while only one half is selected', async () => {
    const { context, router } = await mountHarness();
    useSelectionRouting(context);

    context.selection.selectedProjectId.value = 'p1';
    await settle(router);

    expect(query(router).project).toBeUndefined();
    expect(query(router).session).toBeUndefined();
  });

  it('drops both params when the selection is cleared', async () => {
    const { context, router } = await mountHarness('/?project=p1&session=s1');
    useSelectionRouting(context);
    context.selection.selectedProjectId.value = 'p1';
    context.selection.selectedSessionId.value = 's1';
    await settle(router);

    context.selection.selectedSessionId.value = '';
    await settle(router);

    expect(query(router).project).toBeUndefined();
    expect(query(router).session).toBeUndefined();
  });

  it('drops the legacy worktree param and keeps unrelated ones', async () => {
    const { context, router } = await mountHarness('/?worktree=%2Fw&keep=yes');
    useSelectionRouting(context);

    context.selection.selectedProjectId.value = 'p1';
    context.selection.selectedSessionId.value = 's1';
    await settle(router);

    expect(query(router).worktree).toBeUndefined();
    expect(query(router).keep).toBe('yes');
    expect(query(router)).toMatchObject({ project: 'p1', session: 's1' });
  });

  it('drops a stale worktree param even when the selection already matches the url', async () => {
    const { context, router } = await mountHarness('/?project=p1&session=s1&worktree=%2Fw');
    context.selection.selectedProjectId.value = 'p1';
    context.selection.selectedSessionId.value = 's1';

    // The immediate watcher has to rewrite the url just to remove `worktree`.
    useSelectionRouting(context);
    await settle(router);

    expect(query(router).worktree).toBeUndefined();
    expect(query(router)).toMatchObject({ project: 'p1', session: 's1' });
  });

  it('does not navigate when the url already matches the selection', async () => {
    const { context, router } = await mountHarness('/?project=p1&session=s1');
    context.selection.selectedProjectId.value = 'p1';
    context.selection.selectedSessionId.value = 's1';
    useSelectionRouting(context);
    await settle(router);

    const before = router.currentRoute.value.fullPath;
    context.selection.selectedSessionId.value = 's1';
    await settle(router);

    expect(router.currentRoute.value.fullPath).toBe(before);
  });
});

describe('url to selection', () => {
  it('selects the session named by an edited url', async () => {
    const { context, router } = await mountHarness();
    context.serverState.projects.p1 = projectState('p1', '/w', ['s1', 's2']) as never;
    useSelectionRouting(context);

    await router.replace({ query: { project: 'p1', session: 's2' } });
    await settle(router);

    expect(context.selection.selectedProjectId.value).toBe('p1');
    expect(context.selection.selectedSessionId.value).toBe('s2');
  });

  it('ignores a url that names only one half of a selection', async () => {
    const { context, router } = await mountHarness();
    context.serverState.projects.p1 = projectState('p1', '/w', ['s1']) as never;
    useSelectionRouting(context);

    await router.replace({ query: { project: 'p1' } });
    await settle(router);

    expect(context.selection.selectedSessionId.value).toBe('');
  });
});

describe('feature identity', () => {
  it('is created once per app context', async () => {
    const { context } = await mountHarness();
    expect(useSelectionRouting(context)).toBe(useSelectionRouting(context));
  });
});
