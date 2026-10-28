<template>
  <div class="tj-root">
    <div class="tj-shell">
      <div class="tj-toolbar">
        <div class="tj-metrics" role="group" aria-label="Timeline axis">
          <button
            v-for="option in TRAJECTORY_METRICS"
            :key="option.id"
            type="button"
            class="tj-metric"
            :class="{ 'is-active': metric === option.id }"
            :title="option.hint"
            @click="setMetric(option.id)"
          >
            <Icon :name="option.icon" :size="12" />
            {{ option.label }}
          </button>
          <button
            type="button"
            class="tj-metric"
            title="Download this trajectory as JSON"
            @click="exportTrajectory"
          >
            <Icon name="lucide:download" :size="12" />
            Export
          </button>
        </div>

        <div class="tj-search">
          <Icon name="lucide:search" :size="12" />
          <input
            v-model="search"
            type="search"
            placeholder="Search"
            spellcheck="false"
            aria-label="Search trajectory"
          />
          <span v-if="search" class="tj-search-count">{{ visibleEvents.length }}</span>
        </div>
      </div>

      <div class="tj-stats">
        <span
          ><b>{{ stats.turns }}</b> turns</span
        >
        <span
          ><b>{{ stats.steps }}</b> steps</span
        >
        <span
          ><b>{{ stats.calls }}</b> calls</span
        >
        <span
          ><b>{{ formatDuration(stats.elapsedMs) }}</b> elapsed</span
        >
        <span
          ><b>{{ formatTokenCount(stats.outputTokens) }}</b> out</span
        >
        <span v-if="stats.tokensPerSecond !== null">
          <b>{{ stats.tokensPerSecond.toFixed(1) }}</b> tok/s
        </span>
        <span v-if="stats.cacheHitRate !== null">
          <b>{{ Math.round(stats.cacheHitRate * 100) }}%</b> cache
        </span>
        <span v-if="stats.cost > 0"
          ><b>${{ stats.cost.toFixed(4) }}</b></span
        >
      </div>

      <TrajectoryTimeline
        :events="visibleEvents"
        :metric="metric"
        :selected-key="selectedKey"
        @select="selectFromTimeline"
      />

      <div class="tj-body">
        <div
          v-show="!isMobile || !selectedEvent"
          class="tj-list"
          tabindex="0"
          role="listbox"
          aria-label="Trajectory records"
          @keydown="handleKeydown"
        >
          <p v-if="events.length === 0" class="tj-empty">
            No records yet. The trajectory fills in as the session runs.
          </p>
          <p v-else-if="visibleEvents.length === 0" class="tj-empty">
            No records match “{{ search }}”.
          </p>
          <template v-for="row in rows" :key="row.event.key">
            <div v-if="row.turnStart" class="tj-turn-marker">Turn {{ row.event.turn }}</div>
            <button
              :id="`tj-row-${row.event.index}`"
              type="button"
              role="option"
              class="tj-row"
              :class="[`is-${row.event.kind}`, { 'is-selected': row.event.key === selectedKey }]"
              :aria-selected="row.event.key === selectedKey"
              @click="select(row.event.key)"
            >
              <span class="tj-badge">{{ row.event.kind.toUpperCase() }}</span>
              <span class="tj-row-title">{{ row.event.title }}</span>
              <span class="tj-row-preview">{{ row.event.preview }}</span>
              <span v-if="row.event.resultPreview" class="tj-row-result">
                → {{ row.event.resultPreview }}
              </span>
              <span v-if="row.event.status === 'error'" class="tj-row-flag">error</span>
              <span v-else-if="row.event.durationMs" class="tj-row-duration">
                {{ formatDuration(row.event.durationMs) }}
              </span>
            </button>
          </template>
        </div>

        <div v-if="isMobile && selectedEvent" class="tj-mobile-detail">
          <button type="button" class="tj-back" @click="selectedKey = null">
            <Icon name="lucide:arrow-left" :size="12" />
            Back to records
          </button>
          <TrajectoryDetail :event="selectedEvent" :origin-time="stats.startTime" />
        </div>
        <div v-else-if="!isMobile" class="tj-detail-pane">
          <TrajectoryDetail :event="selectedEvent" :origin-time="stats.startTime" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import TrajectoryDetail from './TrajectoryDetail.vue';
