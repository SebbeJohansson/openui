<template>
  <div :ref="bindSidePanelAreaEl" class="side-panel-area">
    <SidePanel
      class="todo-panel"
      :class="{ 'is-disabled': !hasSession }"
      :collapsed="sidePanelCollapsed"
      :active-tab="sidePanelActiveTab"
      :todo-sessions="todoPanelSessions"
      :tree-nodes="treeNodes"
      :expanded-tree-paths="expandedTreePaths"
      :selected-tree-path="selectedTreePath"
      :tree-loading="treeLoading"
      :tree-error="treeError"
      :tree-status-by-path="gitStatusByPath"
      :tree-branch-info="gitStatus?.branch"
      :tree-diff-stats="gitStatus?.diffStats"
      :tree-directory-name="treeDirectoryName"
      :tree-branch-entries="branchEntries"
      :tree-branch-list-loading="branchListLoading"
      :run-shell-command="runTreeShellCommand"
      @toggle-collapse="isMobile ? closeMobileDrawer() : toggleSidePanelCollapsed()"
      @change-tab="setSidePanelTab"
      @toggle-dir="toggleTreeDirectory"
      @select-file="selectTreeFile"
      @open-diff="openGitDiff"
      @open-diff-all="(payload: { mode: WorktreeSnapshotMode }) => openAllGitDiff(payload.mode)"
      @open-file="openFileViewer"
      @reload="reloadTree().then(() => refreshGitStatus())"
    />
    <div v-if="!sidePanelCollapsed" class="side-resizer" @pointerdown="startSidePanelResize"></div>
  </div>
</template>

<script lang="ts" setup>
/** Collapsible left rail: todo list and file tree, plus its resize handle. */
import { computed } from 'vue';
import SidePanel from '~/components/SidePanel.vue';
import type { TodoSessionView } from '~/composables/useTodos';
import type { WorktreeSnapshotMode } from '~/utils/gitSnapshotScripts';
import { useAppContext } from '~/composables/useAppContext';
import { useFileTree } from '~/composables/useFileTree';
import { useFileViewers } from '~/composables/useFileViewers';
import { useGitSnapshots } from '~/composables/useGitSnapshots';
import { useSessionActions } from '~/composables/useSessionActions';
import { useSessionCatalog } from '~/composables/useSessionCatalog';
import { useShellLayout } from '~/composables/useShellLayout';
import { useTerminalWindows } from '~/composables/useTerminalWindows';

const { isMobile, selection } = useAppContext();
const { selectedSessionId, activeDirectory } = selection;
const {
  bindSidePanelAreaEl,
  sidePanelCollapsed,
  sidePanelActiveTab,
  closeMobileDrawer,
  toggleSidePanelCollapsed,
  setSidePanelTab,
  startSidePanelResize,
} = useShellLayout();
const {
  hasSession,
  treeDirectoryName,
  sessions,
  sessionParentById,
  allowedSessionIds,
  sessionLabel,
} = useSessionCatalog();
const { openFileViewer } = useFileViewers();
const { openGitDiff, openAllGitDiff } = useGitSnapshots();
const { runTreeShellCommand } = useTerminalWindows();
const { todos } = useSessionActions();
const { todosBySessionId, todoLoadingBySessionId, todoErrorBySessionId } = todos;
const {
  treeNodes,
  expandedTreePaths,
  selectedTreePath,
  treeLoading,
  treeError,
  gitStatus,
  gitStatusByPath,
  refreshGitStatus,
  reloadTree,
  toggleTreeDirectory,
  selectTreeFile,
  branchEntries,
  branchListLoading,
} = useFileTree({ activeDirectory });

/** Sessions with todos, selected session first, subagents last. */
const todoPanelSessions = computed(() => {
  const allowed = allowedSessionIds.value;
  if (allowed.size === 0) return [] as TodoSessionView[];
  const list = Array.from(allowed).map((sessionId) => {
    const session = sessions.value.find((item) => item.id === sessionId);
    const title = sessionLabel(session ?? { id: sessionId });
    return {
      sessionId,
      title,
      isSubagent: Boolean(sessionParentById.value.get(sessionId)),
      todos: todosBySessionId.value[sessionId] ?? [],
      loading: Boolean(todoLoadingBySessionId.value[sessionId]),
      error: todoErrorBySessionId.value[sessionId],
    };
  });
  const visible = list.filter((entry) => entry.todos.length > 0 || Boolean(entry.error));
  if (visible.length === 0) return [] as TodoSessionView[];
  visible.sort((a, b) => {
    if (a.sessionId === selectedSessionId.value) return -1;
    if (b.sessionId === selectedSessionId.value) return 1;
    if (a.isSubagent !== b.isSubagent) return a.isSubagent ? 1 : -1;
    return a.title.localeCompare(b.title);
  });
  return visible;
});
</script>
