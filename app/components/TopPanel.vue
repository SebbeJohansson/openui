<template>
  <div class="top-panel">
    <div class="top-row">
      <div class="top-left flex items-center gap-2" :title="gitRevision">
        <Icon name="lucide:terminal" :size="24" class="logo-icon" />
        <div class="font-normal hidden md:block relative top-0.5">OpenCode Visualizer</div>
      </div>
      <div class="top-center">
        <button
          type="button"
          class="control-button notification-button"
          :class="{ 'has-notifications': notifications.length > 0 }"
          :title="
            notifications.length > 0
              ? `${totalNotificationCount} pending notifications (Ctrl-G x2)`
              : 'No notifications'
          "
          :disabled="notifications.length === 0"
          @click="$emit('select-notification')"
        >
          <Icon :name="notifications.length > 0 ? 'lucide:bell-ring' : 'lucide:bell'" :size="16" />
          <span v-if="notifications.length > 0" class="notification-badge">{{
            totalNotificationCount
          }}</span>
        </button>
        <Dropdown
          v-model:open="treeDropdownOpen"
          class="tree-dropdown-root"
          :label="dropdownLabel"
          placeholder="Select session"
          title="Select session (Ctrl-G)"
          auto-close
          :popup-style="{ minWidth: '420px', width: 'min(680px, 90vw)', maxWidth: '90vw' }"
          popup-class="max-md:left-0! max-md:w-screen! max-md:min-w-0! max-md:max-w-none!"
          @select="onTreeSelect"
        >
          <template #label>
            <span v-if="selectedDisplay" class="selected-label">
              <span class="selected-status-icon">{{
                sessionStatusIcon(selectedDisplay.status)
              }}</span>
              <span class="selected-title">{{ selectedDisplay.title }}</span>
              <span class="selected-branch-badge">
                <Icon name="lucide:git-branch" :size="11" />
                {{ selectedDisplay.branch }}
              </span>
            </span>
            <span v-else class="selected-title">Select session</span>
          </template>
          <template #default="{ close }">
            <div class="tree-menu">
              <DropdownSearch
                v-model="searchQuery"
                placeholder="Search sessions, branches, directories..."
                class="tree-search"
              >
                <template #before>
                  <Icon name="lucide:search" class="search-icon" />
                </template>
                <template #after>
                  <button
                    v-if="searchQuery"
                    type="button"
                    class="clear-search"
                    @click.stop="searchQuery = ''"
                  >
                    <Icon name="lucide:x" />
                  </button>
                </template>
              </DropdownSearch>

              <div class="tree-content">
                <div v-if="displayedTree.length === 0" class="tree-empty">
                  {{ searchQuery ? 'No matching sessions' : 'No worktrees' }}
                </div>

                <div
                  v-for="worktree in displayedTree"
                  :key="worktree.directory"
                  class="tree-worktree"
                  :style="worktreeAccentStyle(worktree)"
                >
                  <div class="tree-worktree-header">
                    <div class="tree-header-main">
                      <Icon
                        :name="worktree.projectId === 'global' ? 'lucide:globe' : 'lucide:package'"
                        class="tree-header-icon"
                      />
                      <div class="tree-label">
                        <span class="tree-label-name" :title="worktree.directory">{{
                          worktree.name || directoryBasename(worktree.directory)
                        }}</span>
                        <small class="tree-label-type" :title="worktree.directory">{{
                          shortenPath(worktree.directory)
                        }}</small>
                      </div>
                    </div>
                    <div
                      v-if="worktree.projectId && worktree.projectId !== 'global'"
                      class="tree-actions"
                    >
                      <button
                        type="button"
                        class="tree-action-button"
                        :class="isShiftPressed ? 'danger' : 'archive'"
                        :title="
                          isShiftPressed
                            ? 'Delete all sessions in project permanently'
                            : 'Archive all sessions in project (hold Shift to delete permanently)'
                        "
                        @click.stop="
                          handleProjectAction(worktree.projectId, worktree.directory, close)
                        "
                      >
                        <Icon
                          :name="isShiftPressed ? 'lucide:trash-2' : 'lucide:archive'"
                          :size="14"
                        />
                      </button>
                      <button
                        type="button"
                        class="tree-action-button worktree-settings"
                        title="Project settings"
                        @click.stop="
                          $emit('edit-project', {
                            projectId: worktree.projectId,
                            worktree: worktree.directory,
                          })
                        "
                      >
                        <Icon name="lucide:settings" :size="14" />
                      </button>
                    </div>
                  </div>

                  <div
                    v-for="sandbox in worktree.sandboxes"
                    :key="sandbox.directory"
                    class="tree-sandbox"
                  >
                    <div class="tree-sandbox-header">
                      <div class="tree-header-main">
                        <Icon
                          :name="
                            worktree.projectId === 'global' ? 'lucide:folder' : 'lucide:git-branch'
                          "
                          class="tree-header-icon"
                        />
                        <div class="tree-label">
                          <span class="tree-label-name" :title="sandbox.directory">{{
                            sandbox.branch || directoryBasename(sandbox.directory)
                          }}</span>
                          <small class="tree-label-type" :title="sandbox.directory">{{
                            shortenPath(sandbox.directory)
                          }}</small>
                        </div>
                      </div>
                      <div class="tree-actions">
                        <button
                          type="button"
                          class="tree-action-button new-session"
                          title="New session"
                          @click.stop="
                            handleCreateSessionIn(worktree.directory, sandbox.directory, close)
                          "
                        >
                          <Icon name="lucide:message-circle-plus" :size="16" />
                        </button>
                        <button
                          v-if="claudeEnabled"
                          type="button"
                          class="tree-action-button new-session claude-session"
                          title="New Claude session"
                          @click.stop="
                            emit('new-claude-session-in', {
                              worktree: worktree.directory,
                              directory: sandbox.directory,
                            })
                          "
                        >
                          <Icon name="lucide:asterisk" :size="20" />
                        </button>
                        <button
                          v-if="worktree.projectId !== 'global'"
                          type="button"
                          class="tree-action-button fork"
                          title="Create a new sandbox"
                          @click.stop="handleCreateWorktree(sandbox.directory, close)"
                        >
                          <Icon name="lucide:git-branch-plus" :size="16" />
                        </button>
                        <button
                          v-if="
                            canDeleteSandbox(sandbox.directory, worktree.directory) &&
                            worktree.projectId !== 'global'
                          "
                          type="button"
                          class="tree-action-button danger"
                          @click.stop="handleSandboxDelete(sandbox.directory, close)"
                        >
                          <Icon name="lucide:trash-2" :size="16" />
                        </button>
                      </div>
                    </div>

                    <div
                      v-for="session in sandbox.sessions"
                      :key="session.id"
                      class="tree-session-row"
                    >
                      <DropdownItem
                        :href="sessionShareHref(worktree.projectId, session.id)"
                        :value="{
                          projectId: worktree.projectId,
                          worktree: worktree.directory,
                          directory: sandbox.directory,
                          sessionId: session.id,
                        }"
                        :active="session.id === selectedSessionId"
                      >
                        <div class="tree-session-main">
                          <span class="session-status-icon" :title="session.status">{{
                            sessionStatusIcon(session.status)
                          }}</span>
                          <div class="session-info">
                            <div class="session-info-top">
                              <span class="session-title">{{
                                session.title || session.slug || session.id
                              }}</span>
                              <span v-if="session.archivedAt" class="session-badge-archived"
                                >archived</span
                              >
                            </div>
                            <span
                              v-if="session.timeCreated || session.timeUpdated"
                              class="session-time"
                            >
                              {{ formatSessionMetaTime(session) }}
                            </span>
                          </div>
                        </div>
                        <button
                          v-if="!session.archivedAt"
                          type="button"
                          class="tree-action-button session-del"
                          :class="isShiftPressed ? 'danger' : 'archive'"
                          :title="
                            isShiftPressed
                              ? 'Delete session permanently'
                              : 'Archive session (with Shift key to delete permanently)'
                          "
                          @click.stop.prevent="handleSessionAction(session.id, close)"
                        >
                          <Icon
                            :name="isShiftPressed ? 'lucide:trash-2' : 'lucide:archive'"
                            :size="16"
                          />
                        </button>
                      </DropdownItem>
                    </div>

                    <button
                      v-if="
                        sandbox.allSessions && sandbox.allSessions.length > sandbox.sessions.length
                      "
                      type="button"
                      class="show-more-button"
                      @click.stop="openAllSessions(worktree, sandbox)"
                    >
                      Show {{ sandbox.allSessions.length - sandbox.sessions.length }} more session{{
                        sandbox.allSessions.length - sandbox.sessions.length === 1 ? '' : 's'
                      }}...
                    </button>
                  </div>
                </div>
              </div>

              <div class="tree-footer">
                <button
                  type="button"
                  class="tree-footer-button"
                  @click="handleOpenDirectory(close)"
                >
                  <Icon name="lucide:folder-open" :size="14" />
                  Open project…
                </button>
              </div>
            </div>
          </template>
        </Dropdown>

        <button
          type="button"
          class="control-button new-session-button"
          :disabled="!selectedSessionId"
          @click="$emit('new-session')"
          title="New session (Ctrl-;)"
        >
          <Icon name="lucide:message-circle-plus" :size="16" />
        </button>
        <button
          v-if="claudeEnabled"
          type="button"
          class="control-button new-session-button claude-session-button"
          :disabled="!activeDirectory"
          @click="$emit('new-claude-session')"
          title="New Claude session"
        >
          <Icon name="lucide:asterisk" :size="20" />
        </button>
        <button
          type="button"
          class="control-button open-shell-button"
          :disabled="!activeDirectory"
          @click="$emit('open-shell')"
          title="Open shell"
        >
          <Icon name="lucide:terminal" :size="16" />
        </button>
      </div>
      <div class="top-right">
        <a
          href="https://github.com/SebbeJohansson/openui"
          target="_blank"
          rel="noopener noreferrer"
          class="control-button github-button"
          title="GitHub"
        >
          <Icon name="lucide:github" :size="16" />
        </a>
        <Dropdown
          v-model:open="menuOpen"
          auto-close
          :popup-style="{ width: '160px', left: 'auto', right: 'anchor(right)' }"
          @select="onMenuSelect"
        >
          <template #trigger>
            <button
              type="button"
              class="control-button menu-button"
              @click.stop="menuOpen = !menuOpen"
            >
              <Icon name="lucide:ellipsis-vertical" :size="16" />
            </button>
          </template>
          <DropdownItem value="settings">
            <span class="menu-item-content">
              <Icon name="lucide:settings" :size="14" />
              Settings
            </span>
          </DropdownItem>
          <DropdownItem value="logout">
            <span class="menu-item-content">
              <Icon name="lucide:log-out" :size="14" />
              Logout
            </span>
          </DropdownItem>
        </Dropdown>
      </div>
    </div>

    <SessionsModal
      :open="sessionsModalOpen"
      :sessions="sessionsModalSessions"
      :branch-label="sessionsModalBranch"
      :selected-session-id="selectedSessionId"
      @close="sessionsModalOpen = false"
      @select="onModalSelectSession"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount, onMounted } from 'vue';
