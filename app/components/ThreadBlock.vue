<template>
  <div class="thread-block" :class="{ 'is-reverted-preview': isRevertedPreview }">
    <button
      v-if="isRevertedPreview"
      type="button"
      class="ib-action ib-action-undo ib-top-right"
      @click="confirmUndoRevert()"
    >
      UNDO
    </button>
    <button
      v-else-if="root.role === 'user' && root.sessionID"
      type="button"
      class="ib-action ib-top-right"
      @click="confirmFork()"
    >
      FORK
    </button>

    <div class="thread-user" :style="getUserBoxStyle()">
      <div
        v-if="root.role === 'user'"
        class="ib-msg-block ib-msg-user"
        :class="{ 'ib-msg-user-reverted': isRevertedPreview }"
      >
        <div class="ib-msg-row">
          <MessageViewer
            class="message-viewer-context-user"
            :key="`user-${root.id}`"
            :code="getMessageContent(root)"
            :lang="'markdown'"
            :theme="theme"
            :files="filesWithBasenames"
            copy-button
            @rendered="emit('message-rendered', getThreadUserRenderKey(root))"
          />
          <div v-if="getMessageAttachments(root).length > 0" class="output-entry-attachments">
            <img
              v-for="item in getMessageAttachments(root)"
              :key="item.id"
              class="output-entry-attachment clickable"
              :src="item.url"
              :alt="item.filename"
              loading="lazy"
              @click="emit('open-image', { url: item.url, filename: item.filename })"
            />
          </div>
        </div>
      </div>
    </div>

    <ThreadTarget
      v-if="!isRevertedPreview"
      :target="threadTarget"
      :agent-style="threadTargetAgentStyle"
    />

    <div v-if="!isRevertedPreview && hasAssistantMessages(root)" class="thread-assistant">
      <Transition name="ib-fade" mode="out-in">
        <div class="ib-msg-block ib-msg-assistant" :key="deferredTransitionKey">
          <div class="ib-msg-body">
            <MessageViewer
              class="message-viewer-context-assistant"
              :html="assistantHtml"
              copy-button
            />
          </div>
          <div
            v-if="getMessageAttachments(getFinalAnswer(root)).length > 0"
            class="output-entry-attachments"
          >
            <img
              v-for="item in getMessageAttachments(getFinalAnswer(root))"
              :key="item.id"
              class="output-entry-attachment clickable"
              :src="item.url"
              :alt="item.filename"
              loading="lazy"
              @click="emit('open-image', { url: item.url, filename: item.filename })"
            />
          </div>
          <button
            v-if="showHistoryButton(root)"
            type="button"
            class="ib-action ib-action-history"
            :title="`${getHistoryEntries(root).length} entries - click to view history`"
            @click="showThreadHistory(root)"
          >
            History ({{ getHistoryEntries(root).length }})
          </button>
        </div>
      </Transition>
    </div>

    <div
      v-if="!isRevertedPreview && getThreadError(root)"
      class="ib-error-bar"
      :class="{ 'is-expanded': errorExpanded, 'is-blocked': Boolean(threadBlocked) }"
      @click="errorExpanded = !errorExpanded"
    >
      <div class="ib-error-summary">
        <span class="ib-error-icon">{{ threadBlocked ? '⛔' : '⊘' }}</span>
        <span v-if="threadBlocked" class="ib-blocked-chip">blocked</span>
        <span v-else-if="threadModelError" class="ib-model-chip">model</span>
        <span class="ib-error-text">{{ formatMessageError(getThreadError(root)!) }}</span>
        <span
          v-if="threadBlocked && !threadBlocked.grantable"
          class="ib-blocked-note"
          title="This cannot be granted at runtime; it is fixed in opencode.json."
        >
          config-only
        </span>
        <span class="ib-error-caret">{{ errorExpanded ? '▲' : '▼' }}</span>
      </div>

      <!-- One-click approval when a matching permission request is still pending. -->
      <div v-if="inlinePermissionRequest" class="ib-allow-actions" @click.stop>
        <button
          type="button"
          class="ib-allow-button is-once"
          :disabled="inlineSubmitting"
          @click="replyInline('once')"
        >
          Allow once
        </button>
        <button
          type="button"
          class="ib-allow-button is-always"
          :disabled="inlineSubmitting"
          @click="replyInline('always')"
        >
          Always allow
        </button>
        <button
          type="button"
          class="ib-allow-button is-reject"
          :disabled="inlineSubmitting"
          @click="replyInline('reject')"
        >
          Deny
        </button>
      </div>

      <div v-if="errorExpanded" class="ib-error-details" @click.stop>
        <div v-if="threadBlocked" class="ib-error-detail-row">
          <span class="ib-error-detail-label">Why</span>
          <span class="ib-error-detail-value">{{ threadBlocked.explanation }}</span>
        </div>
        <div v-if="threadModelError" class="ib-error-detail-row">
          <span class="ib-error-detail-label">Why</span>
          <span class="ib-error-detail-value">{{ threadModelError.explanation }}</span>
        </div>
        <div v-if="threadBlocked || threadModelError" class="ib-error-detail-row">
          <span class="ib-error-detail-label">Raw</span>
          <span class="ib-error-detail-value">{{ getThreadError(root)!.message }}</span>
        </div>
        <div v-if="getThreadError(root)!.statusCode != null" class="ib-error-detail-row">
          <span class="ib-error-detail-label">Status</span>
          <span class="ib-error-detail-value">{{ getThreadError(root)!.statusCode }}</span>
        </div>
        <div
          v-if="getThreadError(root)!.responseBody"
          class="ib-error-detail-row ib-error-body-row"
        >
          <span class="ib-error-detail-label">Response</span>
          <pre class="ib-error-body">{{ getThreadError(root)!.responseBody }}</pre>
        </div>
        <button type="button" class="ib-allow-button is-panel" @click="emit('open-permissions')">
          Open tool permissions
        </button>
      </div>
    </div>

    <ThreadFooter
      v-if="!isRevertedPreview"
      :timestamp="formatThreadTimestamp(root)"
      :elapsed="formatThreadElapsed(root)"
      :context-percent="getThreadContextPercent(root)"
      :tokens="getThreadTokens(root)"
      :has-diffs="hasThreadDiffs(root)"
      :can-revert="canRevertThread(root)"
      @show-diff="showThreadDiff(root)"
      @revert="confirmRevert(root)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, Transition } from 'vue';
