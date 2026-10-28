/**
 * Mount helper for feature-composable tests.
 *
 * Feature composables are per-app-context singletons created by
 * `defineFeature()`, which needs a `provideAppContext()` above it and an
 * effect scope to live in. Both only exist inside a mounted component, so
 * tests mount a throwaway host component and read the context out of it.
 */
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { defineComponent, h, type Component } from 'vue';
import { provideAppContext, type AppContext } from '~/composables/useAppContext';

export type MountedAppContext = {
  context: AppContext;
  unmount: () => void;
};

/**
 * Mount a host component that provides a fresh app context.
 *
 * `route` is passed through to `mountSuspended`, which is how a test puts the
 * page on a URL with `?project=&session=`.
 */
export async function mountAppContext(
  options: { route?: string; slot?: Component } = {},
): Promise<MountedAppContext> {
  let context: AppContext | null = null;
  const Host = defineComponent({
    name: 'AppContextTestHost',
    setup() {
      context = provideAppContext();
      return () => h('div', options.slot ? [h(options.slot)] : []);
    },
  });

  const wrapper = await mountSuspended(Host, options.route ? { route: options.route } : {});
  if (!context) throw new Error('The host component did not create an app context.');
  return { context, unmount: () => wrapper.unmount() };
}

/** A project tree entry shaped like the SharedWorker's state mirror. */
export function projectState(
  id: string,
  directory: string,
  sessionIds: string[],
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    name: directory.split('/').pop() ?? directory,
    worktree: directory,
    sandboxes: {
      [directory]: {
        directory,
        name: 'main',
        rootSessions: [...sessionIds],
        sessions: Object.fromEntries(
          sessionIds.map((sessionId) => [sessionId, { id: sessionId, directory }]),
        ),
      },
    },
    ...overrides,
  };
}