import TrajectoryTimeline from './TrajectoryTimeline.vue';
import {
  TRAJECTORY_METRICS,
  formatDuration,
  type TrajectoryMetric,
} from '../../utils/trajectoryMetrics';
import { useIsMobile } from '../../composables/useIsMobile';
import { useTrajectory, type TrajectoryEvent } from '../../composables/useTrajectory';
import { formatTokenCount } from '../../utils/formatters';
import { StorageKeys, storageGet, storageSet } from '../../utils/storageKeys';

const props = defineProps<{
  sessionId?: string;
  /** False while the chat tab is showing; keeps the stream from rebuilding. */
  active?: boolean;
}>();

const { events, stats } = useTrajectory(computed(() => props.active !== false));
const { isMobile } = useIsMobile();

function readMetric(): TrajectoryMetric {
  const stored = storageGet(StorageKeys.state.trajectoryMetric);
  return stored === 'turns' || stored === 'calls' || stored === 'duration' ? stored : 'duration';
}

const metric = ref<TrajectoryMetric>(readMetric());
const search = ref('');
const selectedKey = ref<string | null>(null);

function setMetric(value: TrajectoryMetric) {
  metric.value = value;
  storageSet(StorageKeys.state.trajectoryMetric, value);
}

const visibleEvents = computed(() => {
  const query = search.value.trim().toLowerCase();
  if (!query) return events.value;
  return events.value.filter((event) => {
    if (event.title.toLowerCase().includes(query)) return true;
    if (event.preview.toLowerCase().includes(query)) return true;
    if (event.resultPreview?.toLowerCase().includes(query)) return true;
    if (event.toolName?.toLowerCase().includes(query)) return true;
    return event.result?.toLowerCase().includes(query) ?? false;
  });
});

/** Rows carry a flag for the first record of each turn, which draws the rail marker. */
const rows = computed(() => {
  let lastTurn = 0;
  return visibleEvents.value.map((event) => {
    const turnStart = event.turn !== lastTurn;
    lastTurn = event.turn;
    return { event, turnStart };
  });
});

const selectedEvent = computed<TrajectoryEvent | null>(() => {
  if (!selectedKey.value) return null;
  return events.value.find((event) => event.key === selectedKey.value) ?? null;
});

function select(key: string) {
  selectedKey.value = key;
}