import MessageViewer from './MessageViewer.vue';
import ThreadFooter from './ThreadFooter.vue';
import ThreadTarget from './ThreadTarget.vue';
import { useMessages } from '../composables/useMessages';
import type {
  HistoryEntry,
  HistoryWindowEntry,
  MessageAttachment,
  MessageDiffEntry,
  MessageTokens,
  MessageUsage,
  ModelMeta,
  ThreadTarget as ThreadTargetType,
} from '../types/message';
import type { MessageInfo, QuestionInfo, ToolPart } from '../types/sse';
import {
  detectBlockedTool,
  detectModelError,
  formatElapsedTime,
  formatMessageError,
  formatMessageTime,
} from '../utils/formatters';

const HISTORY_TOOL_NAMES = new Set(['bash', 'write', 'edit', 'multiedit', 'apply_patch']);

const props = defineProps<{
  root: MessageInfo;
  theme: string;
  filesWithBasenames: string[];
  isRevertedPreview: boolean;
  resolveAgentColor?: (agent?: string) => string;
  resolveModelMeta?: (modelPath?: string) => ModelMeta | undefined;
  computeContextPercent?: (
    tokens: MessageTokens,
    providerId?: string,
    modelId?: string,
  ) => number | null;
  sessionRevert?: {
    messageID: string;
    partID?: string;
    snapshot?: string;
    diff?: string;
  } | null;
  assistantHtml?: string;
  deferredTransitionKey: string;
  /**
   * Pending permission request matching this thread, if any. When present the
   * error bar renders inline approve/deny buttons.
   */
  pendingPermission?: {
    id: string;
    permission: string;
    isSubmitting?: boolean;
  } | null;
}>();

