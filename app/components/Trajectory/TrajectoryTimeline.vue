<template>
  <div class="tj-timeline" role="group" aria-label="Trajectory timeline">
    <div v-for="lane in lanes" :key="lane.id" class="tj-lane">
      <span class="tj-lane-label">{{ lane.label }}</span>
      <div class="tj-lane-track">
        <span
          v-for="tick in ticks"
          :key="`tick-${tick.turn}`"
          class="tj-tick"
          :style="{ left: `${tick.left}%` }"
        />
        <button
          v-for="block in blocksByLane[lane.id]"
          :key="block.key"
          type="button"
          class="tj-block"
          :class="[`is-${block.kind}`, { 'is-selected': block.key === selectedKey }]"
          :style="{ left: `${block.left}%`, width: `${block.width}%` }"
          :title="block.tooltip"
          @click="emit('select', block.key)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { TrajectoryEvent, TrajectoryLane } from '../../composables/useTrajectory';
import type { TrajectoryMetric } from '../../utils/trajectoryMetrics';

const props = defineProps<{
  events: TrajectoryEvent[];
  metric: TrajectoryMetric;
  selectedKey: string | null;
}>();

const emit = defineEmits<{ (event: 'select', key: string): void }>();

const lanes: Array<{ id: TrajectoryLane; label: string }> = [
  { id: 'input', label: 'Input' },
  { id: 'model', label: 'Model' },
  { id: 'tools', label: 'Tools' },
];

type Block = {
  key: string;
  kind: string;
  left: number;
  width: number;
  tooltip: string;
};

const MIN_WIDTH = 0.35;

function tooltipFor(event: TrajectoryEvent): string {
  const duration = event.durationMs !== undefined ? ` · ${Math.round(event.durationMs)}ms` : '';
  return `Turn ${event.turn} · Step ${event.step || 0} · ${event.title}${duration}`;
}

/** Time span of the session, used by the duration metric. */
const span = computed(() => {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const event of props.events) {
    if (event.time > 0) start = Math.min(start, event.time);
    const last = event.endTime ?? event.time;
    if (last > 0) end = Math.max(end, last);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { start, end, length: end - start };
});

const turnCount = computed(() => {
  let max = 0;
  for (const event of props.events) max = Math.max(max, event.turn);
  return max;
});

const positions = computed(() => {
  const result = new Map<string, { left: number; width: number }>();
  const events = props.events;
  if (events.length === 0) return result;

  if (props.metric === 'calls') {
    const width = 100 / events.length;
    events.forEach((event, i) => {
      result.set(event.key, { left: i * width, width: Math.max(width, MIN_WIDTH) });
    });
    return result;
  }

  if (props.metric === 'turns') {
    const turns = Math.max(turnCount.value, 1);
    const perTurn = 100 / turns;
    const counts = new Map<number, TrajectoryEvent[]>();
    for (const event of events) {
      const list = counts.get(event.turn);
      if (list) list.push(event);
      else counts.set(event.turn, [event]);
    }
    for (const [turn, list] of counts) {
      const slot = perTurn / list.length;
      list.forEach((event, i) => {
        result.set(event.key, {
          left: (turn - 1) * perTurn + i * slot,
          width: Math.max(slot, MIN_WIDTH),
        });
      });
    }
    return result;
  }

  const range = span.value;
  if (!range) {
    const width = 100 / events.length;
    events.forEach((event, i) => {
      result.set(event.key, { left: i * width, width: Math.max(width, MIN_WIDTH) });
    });
    return result;
  }
  for (const event of events) {
    const left = ((event.time - range.start) / range.length) * 100;
    const duration = event.durationMs ?? 0;
    const width = Math.max((duration / range.length) * 100, MIN_WIDTH);
    result.set(event.key, {
      left: Math.min(Math.max(left, 0), 100 - MIN_WIDTH),
      width: Math.min(width, 100),
    });
  }
  return result;
});

const blocksByLane = computed(() => {
  const grouped: Record<TrajectoryLane, Block[]> = { input: [], model: [], tools: [] };
  for (const event of props.events) {
    const position = positions.value.get(event.key);
    if (!position) continue;
    grouped[event.lane].push({
      key: event.key,
      kind: event.status === 'error' || event.kind === 'error' ? 'error' : event.kind,
      left: position.left,
      width: position.width,
      tooltip: tooltipFor(event),
    });
  }
  return grouped;
});

/** Turn boundaries, drawn as faint verticals behind the blocks. */
const ticks = computed(() => {
  if (props.metric === 'calls' || turnCount.value < 2) return [];
  const result: Array<{ turn: number; left: number }> = [];
  if (props.metric === 'turns') {
    const perTurn = 100 / turnCount.value;
    for (let turn = 2; turn <= turnCount.value; turn++) {
      result.push({ turn, left: (turn - 1) * perTurn });
    }
    return result;
  }
  const range = span.value;
  if (!range) return [];
  const seen = new Set<number>();
  for (const event of props.events) {
    if (seen.has(event.turn) || event.turn < 2) continue;
    seen.add(event.turn);
    result.push({ turn: event.turn, left: ((event.time - range.start) / range.length) * 100 });
  }
  return result;
});
</script>

<style scoped>
.tj-timeline {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--theme-border-subtle);
  background: color-mix(in srgb, var(--theme-bg-base) 40%, transparent);
}

.tj-lane {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tj-lane-label {
  flex: 0 0 40px;
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--theme-text-subtle);
  text-align: right;
  user-select: none;
}

.tj-lane-track {
  position: relative;
  flex: 1 1 auto;
  height: 12px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--theme-bg-base) 60%, transparent);
  overflow: hidden;
}

.tj-tick {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: color-mix(in srgb, var(--theme-border-strong) 55%, transparent);
}

.tj-block {
  position: absolute;
  top: 2px;
  bottom: 2px;
  min-width: 4px;
  padding: 0;
  border: 0;
  border-radius: 2px;
  cursor: pointer;
  opacity: 0.85;
}

.tj-block:hover {
  opacity: 1;
}

.tj-block.is-selected {
  outline: 1px solid var(--theme-text-primary);
  outline-offset: 1px;
  opacity: 1;
  z-index: 2;
}

.tj-block.is-system {
  background: var(--theme-text-subtle);
}
.tj-block.is-user {
  background: var(--theme-success);
}
.tj-block.is-context {
  background: var(--theme-info);
}
.tj-block.is-assistant {
  background: var(--theme-special);
}
.tj-block.is-reasoning {
  background: color-mix(in srgb, var(--theme-special) 55%, var(--theme-bg-base));
}
.tj-block.is-subtask {
  background: var(--theme-accent);
}
.tj-block.is-tool {
  background: var(--theme-warning);
}
.tj-block.is-error {
  background: var(--theme-danger);
}
</style>
