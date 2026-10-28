<template>
  <div class="tj-detail">
    <div v-if="!event" class="tj-detail-empty">Select a record to inspect it.</div>
    <template v-else>
      <div class="tj-detail-head">
        <span class="tj-kind" :class="`is-${event.kind}`">{{ event.kind.toUpperCase() }}</span>
        <span class="tj-detail-title">{{ event.title }}</span>
        <span class="tj-detail-crumb">Turn {{ event.turn }} · Step {{ event.step || '—' }}</span>
      </div>

      <div class="tj-detail-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="tj-detail-tab"
          :class="{ 'is-active': activeTab === tab.id }"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </div>

      <div class="tj-detail-body">
        <template v-if="activeTab === 'summary'">
          <dl class="tj-fields">
            <dt>Hierarchy</dt>
            <dd>{{ hierarchy }}</dd>
            <dt>Status</dt>
            <dd :class="{ 'is-error': event.status === 'error' }">{{ statusLabel }}</dd>
            <dt v-if="event.agent">Agent</dt>
            <dd v-if="event.agent">{{ event.agent }}</dd>
            <dt v-if="event.model">Model</dt>
            <dd v-if="event.model">{{ event.model }}</dd>
            <dt v-if="tokenSummary">Tokens</dt>
            <dd v-if="tokenSummary">{{ tokenSummary }}</dd>
            <dt v-if="event.callId">Call ID</dt>
            <dd v-if="event.callId" class="tj-mono">{{ event.callId }}</dd>
            <dt>Message ID</dt>
            <dd class="tj-mono">{{ event.messageId }}</dd>
          </dl>

          <details v-if="payloadJson" class="tj-section" open>
            <summary>Payload</summary>
            <pre class="tj-code" v-html="highlightedPayload"></pre>
          </details>

          <details v-if="event.result" class="tj-section" open>
            <summary>Result</summary>
            <pre class="tj-code tj-plain">{{ truncatedResult }}</pre>
          </details>

          <details v-if="event.toolName" class="tj-section">
            <summary>Schema</summary>
            <p class="tj-schema-name">{{ event.toolName }}</p>
            <p class="tj-note">
              Inferred from this call — the server does not publish tool schemas.
            </p>
            <pre class="tj-code" v-html="highlightedSchema"></pre>
          </details>

          <details class="tj-section">
            <summary>Timing</summary>
            <dl class="tj-fields">
              <dt>Started</dt>
              <dd>{{ formatTimestamp(event.time) }}</dd>
              <dt>Duration</dt>
              <dd>{{ formatDuration(event.durationMs) }}</dd>
              <dt>Timing source</dt>
              <dd>Session timestamps</dd>
            </dl>
          </details>
        </template>

        <template v-else-if="activeTab === 'payload'">
          <pre v-if="payloadJson" class="tj-code" v-html="highlightedPayload"></pre>
          <p v-else class="tj-note">This record carries no input payload.</p>
        </template>

        <template v-else-if="activeTab === 'result'">
          <pre v-if="event.result" class="tj-code tj-plain">{{ event.result }}</pre>
          <p v-else class="tj-note">No result recorded{{ pendingHint }}.</p>
        </template>

        <template v-else-if="activeTab === 'schema'">
          <template v-if="event.toolName">
            <p class="tj-schema-name">{{ event.toolName }}</p>
            <p class="tj-note">
              Inferred from this call — the server does not publish tool schemas.
            </p>
            <pre class="tj-code" v-html="highlightedSchema"></pre>
          </template>
          <p v-else class="tj-note">Schemas apply to tool calls only.</p>
        </template>

        <template v-else>
          <dl class="tj-fields">
            <dt>Started</dt>
            <dd>{{ formatTimestamp(event.time) }}</dd>
            <dt>Ended</dt>
            <dd>{{ formatTimestamp(event.endTime) }}</dd>
            <dt>Duration</dt>
            <dd>{{ formatDuration(event.durationMs) }}</dd>
            <dt>Offset</dt>
            <dd>{{ offsetLabel }}</dd>
            <dt>Timing source</dt>
            <dd>Session timestamps</dd>
          </dl>
          <details class="tj-section">
            <summary>Raw record</summary>
            <pre class="tj-code" v-html="highlightedRaw"></pre>
          </details>
        </template>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { formatTokenCount } from '../../utils/formatters';
import {
  formatDuration,
  formatTimestamp,
  highlightJson,
  inferSchema,
  toJson,
} from '../../utils/trajectoryMetrics';
import type { TrajectoryEvent } from '../../composables/useTrajectory';

const props = defineProps<{
  event: TrajectoryEvent | null;
  /** Session start, used to show how far into the run a record happened. */
  originTime?: number;
}>();

type DetailTab = 'summary' | 'payload' | 'result' | 'schema' | 'timing';

const tabs: Array<{ id: DetailTab; label: string }> = [
  { id: 'summary', label: 'Summary' },
  { id: 'payload', label: 'Payload' },
  { id: 'result', label: 'Result' },
  { id: 'schema', label: 'Schema' },
  { id: 'timing', label: 'Timing' },
];

const activeTab = ref<DetailTab>('summary');

watch(
  () => props.event?.key,
  () => {
    activeTab.value = 'summary';
  },
);

const KIND_LABELS: Record<string, string> = {
  system: 'System Prompt',
  user: 'User Message',
  context: 'Context Injection',
  assistant: 'Assistant Message',
  reasoning: 'Reasoning',
  tool: 'Tool Call',
  subtask: 'Subagent',
  error: 'Error',
};

