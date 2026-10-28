<template>
  <div class="todo-body">
    <div class="todo-header">
      <div class="todo-title">TODO</div>
      <div class="todo-count">{{ totalCount }}</div>
    </div>
    <div v-if="sessions.length === 0" class="todo-empty">No todos yet.</div>
    <div v-else class="todo-groups">
      <section v-for="session in sessions" :key="session.sessionId" class="todo-group">
        <header class="todo-group-header">
          <span class="todo-group-title">{{ session.title }}</span>
          <span v-if="session.isSubagent" class="todo-badge">subagent</span>
        </header>
        <div v-if="session.error" class="todo-error">{{ session.error }}</div>
        <ul v-else class="todo-list">
          <li
            v-for="(todo, index) in session.todos"
            :key="index"
            class="todo-item"
            :class="`is-${todo.status}`"
          >
            <span class="todo-status" :title="todo.status">{{ statusIcon(todo.status) }}</span>
            <span class="todo-text">{{ todo.content }}</span>
            <span class="todo-priority" :class="`is-${todo.priority}`">{{ todo.priority }}</span>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { TodoSessionView } from '../composables/useTodos';

const props = defineProps<{
  sessions: TodoSessionView[];
}>();

const totalCount = computed(() =>
  props.sessions.reduce((sum, session) => sum + session.todos.length, 0),
);

function statusIcon(status: string) {
  if (status === 'completed') return '✓';
  if (status === 'in_progress') return '◐';
  if (status === 'cancelled') return '✕';
  return '○';
}
</script>

<style scoped>
.todo-body {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.todo-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 10px 8px;
  border-bottom: 1px solid var(--theme-border-subtle);
}

.todo-title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--theme-text-secondary);
}

.todo-count {
  font-size: 11px;
  color: var(--theme-text-muted);
}

.todo-empty {
  margin: auto;
  color: var(--theme-text-muted);
  font-size: 12px;
}

.todo-groups {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.todo-group {
  border: 1px solid var(--theme-border-subtle);
  border-radius: 8px;
  background: color-mix(in srgb, var(--theme-bg-base) 60%, transparent);
}

.todo-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 8px;
  border-bottom: 1px solid var(--theme-border-subtle);
}

.todo-group-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
  color: var(--theme-text-secondary);
}

.todo-badge {
  margin-left: auto;
  padding: 1px 5px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--theme-accent-strong) 50%, transparent);
  color: var(--theme-info);
  background: color-mix(in srgb, var(--theme-accent-strong) 6%, var(--theme-bg-base));
  font-size: 10px;
}

.todo-error {
  padding: 8px;
  color: var(--theme-danger);
  font-size: 11px;
}

.todo-list {
  list-style: none;
  margin: 0;
  padding: 6px 8px 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.todo-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 12px;
  color: var(--theme-info-text);
}

.todo-status {
  width: 14px;
  text-align: center;
  color: var(--theme-text-secondary);
}

.todo-item.is-completed .todo-status {
  color: var(--theme-success);
}

.todo-item.is-in_progress .todo-status {
  color: var(--theme-warning);
}

.todo-item.is-cancelled .todo-status {
  color: var(--theme-danger);
}

.todo-text {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.todo-priority {
  flex: 0 0 auto;
  text-transform: uppercase;
  font-size: 9px;
  letter-spacing: 0.07em;
  color: var(--theme-text-secondary);
  border: 1px solid var(--theme-border-subtle);
  border-radius: 999px;
  padding: 2px 5px;
}

.todo-priority.is-high {
  color: var(--theme-danger);
  border-color: color-mix(in srgb, var(--theme-danger) 60%, transparent);
}

.todo-priority.is-medium {
  color: var(--theme-warning);
  border-color: color-mix(in srgb, var(--theme-warning) 60%, transparent);
}

.todo-priority.is-low {
  color: var(--theme-success);
  border-color: color-mix(in srgb, var(--theme-success) 60%, transparent);
}
</style>