import Dropdown from './Dropdown.vue';
import DropdownItem from './Dropdown/Item.vue';
import DropdownSearch from './Dropdown/Search.vue';
import SessionsModal from './SessionsModal.vue';
import { matchesQuery, sessionStatusIcon } from '../utils/session';

const gitRevision = useRuntimeConfig().public.gitRevision;

export type TopPanelSession = {
  id: string;
  title?: string;
  slug?: string;
  status: 'busy' | 'idle' | 'retry' | 'unknown';
  timeCreated?: number;
  timeUpdated?: number;
  archivedAt?: number;
  source?: 'claude' | 'opencode';
};

export type TopPanelSandbox = {
  directory: string;
  branch?: string;
  sessions: TopPanelSession[];
};

export type TopPanelWorktree = {
  directory: string;
  label: string;
  name?: string;
  projectId?: string;
  projectColor?: string;
  sandboxes: TopPanelSandbox[];
};

export type TopPanelNotificationSession = {
  projectId: string;
  sessionId: string;
  count: number;
};

type SessionSelectPayload = {
  projectId?: string;
  worktree: string;
  directory: string;
  sessionId: string;
};

const props = defineProps<{
  treeData: TopPanelWorktree[];
  notificationSessions: TopPanelNotificationSession[];
  projectDirectory: string;
  activeDirectory: string;
  selectedSessionId: string;
  homePath?: string;
  claudeEnabled?: boolean;
}>();