const emit = defineEmits<{
  (event: 'fork-message', payload: { sessionId: string; messageId: string }): void;
  (event: 'revert-message', payload: { sessionId: string; messageId: string }): void;
  (event: 'undo-revert'): void;
  (event: 'show-message-diff', payload: { messageKey: string; diffs: MessageDiffEntry[] }): void;
  (event: 'open-image', payload: { url: string; filename: string }): void;
  (event: 'show-thread-history', payload: { entries: HistoryWindowEntry[] }): void;
  (event: 'message-rendered', renderKey: string): void;
  (event: 'open-permissions'): void;
  (
    event: 'permission-reply',
    payload: { requestId: string; reply: 'once' | 'always' | 'reject' },
  ): void;
}>();

const msg = useMessages();

const errorExpanded = ref(false);

/** Blocked-tool description for the current thread error, if it is one. */
const threadBlocked = computed(() => {
  const error = getThreadError(props.root);
  return error ? detectBlockedTool(error) : null;
});

/** Model-level failure (unsupported / missing / auth / quota), if applicable. */
const threadModelError = computed(() => {
  const error = getThreadError(props.root);
  if (!error || threadBlocked.value) return null;
  return detectModelError(error);
});

/**
 * Only surface inline allow buttons when the block is actually grantable and a
 * matching request is still pending. Otherwise the buttons would be dead.
 */
const inlinePermissionRequest = computed(() => {
  if (!props.pendingPermission) return null;
  if (threadBlocked.value && !threadBlocked.value.grantable) return null;
  return props.pendingPermission;
});

const inlineSubmitting = computed(() => Boolean(props.pendingPermission?.isSubmitting));

function replyInline(reply: 'once' | 'always' | 'reject') {
  const request = inlinePermissionRequest.value;
  if (!request || inlineSubmitting.value) return;
  emit('permission-reply', { requestId: request.id, reply });
}

const threadTarget = computed<ThreadTargetType>(() => buildThreadTarget(props.root));
const threadTargetAgentStyle = computed(() => {
  const color = props.resolveAgentColor
    ? props.resolveAgentColor(threadTarget.value.agent)
    : '#4ade80';
  return { color };
});

function getThread(rootId: string): MessageInfo[] {
  return msg.getThread(rootId);
}

function getFinalAnswer(root: MessageInfo): MessageInfo | undefined {
  return msg.getFinalAnswer(root.id);
}

function hasTextContent(message?: MessageInfo): boolean {
  if (!message) return false;
  return msg.hasTextContent(message.id);
}

function getMessageContent(message?: MessageInfo): string {
  if (!message) return '';
  return msg.getTextContent(message.id);
}

function getMessageAttachments(message?: MessageInfo): MessageAttachment[] {
  if (!message) return [];
  return msg.getImageAttachments(message.id) ?? [];
}

function getMessageError(
  message?: MessageInfo,
): { name: string; message: string; statusCode?: number; responseBody?: string } | null {
  if (!message) return null;
  return msg.getError(message.id);
}

function getMessageUsage(message?: MessageInfo): MessageUsage | undefined {
  if (!message) return undefined;
  return msg.getUsage(message.id);
}

function getMessageDiffEntries(message?: MessageInfo): MessageDiffEntry[] {
  if (!message) return [];
  return msg.getDiffs(message.id) ?? [];
}

function getMessageModelPath(message?: MessageInfo): string {
  if (!message) return '';
  return msg.getModelPath(message.id) ?? '';
}

function getMessageTime(message?: MessageInfo): number | undefined {
  if (!message) return undefined;
  return msg.getTime(message.id);
}

function hasAssistantMessages(root: MessageInfo): boolean {
  return msg.hasAssistantMessages(root.id);
}

