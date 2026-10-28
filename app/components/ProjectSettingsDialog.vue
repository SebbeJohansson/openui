<template>
  <dialog
    ref="dialogRef"
    class="modal-backdrop"
    @close="$emit('close')"
    @pointerdown.stop
    @click.self="dialogRef?.close()"
  >
    <div class="modal">
      <header class="modal-header">
        <div class="modal-title">Project Settings</div>
        <button type="button" class="modal-close-button" @click="dialogRef?.close()">
          <Icon name="lucide:x" :size="14" />
        </button>
      </header>
      <form class="modal-body" @submit.prevent="handleSubmit">
        <div class="field">
          <label class="field-label">Name</label>
          <div class="name-row">
            <input v-model="form.name" type="text" class="field-input" :placeholder="defaultName" />
            <button
              type="button"
              class="sync-button"
              :disabled="!packageJsonName"
              :title="
                packageJsonName
                  ? `Sync from package.json: ${packageJsonName}`
                  : 'Sync from package.json'
              "
              @click="form.name = packageJsonName!"
            >
              <Icon name="lucide:refresh-cw" :size="14" />
            </button>
          </div>
        </div>

        <div class="field">
          <label class="field-label">Icon</label>
          <div class="icon-row">
            <div
              class="icon-preview"
              :class="{ 'drag-over': dragOver, 'has-icon': !!form.iconUrl }"
              @drop.prevent="handleDrop"
              @dragover.prevent="dragOver = true"
              @dragleave="dragOver = false"
              @click="form.iconUrl ? clearIcon() : iconInput?.click()"
            >
              <img v-if="form.iconUrl" :src="form.iconUrl" alt="icon" class="icon-image" />
              <span v-else class="icon-letter" :style="avatarStyle">{{ avatarLetter }}</span>
              <div v-if="form.iconUrl" class="icon-overlay delete">
                <Icon name="lucide:trash-2" :size="20" />
              </div>
              <div v-else class="icon-overlay upload">
                <Icon name="lucide:upload" :size="20" />
              </div>
            </div>
            <input
              ref="iconInput"
              type="file"
              accept="image/*"
              class="hidden-input"
              @change="handleFileInput"
            />
            <div class="icon-hint">
              <span>Click or drag an image</span>
              <span>Recommended: 128x128px</span>
            </div>
          </div>
        </div>

        <div v-if="!form.iconUrl" class="field">
          <label class="field-label">Color</label>
          <div class="color-row">
            <button
              v-for="c in COLOR_KEYS"
              :key="c"
              type="button"
              class="color-swatch"
              :class="{ selected: form.color === c }"
              :aria-pressed="form.color === c"
              :aria-label="c"
              @click="form.color = c"
            >
              <span class="swatch-letter" :style="swatchStyle(c)">{{ avatarLetter }}</span>
            </button>
          </div>
        </div>

        <div class="field">
          <label class="field-label">Workspace startup script</label>
          <textarea
            v-model="form.startup"
            class="field-textarea"
            placeholder="e.g. bun install"
            rows="2"
            spellcheck="false"
          />
          <span class="field-description">Runs after creating a new workspace (worktree).</span>
        </div>

        <div class="modal-actions">
          <button type="submit" class="action-button save" :disabled="saving">
            {{ saving ? 'Saving...' : 'Save' }}
          </button>
        </div>
      </form>
    </div>
  </dialog>
</template>

<script setup lang="ts">
import { ref, reactive, watch, computed } from 'vue';
import * as opencodeApi from '../utils/opencode';

const COLOR_KEYS = ['pink', 'mint', 'orange', 'purple', 'cyan', 'lime'] as const;

const COLOR_HEX: Record<string, { text: string; bg: string }> = {
  pink: { text: '#e34ba9', bg: '#501b3f' },
  mint: { text: '#95f3d9', bg: '#033a34' },
  orange: { text: '#ff802b', bg: '#5f2a06' },
  purple: { text: '#9d5bd2', bg: '#432155' },
  cyan: { text: '#369eff', bg: '#0f3058' },
  lime: { text: '#c4f042', bg: '#2b3711' },
};

