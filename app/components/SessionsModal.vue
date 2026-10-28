<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="modal-backdrop"
      @click.self="$emit('close')"
      @keydown.escape="$emit('close')"
    >
      <div class="modal">
        <header class="modal-header">
          <div class="modal-title">
            <Icon name="lucide:git-branch" :size="14" />
            {{ branchLabel }} — All Sessions
          </div>
          <button type="button" class="modal-close-button" @click="$emit('close')">
            <Icon name="lucide:x" :size="14" />
          </button>
        </header>

        <div class="modal-search">
          <Icon name="lucide:search" class="search-icon" />
          <input
            ref="searchInputRef"
            v-model="filterQuery"
            type="text"
            class="search-input"
            placeholder="Filter sessions..."
          />
          <button v-if="filterQuery" type="button" class="clear-search" @click="filterQuery = ''">
            <Icon name="lucide:x" :size="12" />
          </button>
        </div>

        <div class="modal-body">
          <div v-if="filteredSessions.length === 0" class="empty-state">
            {{ filterQuery ? 'No matching sessions' : 'No sessions' }}
          </div>
          <div
            v-for="session in filteredSessions"
            :key="session.id"
            class="session-row"
            :class="{ 'is-active': session.id === selectedSessionId }"
            @click="selectSession(session)"
          >
            <div class="session-main">
              <span class="session-status-icon" :title="session.status">{{
                sessionStatusIcon(session.status)
              }}</span>
              <div class="session-info">
                <div class="session-info-top">
                  <span class="session-title">{{
                    session.title || session.slug || session.id
                  }}</span>
                  <span
                    v-if="claudeEnabled && session.source === 'claude'"
                    class="session-badge-claude"
                    >Claude</span
                  >
                  <span
                    v-else-if="claudeEnabled && session.source !== 'claude'"
                    class="session-badge-opencode"
                    >OpenCode</span
                  >
                  <span v-if="session.archivedAt" class="session-badge-archived">archived</span>
                </div>
                <span v-if="session.timeCreated || session.timeUpdated" class="session-time">
                  {{ formatSessionMetaTime(session) }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <footer class="modal-footer">
          <span class="session-count"
            >{{ filteredSessions.length }} session{{
              filteredSessions.length === 1 ? '' : 's'
            }}</span
          >
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { useServerConfig } from '../composables/useServerConfig';
import { sessionStatusIcon } from '../utils/session';

type Session = {
  id: string;
  title?: string;
  slug?: string;
  status: 'busy' | 'idle' | 'retry' | 'unknown';
  timeCreated?: number;
  timeUpdated?: number;
  archivedAt?: number;
  /** 'claude' when the session comes from Claude Code CLI, 'opencode' otherwise */
  source?: 'claude' | 'opencode';
};

const props = defineProps<{
  open: boolean;
  sessions: Session[];
  branchLabel: string;
  selectedSessionId: string;
}>();

const emit = defineEmits<{
  (event: 'close'): void;
  (event: 'select', sessionId: string): void;
}>();

const { claudeEnabled } = useServerConfig();
const searchInputRef = ref<HTMLInputElement | null>(null);
const filterQuery = ref('');

watch(
  () => props.open,
  (open) => {
    if (open) {
      filterQuery.value = '';
      nextTick(() => searchInputRef.value?.focus());
    }
  },
);

const filteredSessions = computed(() => {
  const q = filterQuery.value.trim().toLowerCase();
  if (!q) return props.sessions;
  const terms = q.split(/\s+/).filter(Boolean);
  return props.sessions.filter((s) =>
    terms.every(
      (term) =>
        s.title?.toLowerCase().includes(term) ||
        s.slug?.toLowerCase().includes(term) ||
        s.id.toLowerCase().includes(term) ||
        (s.archivedAt ? 'archived'.includes(term) : false) ||
        (s.timeCreated ? formatSessionTime(s.timeCreated).includes(term) : false) ||
        (s.timeUpdated ? formatSessionTime(s.timeUpdated).includes(term) : false),
    ),
  );
});

function selectSession(session: Session) {
  emit('select', session.id);
  emit('close');
}

function formatSessionTime(timestamp: number) {
  const d = new Date(timestamp);
  const Y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const D = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${Y}-${M}-${D} ${h}:${m}`;
}

function formatSessionMetaTime(session: Session) {
  const created = session.timeCreated ? formatSessionTime(session.timeCreated) : undefined;
  const updated = session.timeUpdated ? formatSessionTime(session.timeUpdated) : undefined;
  if (created && updated) return `Created: ${created} / Updated: ${updated}`;
  if (created) return `Created: ${created}`;
  if (updated) return `Updated: ${updated}`;
  return '';
}
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, #000 60%, transparent);
  padding: 0;
}

.modal {
  background: var(--theme-bg-base);
  border: 1px solid var(--theme-border);
  border-radius: 12px;
  width: min(560px, 90vw);
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 25px 50px -12px color-mix(in srgb, #000 50%, transparent);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--theme-border);
}

.modal-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--theme-text-secondary);
  display: flex;
  align-items: center;
  gap: 8px;
}

.modal-close-button {
  border: none;
  background: transparent;
  color: var(--theme-text-muted);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
}

.modal-close-button:hover {
  color: var(--theme-text-secondary);
  background: var(--theme-border-subtle);
}

.modal-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--theme-border-subtle);
}

.search-icon {
  width: 14px;
  height: 14px;
  color: var(--theme-text-subtle);
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--theme-text-secondary);
  font-size: 12px;
  outline: none;
  padding: 4px 0;
}

.search-input::placeholder {
  color: var(--theme-text-subtle);
}

.clear-search {
  border: none;
  background: transparent;
  color: var(--theme-text-subtle);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  padding: 2px;
}

.clear-search:hover {
  color: var(--theme-text-muted);
}

.modal-body {
  flex: 1 1 auto;
  overflow-y: auto;
  min-height: 0;
  padding: 4px 0;
}

.empty-state {
  padding: 24px;
  text-align: center;
  color: var(--theme-text-muted);
  font-size: 12px;
}

.session-row {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  cursor: pointer;
  font-size: 12px;
  border: 1px solid transparent;
}

.session-row:hover {
  background: var(--theme-bg-hover);
}

.session-row.is-active {
  background: var(--theme-bg-selected);
  border-color: color-mix(in srgb, var(--theme-accent-strong) 35%, transparent);
}

.session-main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  column-gap: 8px;
  row-gap: 1px;
  min-width: 0;
  flex: 1;
}

.session-status-icon {
  flex: 0 0 auto;
  width: 14px;
  text-align: center;
}

.session-info {
  display: contents;
}

.session-info-top {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1 1 auto;
}

.session-title {
  color: var(--theme-text-secondary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-time {
  font-size: 10px;
  color: var(--theme-text-subtle);
  white-space: nowrap;
  flex-basis: 100%;
}

.session-badge-archived {
  flex: 0 0 auto;
  font-size: 10px;
  line-height: 1;
  color: var(--theme-special);
  background: color-mix(in srgb, var(--theme-special) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--theme-special) 30%, transparent);
  border-radius: 999px;
  padding: 2px 6px;
}

.session-badge-claude {
  flex: 0 0 auto;
  font-size: 10px;
  line-height: 1;
  color: #d4872f;
  background: color-mix(in srgb, #d4872f 15%, transparent);
  border: 1px solid color-mix(in srgb, #d4872f 30%, transparent);
  border-radius: 999px;
  padding: 2px 6px;
}

.session-badge-opencode {
  flex: 0 0 auto;
  font-size: 10px;
  line-height: 1;
  color: var(--theme-accent);
  background: color-mix(in srgb, var(--theme-accent) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--theme-accent) 30%, transparent);
  border-radius: 999px;
  padding: 2px 6px;
}

.modal-footer {
  border-top: 1px solid var(--theme-border);
  padding: 10px 16px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.session-count {
  font-size: 11px;
  color: var(--theme-text-subtle);
}
</style>
