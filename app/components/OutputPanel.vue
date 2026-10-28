<template>
  <div class="output-panel-root">
    <div class="output-panel-shell" :style="shellStyle">
      <div v-if="projectName" class="project-name-bar">
        {{ projectName }}
      </div>
      <div class="output-panel-main">
        <div
          ref="panelEl"
          class="output-panel-scroll"
          @scroll="handleScroll"
          @wheel="$emit('wheel', $event)"
          @touchmove="$emit('touchmove')"
        >
          <div ref="contentEl" class="output-panel-content" @click="handleContentClick">
            <div
              v-if="initialRenderTrackingActive"
              class="absolute w-full h-full m-auto flex justify-center items-center"
            >
              <div class="app-loading-spinner" aria-hidden="true"></div>
            </div>

            <template v-for="root in visibleRoots" :key="root.id">
              <ThreadBlock
                v-show="!initialRenderTrackingActive && shouldRenderRoot(root)"
                :root="root"
                :theme="theme"
                :files-with-basenames="filesWithBasenames"
                :is-reverted-preview="isRevertedPreview(root)"
                :resolve-agent-color="resolveAgentColor"
                :resolve-model-meta="resolveModelMeta"
                :compute-context-percent="computeContextPercent"
                :session-revert="sessionRevert"
                :assistant-html="getAssistantHtml(root.id)"
                :deferred-transition-key="getDeferredTransitionKey(root)"
                :pending-permission="resolvePendingPermission?.(root) ?? null"
                @fork-message="emit('fork-message', $event)"
                @revert-message="emit('revert-message', $event)"
                @undo-revert="emit('undo-revert')"
                @show-message-diff="emit('show-message-diff', $event)"
                @open-image="emit('open-image', $event)"
                @show-thread-history="emit('show-thread-history', $event)"
                @message-rendered="handleMessageRendered"
                @open-permissions="emit('open-permissions')"
                @permission-reply="emit('permission-reply', $event)"
              />
            </template>

            <FileRefPopup ref="fileRefPopupRef" :files="files" @open-file="handlePopupOpenFile" />
          </div>
        </div>

        <button
          v-show="!isFollowing"
          type="button"
          class="follow-button"
          aria-label="Scroll to latest"
          @click="$emit('resume-follow')"
        >
          <Icon name="lucide:arrow-down" :size="14" />
        </button>
      </div>

      <StatusBar
        :thinking-display-text="thinkingDisplayText"
        :status-text="statusText"
        :is-status-error="isStatusError"
        :is-retry-status="!!isRetryStatus"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import FileRefPopup from './FileRefPopup.vue';
import StatusBar from './StatusBar.vue';
import ThreadBlock from './ThreadBlock.vue';
import { useFileTree } from '../composables/useFileTree';
import { useInitialRenderTracking } from '../composables/useInitialRenderTracking';
import { useMessages } from '../composables/useMessages';
import { useAssistantPreRenderer } from '../composables/useAssistantPreRenderer';
import { useThinkingAnimation } from '../composables/useThinkingAnimation';
import type {
  HistoryWindowEntry,
  MessageDiffEntry,
  MessageTokens,
  ModelMeta,
} from '../types/message';
import type { MessageInfo } from '../types/sse';

const msg = useMessages();

const props = defineProps<{
  isFollowing: boolean;
  statusText: string;
  isStatusError: boolean;
  isThinking: boolean;
  isRetryStatus?: boolean;
  busyDescendantCount?: number;
  theme: string;
  resolveAgentColor?: (agent?: string) => string;
  resolveModelMeta?: (modelPath?: string) => ModelMeta | undefined;
  computeContextPercent?: (
    tokens: MessageTokens,
    providerId?: string,
    modelId?: string,
  ) => number | null;
  projectName?: string;
  projectColor?: string;
  sessionRevert?: {
    messageID: string;
    partID?: string;
    snapshot?: string;
    diff?: string;
  } | null;
  /** Resolves the pending permission request that belongs to a thread root. */
  resolvePendingPermission?: (
    root: MessageInfo,
  ) => { id: string; permission: string; isSubmitting?: boolean } | null;
}>();

const emit = defineEmits<{
  (event: 'scroll'): void;
  (event: 'open-permissions'): void;
  (
    event: 'permission-reply',
    payload: { requestId: string; reply: 'once' | 'always' | 'reject' },
  ): void;
  (event: 'wheel', eventArg: WheelEvent): void;
  (event: 'touchmove'): void;
  (event: 'resume-follow'): void;
  (event: 'fork-message', payload: { sessionId: string; messageId: string }): void;
  (event: 'revert-message', payload: { sessionId: string; messageId: string }): void;
  (event: 'undo-revert'): void;
  (event: 'show-message-diff', payload: { messageKey: string; diffs: MessageDiffEntry[] }): void;
  (event: 'open-image', payload: { url: string; filename: string }): void;
  (event: 'show-thread-history', payload: { entries: HistoryWindowEntry[] }): void;
  (event: 'open-file', path: string, lines?: string): void;
  (event: 'show-commit', hash: string): void;
  (event: 'message-rendered'): void;
  (event: 'content-resized'): void;
  (event: 'initial-render-complete'): void;
}>();

