<template>
  <ProjectPicker
    :open="isProjectPickerOpen"
    :home-path="homePath"
    :worktree-path="serverWorktreePath"
    @close="isProjectPickerOpen = false"
    @select="handleProjectDirectorySelect"
  />
  <SettingsModal :open="isSettingsOpen" @close="isSettingsOpen = false" />
  <HiddenModelsModal
    :open="isHiddenModelsOpen"
    :all-model-options="allModelOptions"
    @close="isHiddenModelsOpen = false"
  />
  <PeonPingPlayer />
  <ProjectSettingsDialog
    :open="!!editingProject"
    :project-id="editingProject?.projectId ?? ''"
    :worktree="editingProject?.worktree ?? ''"
    :name="editingProjectMeta?.name"
    :icon-color="editingProjectMeta?.icon?.color"
    :icon-override="editingProjectMeta?.icon?.override"
    :commands-start="editingProjectMeta?.commands?.start"
    @close="editingProject = null"
    @save="handleSaveProject"
  />
</template>

<script lang="ts" setup>
/** App-level dialogs and the notification sound player. */
import HiddenModelsModal from '~/components/HiddenModelsModal.vue';
import PeonPingPlayer from '~/components/PeonPingPlayer.vue';
import ProjectPicker from '~/components/ProjectPicker.vue';
import ProjectSettingsDialog from '~/components/ProjectSettingsDialog.vue';
import SettingsModal from '~/components/SettingsModal.vue';
import { useAppContext } from '~/composables/useAppContext';
import { useModals } from '~/composables/useModals';
import { useProviderCatalog } from '~/composables/useProviderCatalog';
import { useSessionActions } from '~/composables/useSessionActions';

const { homePath, serverWorktreePath } = useAppContext();
const {
  isProjectPickerOpen,
  isSettingsOpen,
  isHiddenModelsOpen,
  editingProject,
  editingProjectMeta,
} = useModals();
const { allModelOptions } = useProviderCatalog();
const { handleProjectDirectorySelect, handleSaveProject } = useSessionActions();
</script>
