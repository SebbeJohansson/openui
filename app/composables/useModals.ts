import { computed, ref } from 'vue';
import { defineFeature } from './useAppContext';

/** Open/closed state of the app-level dialogs. */
export const useModals = defineFeature('modals', ({ serverState }) => {
  const isProjectPickerOpen = ref(false);
  const editingProject = ref<{ projectId: string; worktree: string } | null>(null);
  const editingProjectMeta = computed(() => {
    const pid = editingProject.value?.projectId;
    return pid ? serverState.projects[pid] : undefined;
  });
  const isSettingsOpen = ref(false);
  const isHiddenModelsOpen = ref(false);

  return {
    isProjectPickerOpen,
    editingProject,
    editingProjectMeta,
    isSettingsOpen,
    isHiddenModelsOpen,
  };
});