function getToolPartTime(part: ToolPart): number {
  const state = part.state;
  if (state.status === 'running' || state.status === 'completed' || state.status === 'error') {
    return state.time.start;
  }
  return 0;
}

function extractQuestionInfos(part: ToolPart): QuestionInfo[] {
  const raw = part.state.input?.questions;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (q): q is QuestionInfo =>
      q &&
      typeof q === 'object' &&
      typeof q.question === 'string' &&
      typeof q.header === 'string' &&
      Array.isArray(q.options),
  );
}

function resolveQuestionStatus(part: ToolPart): 'pending' | 'replied' | 'rejected' {
  if (part.state.status === 'completed') return 'replied';
  if (part.state.status === 'error') return 'rejected';
  return 'pending';
}

function extractQuestionAnswers(part: ToolPart): string[][] | undefined {
  if (part.state.status !== 'completed') return undefined;
  const answers = part.state.metadata?.answers;
  if (!Array.isArray(answers)) return undefined;
  return answers as string[][];
}

function getHistoryEntries(root: MessageInfo): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  const thread = getThread(root.id);
  for (const msgInfo of thread) {
    if (msgInfo.role !== 'assistant') continue;
    if (hasTextContent(msgInfo)) {
      entries.push({ kind: 'message', message: msgInfo, time: msgInfo.time.created });
    }
    const parts = msg.getParts(msgInfo.id);
    for (const part of parts) {
      if (part.type === 'reasoning') {
        if (part.text) {
          entries.push({ kind: 'reasoning', part, time: part.time.start });
        }
        continue;
      }
      if (part.type !== 'tool') continue;
      if (part.state.status === 'pending') continue;
      if (part.tool === 'question') {
        entries.push({ kind: 'question', part, time: getToolPartTime(part) });
        continue;
      }
      if (!HISTORY_TOOL_NAMES.has(part.tool)) continue;
      entries.push({ kind: 'tool', part, time: getToolPartTime(part) });
    }
  }
  return entries.sort((a, b) => a.time - b.time);
}

function getHistoryEntryKey(entry: HistoryEntry): string {
  if (entry.kind === 'message') return `msg:${entry.message.id}`;
  if (entry.kind === 'reasoning') return `reasoning:${entry.part.id}`;
  if (entry.kind === 'question') return `question:${entry.part.callID}`;
  return `tool:${entry.part.callID}`;
}

function showHistoryButton(root: MessageInfo): boolean {
  return getHistoryEntries(root).length > 0;
}

function showThreadHistory(root: MessageInfo) {
  const entries = getHistoryEntries(root).map((entry) => {
    if (entry.kind === 'message') {
      return {
        key: getHistoryEntryKey(entry),
        kind: 'message',
        content: getMessageContent(entry.message),
        time: entry.time,
        agent:
          entry.message.role === 'assistant' && 'agent' in entry.message && entry.message.agent
            ? entry.message.agent
            : undefined,
      } satisfies HistoryWindowEntry;
    }
    if (entry.kind === 'reasoning') {
      return {
        key: getHistoryEntryKey(entry),
        kind: 'reasoning',
        part: entry.part,
        time: entry.time,
      } satisfies HistoryWindowEntry;
    }
    if (entry.kind === 'question') {
      return {
        key: getHistoryEntryKey(entry),
        kind: 'question',
        questions: extractQuestionInfos(entry.part),
        status: resolveQuestionStatus(entry.part),
        answers: extractQuestionAnswers(entry.part),
        time: entry.time,
      } satisfies HistoryWindowEntry;
    }
    return {
      key: getHistoryEntryKey(entry),
      kind: 'tool',
      part: entry.part,
      time: entry.time,
    } satisfies HistoryWindowEntry;
  });
  emit('show-thread-history', { entries });
}

function getThreadError(
  root: MessageInfo,
): { name: string; message: string; statusCode?: number; responseBody?: string } | null {
  const final = getFinalAnswer(root);
  const finalError = getMessageError(final);
  if (finalError) return finalError;
  const thread = getThread(root.id);
  for (let index = thread.length - 1; index >= 0; index--) {
    const error = getMessageError(thread[index]);
    if (error) return error;
  }
  return null;
}