const visibleRoots = computed(() => msg.roots.value);

const revertedPreviewRootId = computed(() => {
  const revert = props.sessionRevert;
  if (!revert?.messageID) return null;
  for (const root of visibleRoots.value) {
    if (root.role !== 'user') continue;
    if (root.id >= revert.messageID) return root.id;
  }
  return null;
});

const { files, fileCacheVersion } = useFileTree();

const filesWithBasenames = computed(() => {
  const set = new Set<string>();
  for (const path of files.value) {
    const segments = path.split('/');
    for (let i = 0; i < segments.length; i++) {
      set.add(segments.slice(i).join('/'));
    }
  }
  return Array.from(set);
});

function getFinalAnswer(root: MessageInfo): MessageInfo | undefined {
  return msg.getFinalAnswer(root.id);
}

function hasAssistantMessages(root: MessageInfo): boolean {
  return msg.hasAssistantMessages(root.id);
}

function getFinalAnswerContent(root: MessageInfo): string {
  const final = getFinalAnswer(root);
  if (!final) return '';
  return msg.getTextContent(final.id);
}

function getThreadUserRenderKey(root: MessageInfo): string {
  return `thread-user:${root.id}`;
}

function getThreadAssistantRenderKey(root: MessageInfo): string {
  const final = getFinalAnswer(root);
  return getThreadAssistantRenderKeyById(root.id, final?.id);
}

function getThreadAssistantRenderKeyById(rootId: string, answerId?: string): string {
  return `thread-assistant:${rootId}:${answerId ?? 'none'}`;
}

function getThreadTransitionKey(root: MessageInfo): string {
  return getFinalAnswer(root)?.id ?? root.id;
}

const { initialRenderTrackingActive, beginInitialRenderTracking, handleMessageRendered } =
  useInitialRenderTracking({
    visibleRoots,
    hasAssistantMessages,
    getThreadUserRenderKey,
    getThreadAssistantRenderKey,
    onInitialRenderComplete: () => emit('initial-render-complete'),
    onMessageRendered: () => emit('message-rendered'),
  });

const { getAssistantHtml, getDeferredTransitionKey } = useAssistantPreRenderer({
  visibleRoots,
  theme: computed(() => props.theme),
  fileCacheVersion,
  filesWithBasenames,
  getFinalAnswer,
  hasAssistantMessages,
  getFinalAnswerContent,
  getThreadTransitionKey,
  getThreadAssistantRenderKeyById,
  onRendered: handleMessageRendered,
});

const { thinkingDisplayText } = useThinkingAnimation(
  computed(() => props.isThinking),
  computed(() => props.busyDescendantCount ?? 0),
);

function isRevertedRoot(root: MessageInfo): boolean {
  const revert = props.sessionRevert;
  if (!revert?.messageID) return false;
  return root.id >= revert.messageID;
}

function isRevertedPreview(root: MessageInfo): boolean {
  return revertedPreviewRootId.value === root.id;
}

function shouldRenderRoot(root: MessageInfo): boolean {
  if (!isRevertedRoot(root)) return true;
  return isRevertedPreview(root);
}

const panelEl = ref<HTMLDivElement | null>(null);
const contentEl = ref<HTMLDivElement | null>(null);
const fileRefPopupRef = ref<{
  handleContentClick: (event: MouseEvent) => void;
  closeFilePopup: () => void;
} | null>(null);
let contentResizeObserver: ResizeObserver | undefined;

function handleScroll() {
  emit('scroll');
}

function handleContentClick(event: MouseEvent) {
  fileRefPopupRef.value?.handleContentClick(event);
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const commitRefEl = target.closest('[data-commit-ref]');
  if (!(commitRefEl instanceof HTMLElement)) return;
  const hash = commitRefEl.dataset.commitRef?.trim();
  if (!hash) return;
  emit('show-commit', hash);
}

function handlePopupOpenFile(path: string, lines?: string) {
  emit('open-file', path, lines);
}

function setupContentResizeObserver() {
  contentResizeObserver?.disconnect();
  contentResizeObserver = undefined;
  if (typeof ResizeObserver === 'undefined') return;
  const target = contentEl.value;
  if (!target) return;
  contentResizeObserver = new ResizeObserver(() => {
    emit('content-resized');
  });
  contentResizeObserver.observe(target);
}

watch(contentEl, () => {
  setupContentResizeObserver();
});

onMounted(() => {
  setupContentResizeObserver();
  nextTick(() => {
    beginInitialRenderTracking();
    emit('content-resized');
  });
});