const notifications = computed(() => props.notificationSessions ?? []);
const totalNotificationCount = computed(() =>
  notifications.value.reduce((sum, item) => sum + item.count, 0),
);

const emit = defineEmits<{
  (event: 'select-notification'): void;
  (event: 'select-session', payload: SessionSelectPayload): void;
  (event: 'create-worktree-from', worktree: string): void;
  (event: 'new-session'): void;
  (event: 'new-claude-session'): void;
  (event: 'new-session-in', payload: { worktree: string; directory: string }): void;
  (event: 'new-claude-session-in', payload: { worktree: string; directory: string }): void;
  (event: 'delete-active-directory', value: string): void;
  (event: 'delete-session', value: string): void;
  (event: 'archive-session', value: string): void;
  (event: 'open-directory'): void;
  (event: 'open-shell'): void;
  (event: 'edit-project', payload: { projectId: string; worktree: string }): void;
  (event: 'archive-project', payload: { projectId: string; worktree: string }): void;
  (event: 'delete-project', payload: { projectId: string; worktree: string }): void;
  (event: 'open-settings'): void;
  (event: 'logout'): void;
  (event: 'dropdown-closed'): void;
}>();

const menuOpen = ref(false);
const treeDropdownOpen = ref(false);

watch(treeDropdownOpen, (open) => {
  if (open) {
    searchQuery.value = '';
  }
  if (!open) emit('dropdown-closed');
});

