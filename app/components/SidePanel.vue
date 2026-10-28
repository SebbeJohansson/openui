<template>
  <aside class="side-panel" :class="{ 'is-collapsed': collapsed }">
    <button
      v-if="collapsed"
      type="button"
      class="side-toggle side-toggle-collapsed"
      :aria-expanded="!collapsed"
      aria-label="Expand side panel"
      @click="emit('toggle-collapse')"
    >
      <Icon name="lucide:chevron-right" size="14" />
    </button>
    <div v-else class="side-body">
      <div class="side-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="side-tab"
          :class="{ 'is-active': activeTab === tab.id }"
          @click="emit('change-tab', tab.id)"
        >
          {{ tab.label }}
        </button>
        <button
          type="button"
          class="side-toggle side-toggle-inline"
          :aria-expanded="!collapsed"
          aria-label="Collapse side panel"
          @click="emit('toggle-collapse')"
        >
          <Icon name="lucide:chevron-left" size="14" />
        </button>
      </div>
      <TodoList v-if="activeTab === 'todo'" :sessions="todoSessions" />
      <TreeView
        v-else
        :root-nodes="treeNodes"
        :expanded-paths="expandedTreePaths"
        :selected-path="selectedTreePath"
        :is-loading="treeLoading"
        :error="treeError"
        :git-status-by-path="treeStatusByPath"
        :branch-info="treeBranchInfo"
        :diff-stats="treeDiffStats"
        :directory-name="treeDirectoryName"
        :branch-entries="treeBranchEntries"
        :branch-list-loading="treeBranchListLoading"
        :run-shell-command="runShellCommand"
        @toggle-dir="(path) => emit('toggle-dir', path)"
        @select-file="(path) => emit('select-file', path)"
        @open-diff="(payload) => emit('open-diff', payload)"
        @open-diff-all="(payload) => emit('open-diff-all', payload)"
        @open-file="(path) => emit('open-file', path)"
        @reload="emit('reload')"
      />
    </div>
  </aside>
</template>

<script setup lang="ts">
import { toRefs } from 'vue';
import TodoList from './TodoList.vue';
import type { BranchEntry } from '../composables/useFileTree';
import type { TodoSessionView } from '../composables/useTodos';
import TreeView, {
  type GitBranchInfo,
  type GitDiffStats,
  type GitFileStatus,
  type TreeNode,
} from './TreeView.vue';

const props = defineProps<{
  collapsed: boolean;
  activeTab: 'todo' | 'tree';
  todoSessions: TodoSessionView[];
  treeNodes: TreeNode[];
  expandedTreePaths: string[];
  selectedTreePath?: string;
  treeLoading: boolean;
  treeError?: string;
  treeStatusByPath: Record<string, GitFileStatus>;
  treeBranchInfo?: GitBranchInfo | null;
  treeDiffStats?: GitDiffStats | null;
  treeDirectoryName?: string;
  treeBranchEntries?: BranchEntry[];
  treeBranchListLoading?: boolean;
  runShellCommand?: (command: string) => Promise<void>;
}>();

const emit = defineEmits<{
  (event: 'toggle-collapse'): void;
  (event: 'change-tab', value: 'todo' | 'tree'): void;
  (event: 'toggle-dir', path: string): void;
  (event: 'select-file', path: string): void;
  (event: 'open-diff', payload: { path: string; staged: boolean }): void;
  (event: 'open-diff-all', payload: { mode: 'staged' | 'changes' | 'all' }): void;
  (event: 'open-file', path: string): void;
  (event: 'reload'): void;
}>();

const tabs = [
  { id: 'todo' as const, label: 'TODO' },
  { id: 'tree' as const, label: 'TREE' },
];

const {
  collapsed,
  activeTab,
  todoSessions,
  treeNodes,
  expandedTreePaths,
  selectedTreePath,
  treeLoading,
  treeError,
  treeStatusByPath,
  treeBranchInfo,
  treeDiffStats,
  treeDirectoryName,
  treeBranchEntries,
  treeBranchListLoading,
  runShellCommand,
} = toRefs(props);
</script>

<style scoped>
.side-panel {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: row;
  border: 1px solid var(--theme-border);
  border-radius: 12px;
  background-clip: padding-box;
  background: var(--theme-bg-overlay);
  box-shadow: 0 10px 24px color-mix(in srgb, var(--theme-bg-base) 35%, transparent);
  overflow: hidden;
}

.side-toggle {
  width: 26px;
  height: 26px;
  border: 1px solid var(--theme-border-subtle);
  border-radius: 6px;
  background: var(--theme-bg-overlay);
  color: var(--theme-text-secondary);
  cursor: pointer;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.side-toggle:hover {
  background: var(--theme-border);
}

.side-body {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.side-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px;
  border-bottom: 1px solid var(--theme-border-subtle);
}

.side-tab {
  flex: 1;
  border: 1px solid var(--theme-border-subtle);
  border-radius: 6px;
  background: color-mix(in srgb, var(--theme-bg-base) 70%, transparent);
  color: var(--theme-text-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  padding: 5px 0;
  cursor: pointer;
}

.side-tab.is-active {
  background: color-mix(in srgb, var(--theme-accent-strong) 10%, var(--theme-bg-base));
  color: var(--theme-text-secondary);
  border-color: color-mix(in srgb, var(--theme-accent) 60%, transparent);
}

.side-panel.is-collapsed {
  border-color: var(--theme-border-subtle);
}

.side-toggle-inline {
  margin-left: auto;
}

.side-toggle-collapsed {
  width: 100%;
  height: 100%;
  border: 0;
  border-radius: 0;
}

/* ── Mobile (< 768px) ── */
@media (max-width: 767px) {
  .side-panel {
    border: none;
  }

  .side-tabs {
    padding: 6px 8px;
  }

  .side-tab {
    font-size: 12px;
    padding: 6px 0;
  }

  /* Hide the inline collapse chevron on mobile — the drawer backdrop/bottom-bar handles closing */
  .side-toggle-inline {
    display: none;
  }
}
</style>
