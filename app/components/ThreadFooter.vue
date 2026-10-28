<template>
  <div class="ib-footer">
    <span class="ib-footer-meta">
      <span v-if="timestamp" class="ib-meta-item">
        <Icon name="lucide:clock" :size="10" />
        {{ timestamp }}
      </span>
      <span v-if="elapsed" class="ib-meta-item">
        <Icon name="lucide:timer" :size="10" />
        {{ elapsed }}
      </span>
      <span
        v-if="contextPercent != null"
        class="ib-meta-item"
        :class="contextSeverityClass(contextPercent)"
      >
        <Icon name="lucide:gauge" :size="10" />
        {{ contextPercent }}%
      </span>
      <span v-if="tokens" class="ib-meta-item ib-meta-tokens">
        <span class="ib-token-in" title="Input tokens"
          ><Icon name="lucide:arrow-up" :size="9" />{{ formatTokenCount(tokens.input) }}</span
        >
        <span class="ib-token-out" title="Output tokens"
          ><Icon name="lucide:arrow-down" :size="9" />{{ formatTokenCount(tokens.output) }}</span
        >
        <span class="ib-token-reason" title="Reasoning tokens"
          ><Icon name="lucide:brain" :size="9" />{{ formatTokenCount(tokens.reasoning) }}</span
        >
      </span>
    </span>
    <span class="ib-footer-actions">
      <button
        v-if="hasDiffs"
        type="button"
        class="ib-action ib-action-diff"
        @click="$emit('show-diff')"
      >
        DIFF
      </button>
      <button
        v-if="canRevert"
        type="button"
        class="ib-action ib-action-danger"
        @click="$emit('revert')"
      >
        REVERT
      </button>
    </span>
  </div>
</template>

<script setup lang="ts">
import type { MessageTokens } from '../types/message';
import { contextSeverityClass, formatTokenCount } from '../utils/formatters';

defineProps<{
  timestamp: string;
  elapsed: string;
  contextPercent: number | null;
  tokens: MessageTokens | null;
  hasDiffs: boolean;
  canRevert: boolean;
}>();

defineEmits<{
  (event: 'show-diff'): void;
  (event: 'revert'): void;
}>();
</script>

<style scoped>
.ib-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}

.ib-footer-meta {
  font-size: 10px;
  color: var(--theme-text-muted);
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.ib-meta-item {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.ib-meta-tokens {
  gap: 6px;
}

.ib-token-in,
.ib-token-out,
.ib-token-reason {
  display: inline-flex;
  align-items: center;
  gap: 1px;
}

.ib-ctx-low {
  color: color-mix(in srgb, var(--theme-accent) 70%, transparent);
}

.ib-ctx-moderate {
  color: color-mix(in srgb, var(--theme-warning) 80%, transparent);
}

.ib-ctx-high {
  color: color-mix(in srgb, var(--theme-warning) 85%, transparent);
}

.ib-ctx-critical {
  color: color-mix(in srgb, var(--theme-danger) 90%, transparent);
}

.ib-footer-actions {
  display: flex;
  gap: 4px;
  flex: 0 0 auto;
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

.ib-action-diff {
  border-color: color-mix(in srgb, var(--theme-accent) 70%, transparent);
  background: color-mix(in srgb, var(--theme-accent-strong) 8%, var(--theme-bg-base));
  color: var(--theme-info);
  font-weight: 600;
  letter-spacing: 0.5px;
}

.ib-action-diff:hover {
  background: color-mix(in srgb, var(--theme-accent-strong) 12%, var(--theme-bg-base));
}

.ib-action-danger {
  border-color: color-mix(in srgb, var(--theme-danger) 70%, transparent);
  background: color-mix(in srgb, var(--theme-danger-strong) 35%, transparent);
  color: var(--theme-danger);
}

.ib-action-danger:hover {
  background: color-mix(in srgb, var(--theme-danger-strong) 50%, transparent);
}
</style>