function selectFromTimeline(key: string) {
  selectedKey.value = key;
  const event = events.value.find((entry) => entry.key === key);
  if (!event) return;
  nextTick(() => {
    document
      .getElementById(`tj-row-${event.index}`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

function handleKeydown(keyEvent: KeyboardEvent) {
  if (keyEvent.key !== 'ArrowDown' && keyEvent.key !== 'ArrowUp') return;
  const list = visibleEvents.value;
  if (list.length === 0) return;
  keyEvent.preventDefault();
  const current = list.findIndex((event) => event.key === selectedKey.value);
  const step = keyEvent.key === 'ArrowDown' ? 1 : -1;
  const next = current === -1 ? 0 : Math.min(Math.max(current + step, 0), list.length - 1);
  selectFromTimeline(list[next].key);
}

// A different session is a different trajectory: drop the selection and filter.
watch(
  () => props.sessionId,
  () => {
    selectedKey.value = null;
    search.value = '';
  },
);

function exportTrajectory() {
  const payload = {
    sessionId: props.sessionId ?? events.value[0]?.sessionId ?? null,
    exportedAt: new Date().toISOString(),
    stats: stats.value,
    events: events.value.map((event) => ({
      index: event.index,
      turn: event.turn,
      step: event.step,
      kind: event.kind,
      title: event.title,
      status: event.status,
      time: event.time,
      endTime: event.endTime,
      durationMs: event.durationMs,
      agent: event.agent,
      model: event.model,
      tool: event.toolName,
      callId: event.callId,
      messageId: event.messageId,
      payload: event.payload,
      result: event.result,
    })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `trajectory-${payload.sessionId ?? 'session'}.json`;
  link.click();
  // Revoking synchronously can cancel the download before the browser reads it.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
</script>

<style scoped>
.tj-root {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
}

.tj-shell {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background-color: var(--theme-bg-overlay);
  color: var(--theme-text-secondary);
  border: 1px solid var(--theme-border);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 12px 32px color-mix(in srgb, var(--theme-bg-base) 45%, transparent);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
  font-size: 12px;
}

.tj-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--theme-border-subtle);
}

.tj-metrics {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.tj-metric {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--theme-border-subtle);
  border-radius: 6px;
  background: color-mix(in srgb, var(--theme-bg-base) 70%, transparent);
  color: var(--theme-text-muted);
  font-size: 11px;
  padding: 4px 8px;
  cursor: pointer;
}

.tj-metric.is-active {
  background: color-mix(in srgb, var(--theme-accent-strong) 12%, var(--theme-bg-base));
  border-color: color-mix(in srgb, var(--theme-accent) 60%, transparent);
  color: var(--theme-text-primary);
}

.tj-search {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border: 1px solid var(--theme-border-subtle);
  border-radius: 6px;
  background: color-mix(in srgb, var(--theme-bg-base) 70%, transparent);
  color: var(--theme-text-subtle);
}

.tj-search input {
  border: 0;
  background: transparent;
  outline: none;
  color: var(--theme-text-secondary);
  font-size: 11px;
  width: 140px;
  font-family: inherit;
}

.tj-search-count {
  font-size: 10px;
  color: var(--theme-text-subtle);
}

.tj-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 5px 12px;
  border-bottom: 1px solid var(--theme-border-subtle);
  font-size: 10.5px;
  color: var(--theme-text-subtle);
}

.tj-stats b {
  color: var(--theme-text-secondary);
  font-weight: 600;
}

.tj-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: stretch;
}

.tj-list {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 4px 0 12px;
  outline: none;
}

.tj-empty {
  padding: 16px 12px;
  color: var(--theme-text-subtle);
  font-size: 12px;
}

.tj-turn-marker {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 4px 10px 3px;
  font-size: 9.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--theme-text-subtle);
  background: color-mix(in srgb, var(--theme-bg-overlay) 92%, transparent);
  border-top: 1px solid var(--theme-border-subtle);
}

.tj-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  padding: 3px 10px;
  border: 0;
  border-left: 2px solid transparent;
  background: transparent;
  color: var(--theme-text-muted);
  font-family: inherit;
  font-size: 11.5px;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
}

.tj-row:hover {
  background: var(--theme-bg-hover);
}

.tj-row.is-selected {
  background: var(--theme-bg-selected);
  border-left-color: var(--theme-accent);
}

.tj-badge {
  flex: 0 0 62px;
  font-size: 9px;
  letter-spacing: 0.06em;
  text-align: right;
  color: var(--theme-text-subtle);
}

.tj-row.is-user .tj-badge {
  color: var(--theme-success);
}
.tj-row.is-context .tj-badge {
  color: var(--theme-info);
}
.tj-row.is-assistant .tj-badge,
.tj-row.is-reasoning .tj-badge {
  color: var(--theme-special);
}
.tj-row.is-tool .tj-badge {
  color: var(--theme-warning);
}
.tj-row.is-subtask .tj-badge {
  color: var(--theme-accent);
}
.tj-row.is-error .tj-badge {
  color: var(--theme-danger);
}

.tj-row-title {
  flex: 0 0 auto;
  color: var(--theme-text-secondary);
}

.tj-row-preview {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--theme-text-muted);
}

.tj-row-result {
  flex: 1 1 40%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--theme-text-subtle);
}

.tj-row-duration,
.tj-row-flag {
  flex: 0 0 auto;
  font-size: 10px;
  color: var(--theme-text-subtle);
}

.tj-row-flag {
  color: var(--theme-danger);
}

.tj-detail-pane {
  flex: 0 0 clamp(280px, 32%, 460px);
  min-height: 0;
}

.tj-mobile-detail {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.tj-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  margin: 8px 0 0 10px;
  padding: 4px 8px;
  border: 1px solid var(--theme-border-subtle);
  border-radius: 6px;
  background: transparent;
  color: var(--theme-text-muted);
  font-size: 11px;
  cursor: pointer;
}

@media (max-width: 767px) {
  .tj-row {
    white-space: normal;
  }

  .tj-row-result {
    display: none;
  }
}
</style>