onBeforeUnmount(() => {
  contentResizeObserver?.disconnect();
  contentResizeObserver = undefined;
  fileRefPopupRef.value?.closeFilePopup();
});

const shellStyle = computed(() => {
  if (!props.projectColor) return undefined;
  return { '--project-tint': props.projectColor } as Record<string, string>;
});

const theme = computed(() => props.theme);
const resolveAgentColor = computed(() => props.resolveAgentColor);
const resolveModelMeta = computed(() => props.resolveModelMeta);
const computeContextPercent = computed(() => props.computeContextPercent);
const sessionRevert = computed(() => props.sessionRevert);
const statusText = computed(() => props.statusText);
const isStatusError = computed(() => props.isStatusError);
const isRetryStatus = computed(() => props.isRetryStatus);
const isFollowing = computed(() => props.isFollowing);

defineExpose({ panelEl });
</script>

<style scoped>
.output-panel-root {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  height: 100%;
  min-height: 0;
}

.output-panel-shell {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  position: relative;
  background-color: var(--theme-bg-overlay);
  background-image: linear-gradient(
    color-mix(in srgb, var(--project-tint, transparent) 9%, transparent),
    color-mix(in srgb, var(--project-tint, transparent) 9%, transparent)
  );
  color: var(--theme-text-secondary);
  border: 1px solid var(--theme-border);
  border-radius: 12px;
  background-clip: padding-box;
  box-shadow: 0 12px 32px color-mix(in srgb, var(--theme-bg-base) 45%, transparent);
  display: flex;
  flex-direction: column;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
  font-size: 13px;
}

.output-panel-scroll {
  display: flex;
  flex-direction: column;
  padding: 0;
  min-height: 0;
  flex: 1 1 auto;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  mask-image: linear-gradient(
    to bottom,
    transparent,
    black 12px,
    black calc(100% - 12px),
    transparent
  );
}

.output-panel-main {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1 1 auto;
}

.output-panel-content {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 12px 12px;
}

.output-panel-content :deep(.markdown-host code.file-ref) {
  cursor: pointer;
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, var(--theme-info) 40%, transparent);
  text-underline-offset: 2px;
}

.output-panel-content :deep(.markdown-host code.file-ref:hover) {
  text-decoration-color: var(--theme-info);
  color: var(--theme-info);
}

.output-panel-content :deep(.markdown-host code.commit-ref) {
  cursor: pointer;
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, var(--theme-info) 40%, transparent);
  text-decoration-style: dotted;
  text-underline-offset: 2px;
}

.output-panel-content :deep(.markdown-host code.commit-ref:hover) {
  text-decoration-color: var(--theme-info);
  text-decoration-style: dotted;
  color: var(--theme-info);
}

.output-panel-content :deep(.markdown-host code.color-ref::before) {
  content: '';
  display: inline-block;
  width: 0.85em;
  height: 0.85em;
  margin-right: 0.35em;
  vertical-align: middle;
  background-color: var(--preview-color);
  border: 1px solid color-mix(in srgb, #fff 35%, transparent);
  border-radius: 2px;
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--theme-bg-base) 50%, transparent);
}

.project-name-bar {
  flex: 0 0 auto;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.03em;
  color: color-mix(
    in srgb,
    var(--project-tint, var(--theme-text-muted)) 60%,
    var(--theme-text-muted)
  );
  padding: 12px 12px 0;
  user-select: none;
}

.follow-button {
  position: absolute;
  left: 50%;
  bottom: 10px;
  transform: translateX(-50%);
  width: 36px;
  height: 36px;
  aspect-ratio: 1 / 1;
  box-sizing: border-box;
  border-radius: 999px;
  border: 1px solid var(--theme-border);
  background: var(--theme-bg-overlay);
  color: var(--theme-text-secondary);
  font-size: 18px;
  line-height: 1;
  display: grid;
  place-items: center;
  box-shadow: 0 10px 24px color-mix(in srgb, var(--theme-bg-base) 45%, transparent);
  cursor: pointer;
  z-index: 3;
}

.follow-button:hover {
  background: var(--theme-bg-overlay);
}

.app-loading-spinner {
  width: 26px;
  height: 26px;
  margin: 0 auto 12px;
  border-radius: 50%;
  border: 3px solid var(--theme-border-subtle);
  border-top-color: var(--theme-text-secondary);
  animation: app-loading-spin 0.85s linear infinite;
}

@keyframes app-loading-spin {
  to {
    transform: rotate(360deg);
  }
}

/* ── Mobile (< 768px) ── */
@media (max-width: 767px) {
  .output-panel-scroll {
    overflow-x: hidden;
    scrollbar-gutter: auto;
  }

  .output-panel-content {
    padding: 6px 8px 10px;
  }

  .follow-button {
    width: 32px;
    height: 32px;
    bottom: 8px;
  }
}
</style>