function getThreadDiffs(root: MessageInfo): MessageDiffEntry[] {
  return getMessageDiffEntries(root);
}

function hasThreadDiffs(root: MessageInfo): boolean {
  return getThreadDiffs(root).length > 0;
}

function showThreadDiff(root: MessageInfo) {
  const diffs = getThreadDiffs(root);
  if (diffs.length === 0) return;
  emit('show-message-diff', { messageKey: root.id, diffs });
}

function canRevertThread(root: MessageInfo): boolean {
  if (props.sessionRevert) return false;
  return root.role === 'user' && Boolean(root.sessionID);
}

function confirmFork() {
  const root = props.root;
  if (root.role !== 'user' || !root.sessionID || !root.id) return;
  if (!window.confirm('Fork from this message?')) return;
  emit('fork-message', { sessionId: root.sessionID, messageId: root.id });
}

function confirmRevert(root: MessageInfo) {
  if (root.role !== 'user' || !root.sessionID || !root.id) return;
  if (!window.confirm('Revert to this message?')) return;
  emit('revert-message', { sessionId: root.sessionID, messageId: root.id });
}

function confirmUndoRevert() {
  if (!props.sessionRevert) return;
  if (!window.confirm('Undo revert?')) return;
  emit('undo-revert');
}

function buildThreadTarget(root: MessageInfo): ThreadTargetType {
  const final = getFinalAnswer(root);
  const agent = root.agent ?? final?.agent;
  const modelPath = getMessageModelPath(root) || getMessageModelPath(final);
  const modelMeta = props.resolveModelMeta?.(modelPath);
  const variant = root.variant ?? final?.variant;
  return {
    agent,
    modelDisplayName: modelMeta?.displayName,
    providerLabel: modelMeta?.providerLabel,
    variant,
  };
}

function getUserBoxStyle() {
  const final = getFinalAnswer(props.root);
  const color = props.resolveAgentColor
    ? props.resolveAgentColor(props.root.agent ?? final?.agent)
    : '#334155';
  if (color.startsWith('#') && color.length === 7) {
    return { borderLeftColor: `${color}99` };
  }
  return { borderLeftColor: color };
}

function formatThreadTimestamp(root: MessageInfo): string {
  return formatMessageTime(getMessageTime(getFinalAnswer(root)) ?? getMessageTime(root));
}

function getCompletedTime(message?: MessageInfo): number | undefined {
  if (!message) return undefined;
  return msg.getCompletedTime(message.id);
}

function formatThreadElapsed(root: MessageInfo): string {
  const final = getFinalAnswer(root);
  return formatElapsedTime(getMessageTime(root), getCompletedTime(final));
}

function getThreadTokens(root: MessageInfo): MessageTokens | null {
  const thread = getThread(root.id);
  let input = 0;
  let output = 0;
  let reasoning = 0;
  let totalAcc = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let found = false;

  for (const m of thread) {
    if (m.role !== 'assistant') continue;
    const usage = getMessageUsage(m);
    if (!usage) continue;
    const t = usage.tokens;
    if (t.input <= 0 && t.output <= 0) continue;
    input += t.input;
    output += t.output;
    reasoning += t.reasoning;
    totalAcc += t.total ?? 0;
    cacheRead += t.cache?.read ?? 0;
    cacheWrite += t.cache?.write ?? 0;
    found = true;
  }

  if (!found) return null;
  return {
    input,
    output,
    reasoning,
    total: totalAcc || undefined,
    cache: { read: cacheRead, write: cacheWrite },
  };
}