function openSessionDropdown() {
  treeDropdownOpen.value = true;
}

function closeSessionDropdown() {
  treeDropdownOpen.value = false;
}

function toggleSessionDropdown() {
  treeDropdownOpen.value = !treeDropdownOpen.value;
}

defineExpose({ openSessionDropdown, closeSessionDropdown, toggleSessionDropdown });

function onMenuSelect(value: unknown) {
  if (value === 'settings') emit('open-settings');
  else if (value === 'logout') emit('logout');
}

const MAX_WORKTREES = Infinity;
const MAX_SANDBOXES = Infinity;
const MAX_SESSIONS = 5;

const searchQuery = ref('');
const isShiftPressed = ref(false);

// "View all sessions" modal state
const sessionsModalOpen = ref(false);
const sessionsModalBranch = ref('');
const sessionsModalSessions = ref<TopPanelSession[]>([]);
const sessionsModalWorktree = ref('');
const sessionsModalDirectory = ref('');
const sessionsModalProjectId = ref<string | undefined>();

function openAllSessions(
  worktree: TopPanelWorktree,
  sandbox: TopPanelSandbox & { allSessions?: TopPanelSession[] },
) {
  sessionsModalBranch.value = sandbox.branch || directoryBasename(sandbox.directory);
  sessionsModalSessions.value = sandbox.allSessions ?? sandbox.sessions;
  sessionsModalWorktree.value = worktree.directory;
  sessionsModalDirectory.value = sandbox.directory;
  sessionsModalProjectId.value = worktree.projectId;
  sessionsModalOpen.value = true;
}

function onModalSelectSession(sessionId: string) {
  sessionsModalOpen.value = false;
  emit('select-session', {
    projectId: sessionsModalProjectId.value,
    worktree: sessionsModalWorktree.value,
    directory: sessionsModalDirectory.value,
    sessionId,
  });
  treeDropdownOpen.value = false;
}

const selectedDisplay = computed(() => {
  const sid = props.selectedSessionId;
  if (!sid) return null;
  for (const worktree of props.treeData) {
    for (const sandbox of worktree.sandboxes) {
      const session = sandbox.sessions.find((candidate) => candidate.id === sid);
      if (!session) continue;
      const branch = sandbox.branch || directoryBasename(sandbox.directory);
      const title = session.title || session.slug || session.id;
      return { branch, title, status: session.status };
    }
  }
  return { branch: 'unknown', title: sid, status: 'unknown' as const };
});

const dropdownLabel = computed(() => {
  if (!selectedDisplay.value) return 'Select session';
  return `${selectedDisplay.value.branch} / ${selectedDisplay.value.title}`;
});