const props = defineProps<{
  open: boolean;
  projectId: string;
  worktree: string;
  name?: string;
  iconColor?: string;
  iconOverride?: string;
  commandsStart?: string;
}>();

const emit = defineEmits<{
  (event: 'close'): void;
  (
    event: 'save',
    payload: {
      projectId: string;
      worktree: string;
      name: string;
      icon: { color: string; override: string };
      commands: { start: string };
    },
  ): void;
}>();

const dialogRef = ref<HTMLDialogElement | null>(null);
const iconInput = ref<HTMLInputElement | null>(null);
const saving = ref(false);
const dragOver = ref(false);
const packageJsonName = ref<string | undefined>(undefined);

const form = reactive({
  name: '',
  color: 'pink' as string,
  iconUrl: '',
  startup: '',
});

const defaultName = computed(() => {
  const w = props.worktree || '';
  const parts = w.replace(/\\/g, '/').replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || w;
});

const avatarLetter = computed(() => {
  const name = form.name.trim() || defaultName.value;
  // For scoped packages like "@scope/foo", use the basename part
  const basename = name.replace(/^@[^/]*\//, '');
  return (basename.charAt(0) || name.charAt(0)).toUpperCase();
});

const avatarStyle = computed(() => {
  const c = COLOR_HEX[form.color];
  if (!c) return {};
  return { color: c.text, backgroundColor: c.bg };
});

function swatchStyle(key: string) {
  const c = COLOR_HEX[key];
  if (!c) return {};
  return { color: c.text, backgroundColor: c.bg };
}

watch(
  () => props.open,
  (open) => {
    const el = dialogRef.value;
    if (!el) return;
    if (open) {
      form.name = props.name || defaultName.value;
      form.color = props.iconColor || 'pink';
      form.iconUrl = props.iconOverride || '';
      form.startup = props.commandsStart || '';
      saving.value = false;
      dragOver.value = false;
      packageJsonName.value = undefined;
      if (!el.open) el.showModal();
      void fetchPackageJsonName();
    } else if (el.open) {
      el.close();
    }
  },
);

async function fetchPackageJsonName() {
  if (!props.worktree) return;
  try {
    const result = (await opencodeApi.readFileContent({
      directory: props.worktree,
      path: 'package.json',
    })) as { content?: string; encoding?: string } | string;
    const content = typeof result === 'string' ? result : result?.content;
    if (!content) return;
    const isBase64 = typeof result !== 'string' && result?.encoding === 'base64';
    const decoded = isBase64 ? atob(content) : content;
    const parsed = JSON.parse(decoded);
    const name = parsed?.name;
    if (typeof name === 'string' && name.trim()) {
      packageJsonName.value = name.trim();
    }
  } catch {
    // package.json not found or invalid — leave button disabled
  }
}

function handleFileSelect(file: File) {
  if (!file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    form.iconUrl = (e.target?.result as string) || '';
  };
  reader.readAsDataURL(file);
}

function handleDrop(e: DragEvent) {
  dragOver.value = false;
  const file = e.dataTransfer?.files[0];
  if (file) handleFileSelect(file);
}

function handleFileInput(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) handleFileSelect(file);
  input.value = '';
}

function clearIcon() {
  form.iconUrl = '';
}

