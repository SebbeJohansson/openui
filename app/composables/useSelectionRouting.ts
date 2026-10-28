import { watch } from 'vue';
import { useRoute, useRouter } from '#imports';
import { defineFeature } from './useAppContext';

function queryString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Mirrors the selected project/session into `?project=&session=` and back, so
 * links are shareable and refresh restores the selection. Query-only
 * `router.replace` calls do not remount the page.
 */
export const useSelectionRouting = defineFeature('selectionRouting', ({ selection }) => {
  const route = useRoute();
  const router = useRouter();
  const { selectedProjectId, selectedSessionId, switchSession } = selection;

  /** Selection requested by the URL at startup; consumed by the bootstrap. */
  const initialSelection = {
    projectId: queryString(route.query.project),
    sessionId: queryString(route.query.session),
  };

  watch(
    [selectedProjectId, selectedSessionId],
    ([projectId, sessionId]) => {
      const nextProject = projectId.trim();
      const nextSession = sessionId.trim();
      const both = Boolean(nextProject && nextSession);
      const current = route.query;
      const sameSelection =
        queryString(current.project) === (both ? nextProject : '') &&
        queryString(current.session) === (both ? nextSession : '') &&
        !('worktree' in current); // legacy param, always dropped
      if (sameSelection) return;
      const query = { ...current };
      delete query.worktree;
      if (both) {
        query.project = nextProject;
        query.session = nextSession;
      } else {
        delete query.project;
        delete query.session;
      }
      void router.replace({ query });
    },
    { immediate: true },
  );

  // Back/forward or an edited URL selects the matching session.
  watch(
    () => [queryString(route.query.project), queryString(route.query.session)] as const,
    ([projectId, sessionId]) => {
      if (!projectId || !sessionId) return;
      if (projectId === selectedProjectId.value && sessionId === selectedSessionId.value) return;
      void switchSession(projectId, sessionId);
    },
  );

  return { initialSelection };
});