const displayedTree = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  let worktrees = props.treeData;

  if (query) {
    worktrees = worktrees
      .map((worktree) => {
        const worktreeMatches = matchesQuery(
          query,
          worktree.directory,
          worktree.label,
          worktree.name,
        );
        const sandboxes = worktree.sandboxes
          .map((sandbox) => {
            const sandboxMatches = matchesQuery(query, sandbox.directory, sandbox.branch);
            const sessions = sandbox.sessions.filter(
              (session) =>
                worktreeMatches ||
                sandboxMatches ||
                matchesQuery(
                  query,
                  session.title,
                  session.slug,
                  session.id,
                  session.archivedAt ? 'archived' : undefined,
                  session.timeCreated ? formatSessionTime(session.timeCreated) : undefined,
                  session.timeUpdated ? formatSessionTime(session.timeUpdated) : undefined,
                ),
            );
            if (!worktreeMatches && !sandboxMatches && sessions.length === 0) return null;
            return {
              ...sandbox,
              sessions: worktreeMatches || sandboxMatches ? sandbox.sessions : sessions,
            };
          })
          .filter((sandbox): sandbox is TopPanelSandbox => sandbox !== null);

        if (!worktreeMatches && sandboxes.length === 0) return null;
        return { ...worktree, sandboxes };
      })
      .filter((worktree): worktree is TopPanelWorktree => worktree !== null);
  } else {
    worktrees = worktrees
      .map((worktree) => ({
        ...worktree,
        sandboxes: worktree.sandboxes.map((sandbox) => ({
          ...sandbox,
          sessions: sandbox.sessions.filter((session) => !session.archivedAt),
        })),
      }))
      .filter((worktree) => worktree.sandboxes.some((sandbox) => sandbox.sessions.length > 0));
  }

  return worktrees.slice(0, MAX_WORKTREES).map((worktree) => ({
    ...worktree,
    sandboxes: worktree.sandboxes
      .filter((sandbox) => worktree.projectId !== 'global' || sandbox.sessions.length > 0)
      .slice(0, MAX_SANDBOXES)
      .map((sandbox) => ({
        ...sandbox,
        allSessions: sandbox.sessions,
        sessions: sandbox.sessions.slice(0, MAX_SESSIONS),
      })),
  }));
});

function sessionShareHref(projectId: string | undefined, sessionId: string) {
  const params = new URLSearchParams();
  const normalizedProjectId = projectId?.trim() ?? '';
  const normalizedSessionId = sessionId.trim();
  if (normalizedProjectId) params.set('project', normalizedProjectId);
  if (normalizedSessionId) params.set('session', normalizedSessionId);
  return `?${params.toString()}`;
}

function shortenPath(path: string) {
  const homePath = props.homePath || '';
  if (homePath && path.startsWith(homePath)) {
    const replaced = path.replace(homePath, '~');
    return replaced || '~';
  }
  return path;
}