async function handleSubmit() {
  saving.value = true;
  try {
    const name = form.name.trim() === defaultName.value ? '' : form.name.trim();
    emit('save', {
      projectId: props.projectId,
      worktree: props.worktree,
      name,
      icon: { color: form.color, override: form.iconUrl },
      commands: { start: form.startup.trim() },
    });
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.modal-backdrop {
  border: none;
  padding: 0;
  margin: 0;
  background: transparent;
  color: inherit;
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  max-width: none;
  max-height: none;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-backdrop:not([open]) {
  display: none;
}

.modal-backdrop::backdrop {
  background: color-mix(in srgb, var(--theme-bg-base) 65%, transparent);
}

.modal {
  width: min(480px, 95vw);
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: var(--theme-bg-overlay);
  border: 1px solid var(--theme-border);
  border-radius: 12px;
  box-shadow: 0 12px 32px color-mix(in srgb, var(--theme-bg-base) 45%, transparent);
  color: var(--theme-text-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.modal-title {
  font-size: 14px;
  font-weight: 600;
}

.modal-close-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--theme-border);
  border-radius: 6px;
  background: transparent;
  color: var(--theme-text-muted);
  cursor: pointer;
}

.modal-close-button:hover {
  background: var(--theme-bg-hover);
  color: var(--theme-text-secondary);
}

.modal-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--theme-text-muted);
}

.name-row {
  display: flex;
  gap: 6px;
  align-items: stretch;
}

.name-row .field-input {
  flex: 1 1 auto;
  min-width: 0;
}

.sync-button {
  flex: 0 0 auto;
  width: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--theme-border);
  border-radius: 8px;
  background: var(--theme-bg-surface);
  color: var(--theme-text-muted);
  cursor: pointer;
}

.sync-button:hover:not(:disabled) {
  background: var(--theme-bg-hover);
  color: var(--theme-text-secondary);
}

.sync-button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.field-input,
.field-textarea {
  background: color-mix(in srgb, var(--theme-bg-base) 45%, transparent);
  border: 1px solid var(--theme-border);
  border-radius: 8px;
  color: var(--theme-text-secondary);
  font-family: inherit;
  font-size: 13px;
  padding: 8px 10px;
  outline: none;
}

.field-input:focus,
.field-textarea:focus {
  border-color: var(--theme-border-strong);
  background: color-mix(in srgb, var(--theme-bg-base) 60%, transparent);
}

.field-textarea {
  resize: vertical;
  min-height: 40px;
}

.field-description {
  font-size: 11px;
  color: var(--theme-text-subtle);
}

/* Icon preview */
.icon-row {
  display: flex;
  gap: 12px;
  align-items: center;
}

.icon-preview {
  width: 56px;
  height: 56px;
  border-radius: 8px;
  border: 1px solid var(--theme-border);
  cursor: pointer;
  position: relative;
  overflow: hidden;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon-preview.drag-over {
  border-color: var(--theme-accent-strong);
  background: color-mix(in srgb, var(--theme-accent-strong) 10%, transparent);
}

.icon-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.icon-letter {
  font-size: 28px;
  font-weight: 700;
  line-height: 1;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
}

.icon-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--theme-bg-overlay);
  opacity: 0;
  transition: opacity 0.15s;
  color: var(--theme-text-secondary);
  border-radius: 7px;
}

.icon-preview:hover .icon-overlay {
  opacity: 1;
}

.icon-hint {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  color: var(--theme-text-subtle);
}

.hidden-input {
  display: none;
}

/* Color swatches */
.color-row {
  display: flex;
  gap: 6px;
}

.color-swatch {
  width: 40px;
  height: 40px;
  padding: 3px;
  border-radius: 10px;
  border: 2px solid transparent;
  background: transparent;
  cursor: pointer;
  outline: none;
  transition: border-color 0.15s;
}

.color-swatch:hover {
  border-color: var(--theme-border-strong);
}

.color-swatch.selected {
  border-color: var(--theme-border-strong);
}

.swatch-letter {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  border-radius: 6px;
  font-size: 16px;
  font-weight: 700;
  line-height: 1;
}

/* Actions */
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 4px;
}

.action-button {
  border: 1px solid var(--theme-border);
  border-radius: 8px;
  padding: 6px 16px;
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
}

.action-button.save {
  background: var(--theme-accent-strong);
  color: var(--theme-text-secondary);
  border-color: var(--theme-accent-strong);
  font-weight: 600;
}

.action-button.save:hover {
  background: var(--theme-accent-strong);
}

.action-button.save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