const hierarchy = computed(() => {
  const event = props.event;
  if (!event) return '';
  const parts = [`Turn ${event.turn}`];
  if (event.step > 0) parts.push(`Step ${event.step}`);
  parts.push(KIND_LABELS[event.kind] ?? event.kind);
  return parts.join(' › ');
});

const statusLabel = computed(() => {
  const status = props.event?.status;
  if (!status) return 'Recorded';
  return status.charAt(0).toUpperCase() + status.slice(1);
});

const pendingHint = computed(() =>
  props.event?.status === 'running' || props.event?.status === 'pending' ? ' yet' : '',
);

const payloadJson = computed(() => {
  const payload = props.event?.payload;
  if (payload === undefined || payload === null) return '';
  if (typeof payload === 'object' && Object.keys(payload as object).length === 0) return '';
  return toJson(payload);
});

const highlightedPayload = computed(() => highlightJson(payloadJson.value));

const highlightedSchema = computed(() =>
  highlightJson(toJson(inferSchema(props.event?.payload ?? {}))),
);

const highlightedRaw = computed(() => highlightJson(toJson(props.event?.raw)));

const RESULT_PREVIEW_LIMIT = 4000;

const truncatedResult = computed(() => {
  const result = props.event?.result ?? '';
  if (result.length <= RESULT_PREVIEW_LIMIT) return result;
  return `${result.slice(0, RESULT_PREVIEW_LIMIT)}\n… ${result.length - RESULT_PREVIEW_LIMIT} more characters (see the Result tab)`;
});

const tokenSummary = computed(() => {
  const tokens = props.event?.tokens;
  if (!tokens) return '';
  const chunks = [`${formatTokenCount(tokens.input)} in`, `${formatTokenCount(tokens.output)} out`];
  if (tokens.reasoning > 0) chunks.push(`${formatTokenCount(tokens.reasoning)} reasoning`);
  if (tokens.cache?.read) chunks.push(`${formatTokenCount(tokens.cache.read)} cached`);
  return chunks.join(' · ');
});

const offsetLabel = computed(() => {
  const event = props.event;
  if (!event || props.originTime === undefined) return '—';
  return `+${formatDuration(Math.max(0, event.time - props.originTime))}`;
});
</script>

<style scoped>
.tj-detail {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  border-left: 1px solid var(--theme-border-subtle);
  background: color-mix(in srgb, var(--theme-bg-base) 35%, transparent);
}

.tj-detail-empty {
  padding: 16px;
  color: var(--theme-text-subtle);
  font-size: 12px;
}

.tj-detail-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px 8px;
  flex-wrap: wrap;
}

.tj-detail-title {
  font-size: 12px;
  color: var(--theme-text-primary);
  font-weight: 600;
}

.tj-detail-crumb {
  margin-left: auto;
  font-size: 10px;
  color: var(--theme-text-subtle);
}

.tj-detail-tabs {
  display: flex;
  gap: 2px;
  padding: 0 8px;
  border-bottom: 1px solid var(--theme-border-subtle);
}

.tj-detail-tab {
  border: 0;
  background: transparent;
  color: var(--theme-text-muted);
  font-size: 11px;
  padding: 6px 8px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
}

.tj-detail-tab.is-active {
  color: var(--theme-text-primary);
  border-bottom-color: var(--theme-accent);
}

.tj-detail-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 10px 12px 16px;
  font-size: 11.5px;
}

.tj-fields {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 3px 12px;
  margin: 0 0 10px;
}

.tj-fields dt {
  color: var(--theme-text-subtle);
  font-size: 10.5px;
}

.tj-fields dd {
  margin: 0;
  color: var(--theme-text-secondary);
  overflow-wrap: anywhere;
}

.tj-fields dd.is-error {
  color: var(--theme-danger);
}

.tj-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10.5px;
}

.tj-section {
  border-top: 1px solid var(--theme-border-subtle);
  padding-top: 6px;
  margin-top: 6px;
}

.tj-section > summary {
  cursor: pointer;
  color: var(--theme-text-muted);
  font-size: 11px;
  padding: 2px 0;
  user-select: none;
}

.tj-schema-name {
  margin: 6px 0 2px;
  color: var(--theme-text-primary);
  font-weight: 600;
}

.tj-note {
  margin: 0 0 6px;
  color: var(--theme-text-subtle);
  font-size: 10.5px;
}

.tj-code {
  margin: 4px 0 0;
  padding: 8px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--theme-bg-base) 75%, transparent);
  border: 1px solid var(--theme-border-subtle);
  color: var(--theme-text-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 60vh;
  overflow: auto;
}

.tj-plain {
  color: var(--theme-text-muted);
}

.tj-kind {
  font-size: 9px;
  letter-spacing: 0.08em;
  padding: 2px 5px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--theme-bg-base) 70%, transparent);
  color: var(--theme-text-muted);
}

.tj-kind.is-user {
  color: var(--theme-success);
}
.tj-kind.is-context {
  color: var(--theme-info);
}
.tj-kind.is-assistant,
.tj-kind.is-reasoning {
  color: var(--theme-special);
}
.tj-kind.is-tool {
  color: var(--theme-warning);
}
.tj-kind.is-subtask {
  color: var(--theme-accent);
}
.tj-kind.is-error {
  color: var(--theme-danger);
}

.tj-detail :deep(.tj-json-key) {
  color: var(--theme-info);
}
.tj-detail :deep(.tj-json-string) {
  color: var(--theme-success);
}
.tj-detail :deep(.tj-json-number) {
  color: var(--theme-warning);
}
.tj-detail :deep(.tj-json-literal) {
  color: var(--theme-special);
}
</style>