function directoryBasename(path: string) {
  return path.replace(/\/+$/, '').split('/').pop() ?? '';
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

function formatSessionMetaTime(session: TopPanelSession) {
  const created = session.timeCreated ? formatSessionTime(session.timeCreated) : undefined;
  const updated = session.timeUpdated ? formatSessionTime(session.timeUpdated) : undefined;
  if (created && updated) {
    return `Created: ${created} / Updated: ${updated}`;
  }
  if (created) return `Created: ${created}`;
  if (updated) return `Updated: ${updated}`;
  return '';
}

function canDeleteSandbox(directory: string, worktreeDirectory: string) {
  const normalizedDirectory = directory.replace(/\/+$/, '');
  const normalizedWorktree = worktreeDirectory.replace(/\/+$/, '');
  return normalizedDirectory !== normalizedWorktree;
}

function worktreeAccentStyle(worktree: TopPanelWorktree) {
  if (!worktree.projectColor) return undefined;
  return {
    borderLeft: `3px solid ${worktree.projectColor}`,
  };
}

function onTreeSelect(payload: unknown) {
  if (!payload || typeof payload !== 'object') return;
  const value = payload as Partial<SessionSelectPayload>;
  if (!value.worktree || !value.directory || !value.sessionId) return;
  emit('select-session', {
    projectId: value.projectId,
    worktree: value.worktree,
    directory: value.directory,
    sessionId: value.sessionId,
  });
}

function handleCreateSessionIn(worktree: string, directory: string, close: () => void) {
  emit('new-session-in', { worktree, directory });
  close();
}

function handleCreateWorktree(worktree: string, close: () => void) {
  emit('create-worktree-from', worktree);
  close();
}

function handleSandboxDelete(directory: string, close?: () => void) {
  if (typeof window !== 'undefined') {
    const confirmed = window.confirm(`Delete worktree "${directory}"?`);
    if (!confirmed) return;
  }
  emit('delete-active-directory', directory);
  close?.();
}

function handleSessionDelete(sessionId: string, close?: () => void) {
  if (typeof window !== 'undefined') {
    const confirmed = window.confirm('Delete session?');
    if (!confirmed) return;
  }
  emit('delete-session', sessionId);
  close?.();
}

function handleSessionAction(sessionId: string, close?: () => void) {
  if (isShiftPressed.value) {
    handleSessionDelete(sessionId, close);
    return;
  }
  emit('archive-session', sessionId);
}

function handleProjectDelete(projectId: string, worktree: string, close?: () => void) {
  if (typeof window !== 'undefined') {
    const confirmed = window.confirm('Delete all sessions in this project permanently?');
    if (!confirmed) return;
  }
  emit('delete-project', { projectId, worktree });
  close?.();
}

function handleProjectAction(projectId: string, worktree: string, close?: () => void) {
  if (isShiftPressed.value) {
    handleProjectDelete(projectId, worktree, close);
    return;
  }
  emit('archive-project', { projectId, worktree });
  close?.();
}

function handleGlobalKeydown(event: KeyboardEvent) {
  isShiftPressed.value = event.shiftKey;
}

function handleGlobalKeyup(event: KeyboardEvent) {
  isShiftPressed.value = event.shiftKey;
}

function resetShiftState() {
  isShiftPressed.value = false;
}

onMounted(() => {
  window.addEventListener('keydown', handleGlobalKeydown);
  window.addEventListener('keyup', handleGlobalKeyup);
  window.addEventListener('blur', resetShiftState);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleGlobalKeydown);
  window.removeEventListener('keyup', handleGlobalKeyup);
  window.removeEventListener('blur', resetShiftState);
});

function handleOpenDirectory(close: () => void) {
  emit('open-directory');
  close();
}
</script>

<style scoped>
.top-panel {
  position: relative;
  width: 100%;
  min-width: 0;
  /* Full-width background band that breaks out of parent padding */
  margin: -12px -12px 0;
  padding: 8px 12px;
  width: calc(100% + 24px);
  background: var(--theme-bg-overlay);
  border-bottom: 1px solid var(--theme-border);
}

.top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}

.top-left {
  flex: 0 0 auto;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--theme-text-primary);
}

.logo-icon {
  color: var(--theme-accent);
}

.top-center {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
}

.top-right {
  flex: 0 0 auto;
  display: flex;
  justify-content: flex-end;
}

.tree-dropdown-root {
  flex: 0 1 680px;
  width: min(680px, 70vw);
  min-width: 260px;
}

.tree-menu {
  display: flex;
  flex-direction: column;
  background: transparent;
  flex: 1 1 auto;
  min-height: 0;
}

.tree-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-bottom: 1px solid var(--theme-border);
  background: var(--theme-bg-overlay);
}

.search-icon {
  width: 14px;
  height: 14px;
  color: var(--theme-text-subtle);
}

.tree-search :deep(.ui-dropdown-search-input) {
  border-radius: 8px;
  font-size: 12px;
  padding: 6px 8px;
}

.tree-search :deep(.ui-dropdown-search-input):focus {
  background: var(--theme-bg-selected);
}

.clear-search {
  border: none;
  background: transparent;
  color: var(--theme-text-subtle);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
}

.tree-content {
  flex: 1 1 auto;
  overflow-y: auto;
  min-height: 0;
  padding: 6px 0;
}

.tree-worktree + .tree-worktree {
  border-top: 1px solid var(--theme-border);
}

.tree-empty {
  padding: 14px;
  text-align: center;
  color: var(--theme-text-muted);
  font-size: 12px;
}

.tree-worktree-header,
.tree-sandbox-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.tree-header-main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  column-gap: 4px;
  row-gap: 0;
  min-width: 0;
  flex: 1 1 auto;
}

.tree-header-icon {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  color: var(--theme-text-subtle);
}

.tree-worktree-header {
  padding: 6px 8px;
}

.tree-sandbox-header {
  padding: 5px 8px 5px 24px;
}

.tree-label {
  display: contents;
}