function getThreadContextPercent(root: MessageInfo): number | null {
  if (!props.computeContextPercent) return null;
  const thread = getThread(root.id);
  let lastUsage: MessageUsage | undefined;

  for (const m of thread) {
    if (m.role !== 'assistant') continue;
    const usage = getMessageUsage(m);
    if (usage && (usage.tokens.input > 0 || usage.tokens.output > 0)) {
      lastUsage = usage;
    }
  }

  if (!lastUsage) return null;
  const value = props.computeContextPercent(
    lastUsage.tokens,
    lastUsage.providerId,
    lastUsage.modelId,
  );
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

function getThreadUserRenderKey(root: MessageInfo): string {
  return `thread-user:${root.id}`;
}
</script>

<style scoped>
.thread-block {
  background: color-mix(in srgb, var(--theme-bg-base) 60%, transparent);
  border: 1px solid var(--theme-border-subtle);
  border-radius: 10px;
  padding: 10px;
  width: 100%;
  box-sizing: border-box;
  margin: 0;
}

.thread-block.is-reverted-preview > .thread-user {
  opacity: 0.45;
}

.thread-block.is-reverted-preview > .ib-top-right {
  position: relative;
  z-index: 1;
}

.thread-user {
  border-left: 3px solid;
  padding-left: 8px;
  width: 100%;
  box-sizing: border-box;
}

.ib-msg-block {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ib-msg-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ib-msg-user {
  font-size: 13px;
  padding: 4px 0;
}

.ib-msg-user-reverted {
  text-decoration: line-through;
}

.ib-msg-assistant {
  margin-top: 4px;
}

.thread-assistant {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 4px;
}

.ib-msg-body {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 13px;
  --message-line-height: 1.2;
  line-height: var(--message-line-height);
  padding-top: 3px;
  padding-left: 6px;
}

.ib-top-right {
  float: right;
  margin: -2px -2px 4px 8px;
}

.ib-action {
  border: 1px solid var(--theme-border-subtle);
  border-radius: 6px;
  background: color-mix(in srgb, var(--theme-bg-base) 75%, transparent);
  color: var(--theme-info);
  font-size: 10px;
  line-height: 1;
  padding: 3px 7px;
  cursor: pointer;
  white-space: nowrap;
}

.ib-action:hover {
  background: var(--theme-bg-overlay);
}

.ib-action-undo {
  border-color: color-mix(in srgb, var(--theme-accent) 70%, transparent);
  background: color-mix(in srgb, var(--theme-accent-strong) 8%, var(--theme-bg-base));
  color: var(--theme-info);
}

.ib-action-undo:hover {
  background: color-mix(in srgb, var(--theme-accent-strong) 12%, var(--theme-bg-base));
}

.ib-action-history {
  border-color: var(--theme-border-subtle);
  background: var(--theme-bg-hover);
  color: var(--theme-text-muted);
  font-size: 10px;
  margin-top: 4px;
  align-self: flex-end;
}

.ib-action-history:hover {
  background: var(--theme-border-subtle);
  color: var(--theme-text-secondary);
}

.ib-error-bar {
  margin-top: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--theme-danger-strong) 30%, transparent);
  border: 1px solid color-mix(in srgb, var(--theme-danger) 40%, transparent);
  color: var(--theme-danger);
  font-size: 11px;
  line-height: 1.3;
  cursor: pointer;
  user-select: none;
}

.ib-error-bar:hover {
  background: color-mix(in srgb, var(--theme-danger-strong) 45%, transparent);
}

