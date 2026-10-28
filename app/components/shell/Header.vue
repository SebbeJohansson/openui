<template>
  <header class="app-header">
    <TopPanel
      ref="topPanelRef"
      :tree-data="topPanelTreeData"
      :notification-sessions="notificationSessions"
      :project-directory="projectDirectory"
      :active-directory="activeDirectory"
      :selected-session-id="selectedSessionId"
      :home-path="homePath"
      :claude-enabled="claudeEnabled"
      @select-notification="selectNextNotificationSession"
      @create-worktree-from="createWorktreeFromWorktree"
      @new-session="createNewSession"
      @new-claude-session="() => createClaudeSession()"
      @new-session-in="handleNewSessionInSandbox"
      @new-claude-session-in="(p: { directory: string }) => createClaudeSession(p.directory)"
      @open-shell="openShellFromInput('')"
      @delete-active-directory="deleteWorktree"
      @delete-session="deleteSession"
      @archive-session="archiveSession"
      @archive-project="archiveProject"
      @delete-project="deleteProject"
      @select-session="handleTopPanelSessionSelect"
      @open-directory="openProjectPicker"
      @edit-project="handleEditProject"
      @open-settings="isSettingsOpen = true"
      @logout="handleLogout"
      @dropdown-closed="focusInput"
    />
  </header>
</template>

<script lang="ts" setup>
/** Top bar: project, worktree and session navigation. */
import { onMounted, ref } from 'vue';
import TopPanel from '~/components/TopPanel.vue';
import { useAppBootstrap } from '~/composables/useAppBootstrap';
import { useAppContext } from '~/composables/useAppContext';
import { useBrowserNotifications } from '~/composables/useBrowserNotifications';
import { useClaudeIntegration } from '~/composables/useClaudeIntegration';
import { useKeyboardShortcuts } from '~/composables/useKeyboardShortcuts';
import { useModals } from '~/composables/useModals';
import { useServerConfig } from '~/composables/useServerConfig';
import { useSessionActions } from '~/composables/useSessionActions';
import { useSessionCatalog } from '~/composables/useSessionCatalog';
import { useTerminalWindows } from '~/composables/useTerminalWindows';

const ctx = useAppContext();
const { homePath, selection } = ctx;
const { projectDirectory, activeDirectory, selectedSessionId } = selection;
const { topPanelTreeData } = useSessionCatalog();
const { notificationSessions, selectNextNotificationSession } = useBrowserNotifications();
const { claudeEnabled } = useServerConfig();
const { createClaudeSession } = useClaudeIntegration();
const { openShellFromInput } = useTerminalWindows();
const { isSettingsOpen } = useModals();
const { focusInput } = useKeyboardShortcuts();
const { handleLogout } = useAppBootstrap();
const {
  createWorktreeFromWorktree,
  createNewSession,
  handleNewSessionInSandbox,
  deleteWorktree,
  deleteSession,
  archiveSession,
  archiveProject,
  deleteProject,
  handleTopPanelSessionSelect,
  openProjectPicker,
  handleEditProject,
} = useSessionActions();

const topPanelRef = ref<{
  openSessionDropdown: () => void;
  closeSessionDropdown: () => void;
  toggleSessionDropdown: () => void;
} | null>(null);

// Expose the dropdown API to the keyboard shortcuts, which cannot reach a
// template ref in a component it does not own.
onMounted(() => {
  ctx.uiHooks.openSessionDropdown = () => topPanelRef.value?.openSessionDropdown();
  ctx.uiHooks.closeSessionDropdown = () => topPanelRef.value?.closeSessionDropdown();
  ctx.uiHooks.toggleSessionDropdown = () => topPanelRef.value?.toggleSessionDropdown();
});
</script>