.tree-label-name {
  font-size: 12px;
  color: var(--theme-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1 1 auto;
}

.tree-label-type {
  font-size: 10px;
  color: var(--theme-text-subtle);
  flex-basis: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-actions {
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  gap: 6px;
  /* Reserve space for new-session + claude + fork + delete buttons */
  min-width: calc(24px + 6px + 24px + 6px + 24px + 6px + 24px);
}

.tree-action-button.new-session {
  color: var(--theme-success);
}

.tree-action-button.claude-session {
  color: #cc785c;
}

.tree-action-button.fork {
  color: var(--theme-info);
}

.tree-action-button {
  border: 1px solid var(--theme-border);
  border-radius: 6px;
  background: var(--theme-bg-surface);
  color: var(--theme-text-secondary);
  font-size: 10px;
  line-height: 1;
  width: 24px;
  height: 24px;
  padding: 0;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.tree-action-button:hover {
  background: var(--theme-bg-hover);
}

.tree-action-button.worktree-settings {
  color: var(--theme-text-muted);
}

.tree-action-button.danger {
  color: var(--theme-danger);
}

.tree-action-button.archive {
  color: var(--theme-special);
}

/* Session rows: wrapper provides indentation via :deep() */
.tree-session-row :deep(.ui-dropdown-item) {
  padding-left: 40px;
  border-radius: 0;
  color: var(--theme-text-secondary);
}

.tree-session-row :deep(.ui-dropdown-item:hover),
.tree-session-row :deep(.ui-dropdown-item[aria-selected='true']) {
  background: var(--theme-bg-hover);
}

.tree-session-row :deep(.ui-dropdown-item.is-active) {
  background: var(--theme-bg-selected);
  border: 1px solid var(--theme-accent-soft);
}

/* ===== Tree branch connectors ===== */

/* --- Worktree → Sandbox branches --- */
.tree-sandbox {
  position: relative;
}

/* Non-last sandbox: ├── (vertical line continues to next sibling) */
.tree-sandbox:not(:last-child)::before {
  content: '';
  position: absolute;
  left: 15px;
  top: 0;
  bottom: 0;
  border-left: 1px solid var(--theme-border-subtle);
  pointer-events: none;
}

.tree-sandbox:not(:last-child)::after {
  content: '';
  position: absolute;
  left: 15px;
  top: 13px;
  width: 7px;
  height: 0;
  border-top: 1px solid var(--theme-border-subtle);
  pointer-events: none;
}

/* Last sandbox: └── (L-shape, no line below) */
.tree-sandbox:last-child::before {
  content: '';
  position: absolute;
  left: 15px;
  top: 0;
  width: 7px;
  height: 13px;
  border-left: 1px solid var(--theme-border-subtle);
  border-bottom: 1px solid var(--theme-border-subtle);
  border-bottom-left-radius: 4px;
  pointer-events: none;
}

/* --- Sandbox → Session branches --- */
.tree-session-row {
  position: relative;
}

/* Non-last session: ├── */
.tree-session-row:not(:last-child)::before {
  content: '';
  position: absolute;
  left: 31px;
  top: 0;
  bottom: 0;
  border-left: 1px solid var(--theme-border-subtle);
  pointer-events: none;
}

.tree-session-row:not(:last-child)::after {
  content: '';
  position: absolute;
  left: 31px;
  top: 14px;
  width: 7px;
  height: 0;
  border-top: 1px solid var(--theme-border-subtle);
  pointer-events: none;
}

/* Last session: └── */
.tree-session-row:last-child::before {
  content: '';
  position: absolute;
  left: 31px;
  top: 0;
  width: 7px;
  height: 14px;
  border-left: 1px solid var(--theme-border-subtle);
  border-bottom: 1px solid var(--theme-border-subtle);
  border-bottom-left-radius: 4px;
  pointer-events: none;
}

.tree-session-main {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-start;
  column-gap: 8px;
  row-gap: 1px;
  flex: 1 1 auto;
}

.session-status-icon {
  flex: 0 0 auto;
  width: 14px;
  text-align: center;
}

.session-title {
  color: var(--theme-text-secondary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
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

.session-time {
  font-size: 10px;
  color: var(--theme-text-subtle);
  white-space: nowrap;
  flex-basis: 100%;
}

.session-badge-archived {
  flex: 0 0 auto;
  margin-left: auto;
  font-size: 10px;
  line-height: 1;
  color: var(--theme-special);
  background: color-mix(in srgb, var(--theme-special) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--theme-special) 30%, transparent);
  border-radius: 999px;
  padding: 2px 6px;
}

.session-del {
  flex: 0 0 auto;
  margin-left: auto;
}

.show-more-button {
  display: block;
  width: calc(100% - 40px);
  margin: 2px 0 4px 40px;
  padding: 5px 8px;
  border: 1px dashed var(--theme-border);
  border-radius: 6px;
  background: transparent;
  color: var(--theme-info);
  font-size: 11px;
  cursor: pointer;
  text-align: center;
}

.show-more-button:hover {
  background: var(--theme-bg-hover);
  border-color: var(--theme-border-strong);
  color: var(--theme-info);
}

.tree-footer {
  flex: 0 0 auto;
  border-top: 1px solid var(--theme-border);
  padding: 8px;
  background: var(--theme-bg-elevated);
}

.tree-footer-button {
  width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid var(--theme-border);
  border-radius: 8px;
  background: var(--theme-bg-surface);
  color: var(--theme-text-secondary);
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
}

.tree-footer-button:hover {
  background: var(--theme-bg-hover);
}

.control-button {
  border: 1px solid var(--theme-border);
  border-radius: 8px;
  background: var(--theme-bg-elevated);
  color: var(--theme-text-secondary);
  padding: 6px 12px;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}

.new-session-button {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  padding: 0;
  justify-content: center;
  color: var(--theme-success);
}

.new-session-button:hover,
.open-shell-button:hover {
  background: var(--theme-bg-hover);
}

.claude-session-button {
  color: #cc785c;
}

.open-shell-button {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  padding: 0;
  justify-content: center;
  color: var(--theme-special);
}

.notification-button {
  position: relative;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  padding: 0;
  justify-content: center;
  color: var(--theme-text-subtle);
}

.notification-button.has-notifications {
  color: var(--theme-warning);
}

.notification-badge {
  position: absolute;
  top: -5px;
  right: -5px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--theme-danger-strong);
  color: var(--theme-text-inverse);
  font-size: 10px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
}

.tree-dropdown-root :deep(.ui-dropdown-button) {
  background: var(--theme-bg-elevated);
  border-color: var(--theme-border);
  color: var(--theme-text-secondary);
  box-shadow: none;
}

.tree-dropdown-root :deep(.ui-dropdown-menu) {
  background: var(--theme-bg-elevated);
  border: 1px solid var(--theme-border);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.selected-label {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: 100%;
}

.selected-status-icon {
  flex: 0 0 auto;
  width: 14px;
  text-align: center;
  font-size: 12px;
  line-height: 1;
}

.selected-title {
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}

.selected-branch-badge {
  flex: 0 0 auto;
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--theme-border);
  border-radius: 999px;
  padding: 2px 6px;
  color: var(--theme-text-secondary);
  background: var(--theme-bg-surface);
  font-size: 11px;
  line-height: 1;
}

.control-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.github-button {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  padding: 0;
  justify-content: center;
  text-decoration: none;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--theme-text-muted);
}

.github-button:hover {
  background: transparent;
  color: var(--theme-text-secondary);
}

.menu-button {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  padding: 0;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--theme-text-muted);
}

.menu-button:hover {
  background: transparent;
  color: var(--theme-text-secondary);
}

.menu-item-content {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--theme-text-secondary);
}

/* ============================================================
   MOBILE STYLES  (< 768px)
   ============================================================ */

@media (max-width: 767px) {
  .top-panel {
    padding: 6px 8px;
    margin: -6px -6px 0;
    width: calc(100% + 12px);
  }

  .top-row {
    gap: 4px;
  }

  /* Hide buttons that don't fit — move actions to menu */
  .new-session-button,
  .open-shell-button,
  .github-button {
    display: none !important;
  }

  /* Let the session dropdown fill available center space on mobile */
  .tree-dropdown-root {
    flex: 1 1 auto;
    width: auto;
    min-width: 0;
  }

  /* Hide the branch badge in the dropdown label on narrow screens */
  .selected-branch-badge {
    display: none;
  }

  /* Smaller control buttons on mobile */
  .control-button {
    padding: 4px 6px;
  }

  .notification-button,
  .menu-button {
    width: 28px;
    height: 28px;
    flex-shrink: 0;
  }
}
</style>
