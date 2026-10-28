<template>
  <div class="app-main-column">
    <nav class="main-tabs" aria-label="Session view">
      <button
        v-for="tab in mainTabs"
        :key="tab.id"
        type="button"
        class="main-tab"
        :class="{ 'is-active': mainTab === tab.id }"
        :aria-current="mainTab === tab.id ? 'page' : undefined"
        @click="setMainTab(tab.id)"
      >
        <Icon :name="tab.icon" :size="13" />
        {{ tab.label }}
      </button>
    </nav>
    <main :ref="bindOutputEl" class="app-output">
      <div class="output-workspace">
        <div class="tool-window-layer">
          <div v-show="mainTab === 'trajectory'" class="output-split">
            <TrajectoryPanel
              class="output-panel"
              :session-id="selectedSessionId"
              :active="mainTab === 'trajectory'"
            />
          </div>
          <div v-show="mainTab === 'chat'" class="output-split">
            <OutputPanel
              :ref="bindPanelRef"
              :key="selectedSessionId"
              class="output-panel"
              :project-name="currentProjectName"
              :project-color="currentProjectColor"
              :is-following="isFollowing"
              :status-text="statusText"
              :is-status-error="isStatusError"
              :is-thinking="isThinking"
              :is-retry-status="!!retryStatus"
              :busy-descendant-count="busyDescendantSessionIds.length"
              :theme="shikiTheme"
              :resolve-agent-color="resolveAgentColorForName"
              :resolve-model-meta="resolveModelMetaForPath"
              :compute-context-percent="computeContextPercent"
              :session-revert="sessionRevert"
              :resolve-pending-permission="resolvePendingPermissionForRoot"
              @message-rendered="handleContentChange"
              @open-permissions="openToolPermissions"
              @permission-reply="handlePermissionReply"
              @resume-follow="resumeFollow"
              @fork-message="handleForkMessage"
              @revert-message="handleRevertMessage"
              @undo-revert="handleUndoRevert"
              @show-message-diff="showMessageDiff"
              @show-commit="showCommit"
              @show-thread-history="showThreadHistory"
              @edit-message="editMessage"
              @open-image="openImage"
              @open-file="openFileViewer"
              @content-resized="handleContentChange"
              @initial-render-complete="handleInitialRenderComplete"
            />
          </div>
        </div>
      </div>
    </main>
    <!-- The composer lives inside the main column so the flex layout holds. -->
    <slot />
  </div>
</template>

<script lang="ts" setup>
/** The session view: chat and trajectory tabs over one output area. */
import { computed } from 'vue';
import OutputPanel from '~/components/OutputPanel.vue';
import TrajectoryPanel from '~/components/Trajectory/TrajectoryPanel.vue';
import type { SessionEntry } from '~/types/session';
import { useAppContext } from '~/composables/useAppContext';
import { useComposer } from '~/composables/useComposer';
import { useFileViewers } from '~/composables/useFileViewers';
import { useGitSnapshots } from '~/composables/useGitSnapshots';
import { useOutputScroller } from '~/composables/useOutputScroller';
import { usePermissionRouting } from '~/composables/usePermissionRouting';
import { useProviderCatalog } from '~/composables/useProviderCatalog';
import { useSessionActions } from '~/composables/useSessionActions';
import { useSessionCatalog } from '~/composables/useSessionCatalog';
import { useShellLayout } from '~/composables/useShellLayout';
import { useToolWindows } from '~/composables/useToolWindows';

const { serverState, selection } = useAppContext();
const { selectedProjectId, selectedSessionId } = selection;
const { bindOutputEl, mainTab, mainTabs, setMainTab } = useShellLayout();
const { currentProjectName, currentProjectColor, retryStatus } = useSessionCatalog();
const { statusText, isStatusError, isThinking, busyDescendantSessionIds } = useComposer();
const { shikiTheme, openFileViewer, openImage } = useFileViewers();
const { resolveAgentColorForName, resolveModelMetaForPath, computeContextPercent } =
  useProviderCatalog();
const { openToolPermissions, handlePermissionReply, resolvePendingPermissionForRoot } =
  usePermissionRouting();
const { handleForkMessage, handleRevertMessage, handleUndoRevert } = useSessionActions();
const { showMessageDiff, showCommit } = useGitSnapshots();
const { showThreadHistory, editMessage } = useToolWindows();
const {
  bindPanelRef,
  isFollowing,
  resumeFollow,
  handleContentChange,
  handleInitialRenderComplete,
} = useOutputScroller();

/** The revert marker stored on the selected session, if any. */
const sessionRevert = computed<SessionEntry['revert'] | null>(() => {
  const projectId = selectedProjectId.value.trim();
  const sessionId = selectedSessionId.value.trim();
  if (!projectId || !sessionId) return null;
  const project = serverState.projects[projectId];
  if (!project) return null;
  for (const sandbox of Object.values(project.sandboxes)) {
    const session = sandbox.sessions[sessionId];
    if (session) return session.revert ?? null;
  }
  return null;
});
</script>