/* Blocked tools are expected, not fatal, so they get a calmer amber treatment. */
.ib-error-bar.is-blocked {
  background: color-mix(in srgb, var(--theme-special, #f59e0b) 16%, transparent);
  border-color: color-mix(in srgb, var(--theme-special, #f59e0b) 45%, transparent);
  color: var(--theme-text-secondary);
}

.ib-error-bar.is-blocked:hover {
  background: color-mix(in srgb, var(--theme-special, #f59e0b) 26%, transparent);
}

.ib-model-chip {
  flex: none;
  border-radius: 999px;
  padding: 0 7px;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  background: color-mix(in srgb, var(--theme-danger-strong) 30%, transparent);
  border: 1px solid color-mix(in srgb, var(--theme-danger) 55%, transparent);
}

.ib-blocked-chip {
  flex: none;
  border-radius: 999px;
  padding: 0 7px;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  background: color-mix(in srgb, var(--theme-special, #f59e0b) 35%, transparent);
  border: 1px solid color-mix(in srgb, var(--theme-special, #f59e0b) 60%, transparent);
}

.ib-blocked-note {
  flex: none;
  font-size: 9px;
  color: var(--theme-text-muted);
  border: 1px dashed var(--theme-border-subtle);
  border-radius: 6px;
  padding: 0 5px;
  cursor: help;
}

.ib-allow-actions {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}

.ib-allow-button {
  border-radius: 6px;
  padding: 3px 9px;
  border: 1px solid var(--theme-border);
  background: var(--theme-bg-base);
  color: var(--theme-text-secondary);
  font-size: 10px;
  cursor: pointer;
}

.ib-allow-button:disabled {
  cursor: wait;
  opacity: 0.6;
}

.ib-allow-button.is-once {
  background: color-mix(in srgb, var(--theme-info) 25%, transparent);
  border-color: color-mix(in srgb, var(--theme-info) 70%, transparent);
}

.ib-allow-button.is-always {
  background: color-mix(in srgb, var(--theme-success) 18%, transparent);
  border-color: color-mix(in srgb, var(--theme-success) 60%, transparent);
}

.ib-allow-button.is-reject {
  background: color-mix(in srgb, var(--theme-danger-strong) 18%, transparent);
  border-color: color-mix(in srgb, var(--theme-danger-strong) 60%, transparent);
}

.ib-allow-button.is-panel {
  align-self: flex-start;
  margin-top: 4px;
}

.ib-error-summary {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ib-error-icon {
  flex-shrink: 0;
  font-size: 13px;
  color: var(--theme-danger);
}

.ib-error-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ib-error-bar.is-expanded .ib-error-text {
  white-space: normal;
  overflow: visible;
  text-overflow: unset;
}

.ib-error-caret {
  flex-shrink: 0;
  font-size: 9px;
  color: var(--theme-danger);
  opacity: 0.7;
}

.ib-error-details {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid color-mix(in srgb, var(--theme-danger) 20%, transparent);
  display: flex;
  flex-direction: column;
  gap: 4px;
  cursor: auto;
}

.ib-error-detail-row {
  display: flex;
  gap: 8px;
  align-items: baseline;
}

.ib-error-detail-label {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--theme-danger);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  opacity: 0.8;
  width: 52px;
}

.ib-error-detail-value {
  font-size: 11px;
  color: var(--theme-danger);
}

.ib-error-body-row {
  align-items: flex-start;
}

.ib-error-body {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 10px;
  font-family: ui-monospace, 'Cascadia Code', monospace;
  color: var(--theme-danger);
  white-space: pre-wrap;
  word-break: break-all;
  background: color-mix(in srgb, #000 20%, transparent);
  border-radius: 4px;
  padding: 4px 6px;
  max-height: 160px;
  overflow-y: auto;
}

.ib-fade-enter-active,
.ib-fade-leave-active {
  transition: opacity 0.3s ease;
}

.ib-fade-enter-from,
.ib-fade-leave-to {
  opacity: 0;
}

.output-entry-attachments {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 6px;
  margin-top: 6px;
}

.output-entry-attachment {
  width: 100%;
  max-height: 180px;
  border-radius: 8px;
  border: 1px solid var(--theme-border-subtle);
  object-fit: cover;
  background: var(--theme-bg-elevated);
}

.output-entry-attachment.clickable {
  cursor: pointer;
}

/* ── Mobile (< 768px) ── */
@media (max-width: 767px) {
  .thread-block {
    padding: 6px;
    overflow-x: hidden;
    min-width: 0;
  }

  .ib-msg-row {
    min-width: 0;
    overflow-x: hidden;
  }

  .ib-msg-body {
    min-width: 0;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  .output-entry-attachments {
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  }
}
</style>
