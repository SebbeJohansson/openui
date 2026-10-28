<template>
  <dialog
    ref="dialogRef"
    class="modal-backdrop"
    @close="$emit('close')"
    @cancel.prevent
    @click.self="dialogRef?.close()"
  >
    <div class="modal">
      <header class="modal-header">
        <div class="modal-title">Settings</div>
        <button type="button" class="modal-close-button" @click="dialogRef?.close()">
          <Icon name="lucide:x" :size="14" />
        </button>
      </header>
      <div class="modal-body">
        <!-- ── Theme ── -->
        <div class="setting-row setting-row--column">
          <div class="setting-info">
            <div class="setting-label">Theme</div>
            <div class="setting-description">Choose a color theme for the interface.</div>
          </div>
          <select v-model="selectedTheme" class="setting-select">
            <option v-for="theme in themes" :key="theme.id" :value="theme.id">
              {{ theme.name }}
            </option>
            <option :value="CUSTOM_ID">Custom…</option>
          </select>
        </div>

        <!-- ── Custom theme editor ── -->
        <div v-if="selectedTheme === CUSTOM_ID" class="custom-theme-editor">
          <div class="theme-actions">
            <button type="button" class="theme-action-btn" @click="handleShareTheme">
              <Icon name="lucide:share-2" :size="12" />
              Share
            </button>
            <button type="button" class="theme-action-btn" @click="handleImportTheme">
              <Icon name="lucide:import" :size="12" />
              Import
            </button>
            <button type="button" class="theme-action-btn" @click="handleSurpriseTheme">
              <Icon name="lucide:sparkles" :size="12" />
              Surprise me
            </button>
          </div>
          <div
            v-if="themeActionMessage"
            class="theme-action-message"
            :class="{ 'theme-action-message--error': themeActionError }"
          >
            {{ themeActionMessage }}
          </div>
          <div class="seed-grid">
            <label class="seed-row">
              <span class="seed-label">Background</span>
              <div class="seed-input-group">
                <input
                  type="color"
                  class="color-picker"
                  :value="customSeeds.background"
                  @input="updateSeed('background', ($event.target as HTMLInputElement).value)"
                />
                <span class="seed-hex">{{ customSeeds.background }}</span>
              </div>
            </label>
            <label class="seed-row">
              <span class="seed-label">Text</span>
              <div class="seed-input-group">
                <input
                  type="color"
                  class="color-picker"
                  :value="customSeeds.text"
                  @input="updateSeed('text', ($event.target as HTMLInputElement).value)"
                />
                <span class="seed-hex">{{ customSeeds.text }}</span>
              </div>
            </label>
            <label class="seed-row">
              <span class="seed-label">Accent</span>
              <div class="seed-input-group">
                <input
                  type="color"
                  class="color-picker"
                  :value="customSeeds.accent"
                  @input="updateSeed('accent', ($event.target as HTMLInputElement).value)"
                />
                <span class="seed-hex">{{ customSeeds.accent }}</span>
              </div>
            </label>
            <label class="seed-row">
              <span class="seed-label">Border</span>
              <div class="seed-input-group">
                <input
                  type="color"
                  class="color-picker"
                  :value="customSeeds.border"
                  @input="updateSeed('border', ($event.target as HTMLInputElement).value)"
                />
                <span class="seed-hex">{{ customSeeds.border }}</span>
              </div>
            </label>
            <label class="seed-row seed-row--full">
              <span class="seed-label">Mode</span>
              <div class="mode-toggle">
                <button
                  type="button"
                  class="mode-btn"
                  :class="{ active: customSeeds.mode === 'dark' }"
                  @click="updateSeed('mode', 'dark')"
                >
                  <Icon name="lucide:moon" :size="12" /> Dark
                </button>
                <button
                  type="button"
                  class="mode-btn"
                  :class="{ active: customSeeds.mode === 'light' }"
                  @click="updateSeed('mode', 'light')"
                >
                  <Icon name="lucide:sun" :size="12" /> Light
                </button>
              </div>
            </label>
          </div>

          <!-- Advanced overrides -->
          <button type="button" class="advanced-toggle" @click="showAdvanced = !showAdvanced">
            <Icon
              :name="showAdvanced ? 'lucide:chevron-down' : 'lucide:chevron-right'"
              :size="12"
            />
            Advanced
          </button>
          <div v-if="showAdvanced" class="advanced-grid">
            <label v-for="key in advancedKeys" :key="key" class="seed-row">
              <span class="seed-label">{{ formatKey(key) }}</span>
              <div class="seed-input-group">
                <input
                  v-if="isColorToken(key)"
                  type="color"
                  class="color-picker"
                  :value="resolvedPalette[key] || '#000000'"
                  @input="setOverride(key, ($event.target as HTMLInputElement).value)"
                />
                <input
                  class="seed-hex"
                  :value="customSeeds.overrides?.[key] ?? ''"
                  :placeholder="resolvedPalette[key]"
                  @input="setOverride(key, ($event.target as HTMLInputElement).value || undefined)"
                />
              </div>
            </label>
          </div>
        </div>

        <!-- ── Other settings ── -->
        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">Enter to send</div>
            <div class="setting-description">
              Send messages by pressing Enter. When off, use Ctrl+Enter.
            </div>
          </div>
          <label class="toggle-switch">
            <input v-model="enterToSend" type="checkbox" class="toggle-input" />
            <span class="toggle-track" />
          </label>
        </div>
        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">Full screen floating windows</div>
            <div class="setting-description">
              Allow floating windows to appear over the header and message input area.
            </div>
          </div>
          <label class="toggle-switch">
            <input v-model="fullScreenFloating" type="checkbox" class="toggle-input" />
            <span class="toggle-track" />
          </label>
        </div>
        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">Require .git to open project</div>
            <div class="setting-description">
              Only allow opening directories that contain a .git folder.
            </div>
          </div>
          <label class="toggle-switch">
            <input v-model="requireGitDirectory" type="checkbox" class="toggle-input" />
            <span class="toggle-track" />
          </label>
        </div>
        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">Remember model per agent</div>
            <div class="setting-description">
              Automatically restore the last used model when switching between agent modes.
            </div>
          </div>
          <label class="toggle-switch">
            <input v-model="rememberModelPerAgent" type="checkbox" class="toggle-input" />
            <span class="toggle-track" />
          </label>
        </div>
        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">Peon Ping audio stream</div>
            <div class="setting-description">
              Play audio from a local Peon Ping stream (requires the stream to be running).
            </div>
          </div>
          <label class="toggle-switch">
            <input v-model="peonPingEnabled" type="checkbox" class="toggle-input" />
            <span class="toggle-track" />
          </label>
        </div>
        <div v-if="peonPingEnabled" class="setting-row setting-row--column">
          <div class="setting-info">
            <div class="setting-label">Stream URL</div>
            <div class="setting-description">URL of the audio stream to connect to.</div>
          </div>
          <input
            v-model="peonPingUrl"
            type="url"
            class="setting-url-input"
            placeholder="http://localhost:8000/peon"
          />
          <div v-if="!peonPingUrl.trim()" class="setting-hint">
            Enter a stream URL to start playing.
          </div>
        </div>
      </div>
    </div>
  </dialog>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { useSettings } from '../composables/useSettings';
import { useTheme } from '../composables/useTheme';
import { generatePalette, type SimpleThemeSeed } from '../utils/themeGenerator';
import type { ThemePalette } from '../utils/themes';

const props = defineProps<{ open: boolean }>();
defineEmits<{ (event: 'close'): void }>();

const dialogRef = ref<HTMLDialogElement | null>(null);
const showAdvanced = ref(false);

const {
  enterToSend,
  fullScreenFloating,
  requireGitDirectory,
  rememberModelPerAgent,
  peonPingEnabled,
  peonPingUrl,
} = useSettings();
const { themeId, customSeeds, setTheme, setCustomSeeds, updateCustomSeed, themes, CUSTOM_ID } =
  useTheme();
const themeActionMessage = ref('');
const themeActionError = ref(false);
const THEME_SHARE_VERSION = 1;

const selectedTheme = computed<string>({
  get: () => themeId.value,
  set: (value) => setTheme(value),
});

function updateSeed<K extends keyof SimpleThemeSeed>(key: K, value: SimpleThemeSeed[K]) {
  updateCustomSeed(key, value);
}

// Derived palette from current seeds (for previewing advanced token values)
const resolvedPalette = computed<ThemePalette>(() => generatePalette(customSeeds.value));

// Advanced keys — all palette tokens except the ones covered by seeds
const advancedKeys: (keyof ThemePalette)[] = [
  'bg-base',
  'bg-elevated',
  'bg-surface',
  'bg-overlay',
  'bg-hover',
  'bg-selected',
  'text-primary',
  'text-secondary',
  'text-muted',
  'text-subtle',
  'text-inverse',
  'border',
  'border-subtle',
  'border-strong',
  'accent',
  'accent-strong',
  'accent-soft',
  'success',
  'warning',
  'danger',
  'danger-strong',
  'info',
  'special',
  'success-text',
  'info-text',
];

// Tokens that can use a color picker (hex values, not rgba/color-mix)
const hexTokens = new Set<keyof ThemePalette>([
  'bg-base',
  'bg-elevated',
  'bg-surface',
  'bg-hover',
  'text-primary',
  'text-secondary',
  'text-muted',
  'text-subtle',
  'text-inverse',
  'border',
  'border-strong',
  'accent',
  'accent-strong',
  'success',
  'warning',
  'danger',
  'danger-strong',
  'info',
  'special',
  'success-text',
  'info-text',
]);

function isColorToken(key: keyof ThemePalette): boolean {
  return hexTokens.has(key);
}

function formatKey(key: string): string {
  return key.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function setOverride(key: keyof ThemePalette, value: string | undefined) {
  const currentOverrides = customSeeds.value.overrides;
  const overrides = currentOverrides ? { ...currentOverrides } : {};
  if (value === undefined || value === '') {
    delete overrides[key];
  } else {
    (overrides as Record<string, string>)[key] = value;
  }
  updateCustomSeed('overrides', Object.keys(overrides).length ? overrides : undefined);
}

function setThemeActionMessage(message: string, isError = false) {
  themeActionMessage.value = message;
  themeActionError.value = isError;
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeImportedSeed(value: unknown): SimpleThemeSeed | null {
  const source = isRecord(value) && isRecord(value.seed) ? value.seed : value;
  if (!isRecord(source)) return null;

  const mode = source.mode;
  if (mode !== 'dark' && mode !== 'light') return null;

  if (
    !isHexColor(source.background) ||
    !isHexColor(source.text) ||
    !isHexColor(source.accent) ||
    !isHexColor(source.border)
  ) {
    return null;
  }

  let overrides: Partial<ThemePalette> | undefined;
  if (isRecord(source.overrides)) {
    overrides = {};
    for (const [key, overrideValue] of Object.entries(source.overrides)) {
      if (typeof overrideValue === 'string' && overrideValue.trim()) {
        (overrides as Record<string, string>)[key] = overrideValue;
      }
    }
    if (!Object.keys(overrides).length) {
      overrides = undefined;
    }
  }

  return {
    mode,
    background: source.background,
    text: source.text,
    accent: source.accent,
    border: source.border,
    overrides,
  };
}

function hueToRgb(p: number, q: number, t: number) {
  let n = t;
  if (n < 0) n += 1;
  if (n > 1) n -= 1;
  if (n < 1 / 6) return p + (q - p) * 6 * n;
  if (n < 1 / 2) return q;
  if (n < 2 / 3) return p + (q - p) * (2 / 3 - n) * 6;
  return p;
}

function hslToHex(h: number, s: number, l: number) {
  const hn = h / 360;
  const sn = s / 100;
  const ln = l / 100;
  let r = ln;
  let g = ln;
  let b = ln;

  if (sn !== 0) {
    const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
    const p = 2 * ln - q;
    r = hueToRgb(p, q, hn + 1 / 3);
    g = hueToRgb(p, q, hn);
    b = hueToRgb(p, q, hn - 1 / 3);
  }

  return `#${[r, g, b]
    .map((channel) =>
      Math.round(channel * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateRandomSeed(): SimpleThemeSeed {
  const mode: SimpleThemeSeed['mode'] = Math.random() < 0.5 ? 'dark' : 'light';
  const backgroundHue = randomInt(0, 359);
  const accentHue = (backgroundHue + randomInt(40, 160)) % 360;
  return {
    mode,
    background: hslToHex(
      backgroundHue,
      randomInt(14, 26),
      mode === 'dark' ? randomInt(8, 16) : randomInt(90, 97),
    ),
    text: hslToHex(
      backgroundHue,
      randomInt(12, 18),
      mode === 'dark' ? randomInt(88, 96) : randomInt(10, 18),
    ),
    accent: hslToHex(
      accentHue,
      randomInt(58, 80),
      mode === 'dark' ? randomInt(60, 72) : randomInt(40, 52),
    ),
    border: hslToHex(
      backgroundHue,
      randomInt(10, 22),
      mode === 'dark' ? randomInt(26, 38) : randomInt(68, 80),
    ),
  };
}

async function handleShareTheme() {
  const payload = JSON.stringify({
    version: THEME_SHARE_VERSION,
    seed: customSeeds.value,
  });
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      throw new Error('clipboard unavailable');
    }
    await navigator.clipboard.writeText(payload);
    setThemeActionMessage('Theme copied to clipboard.');
  } catch {
    window.prompt('Copy custom theme JSON', payload);
    setThemeActionMessage('Clipboard unavailable, copied output shown in prompt.');
  }
}

function handleImportTheme() {
  const input = window.prompt('Paste a shared custom theme JSON');
  if (input === null) return;
  if (!input.trim()) {
    setThemeActionMessage('No theme data provided.', true);
    return;
  }
  try {
    const parsed = JSON.parse(input);
    const normalized = normalizeImportedSeed(parsed);
    if (!normalized) {
      throw new Error('invalid theme');
    }
    setCustomSeeds(normalized);
    setThemeActionMessage('Custom theme imported.');
  } catch {
    setThemeActionMessage('Invalid theme JSON format.', true);
  }
}

function handleSurpriseTheme() {
  setCustomSeeds(generateRandomSeed());
  setThemeActionMessage('Applied a random custom theme.');
}

watch(
  () => props.open,
  (open) => {
    const el = dialogRef.value;
    if (!el) return;
    if (open) {
      if (!el.open) el.showModal();
    } else if (el.open) {
      el.close();
    }
  },
);
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
  width: min(520px, 95vw);
  max-height: 90vh;
  overflow-y: auto;
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
  color: var(--theme-text-primary);
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
  gap: 12px;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 12px;
  border: 1px solid var(--theme-border-subtle);
  border-radius: 8px;
  background: color-mix(in srgb, var(--theme-bg-base) 45%, transparent);
}

.setting-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.setting-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--theme-text-secondary);
}

.setting-description {
  font-size: 11px;
  color: var(--theme-text-subtle);
}

/* ── Custom theme editor ── */

.custom-theme-editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid var(--theme-accent-soft);
  border-radius: 10px;
  padding: 12px;
  background: color-mix(in srgb, var(--theme-accent) 5%, var(--theme-bg-base));
}

.theme-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.theme-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--theme-border);
  border-radius: 6px;
  background: var(--theme-bg-base);
  color: var(--theme-text-secondary);
  padding: 4px 8px;
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
}

.theme-action-btn:hover {
  background: var(--theme-bg-hover);
}

.theme-action-message {
  font-size: 11px;
  color: var(--theme-info);
}

.theme-action-message--error {
  color: var(--theme-danger);
}

.seed-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.seed-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid var(--theme-border-subtle);
  border-radius: 6px;
  background: color-mix(in srgb, var(--theme-bg-base) 60%, transparent);
  cursor: pointer;
}

.seed-row--full {
  grid-column: 1 / -1;
}

.seed-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--theme-text-muted);
  white-space: nowrap;
}

.seed-input-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.color-picker {
  width: 22px;
  height: 22px;
  border: 1px solid var(--theme-border);
  border-radius: 4px;
  padding: 1px;
  background: transparent;
  cursor: pointer;
  flex-shrink: 0;
}

.color-picker::-webkit-color-swatch-wrapper {
  padding: 0;
}
.color-picker::-webkit-color-swatch {
  border: none;
  border-radius: 2px;
}

.seed-hex {
  font-size: 10px;
  color: var(--theme-text-subtle);
  font-family: inherit;
  min-width: 52px;
}

input.seed-hex {
  background: transparent;
  border: none;
  outline: none;
  color: var(--theme-text-subtle);
  width: 80px;
  padding: 0;
}

input.seed-hex::placeholder {
  color: var(--theme-text-subtle);
  opacity: 0.5;
}

.mode-toggle {
  display: flex;
  gap: 4px;
}

.mode-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--theme-border);
  border-radius: 5px;
  background: transparent;
  color: var(--theme-text-muted);
  font-size: 11px;
  padding: 3px 8px;
  cursor: pointer;
  font-family: inherit;
  transition:
    background 0.15s,
    color 0.15s,
    border-color 0.15s;
}

.mode-btn.active {
  background: var(--theme-accent-soft);
  border-color: var(--theme-accent);
  color: var(--theme-text-primary);
}

.advanced-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: none;
  color: var(--theme-text-subtle);
  font-size: 11px;
  cursor: pointer;
  padding: 0;
  font-family: inherit;
}

.advanced-toggle:hover {
  color: var(--theme-text-muted);
}

.advanced-grid {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-top: 1px solid var(--theme-border-subtle);
  padding-top: 8px;
}

/* ── Toggle switch ── */

.toggle-switch {
  position: relative;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  cursor: pointer;
}

.toggle-input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-track {
  width: 36px;
  height: 20px;
  background: var(--theme-border);
  border-radius: 10px;
  position: relative;
  transition: background 0.2s;
}

.toggle-track::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background: var(--theme-text-muted);
  border-radius: 50%;
  transition:
    transform 0.2s,
    background 0.2s;
}

.toggle-input:checked + .toggle-track {
  background: var(--theme-accent-strong);
}
.toggle-input:checked + .toggle-track::after {
  transform: translateX(16px);
  background: var(--theme-text-inverse);
}

.setting-row--column {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}

.setting-url-input {
  width: 100%;
  padding: 6px 10px;
  background: var(--theme-bg-base);
  border: 1px solid var(--theme-border);
  border-radius: 6px;
  color: var(--theme-text-secondary);
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
  outline: none;
  box-sizing: border-box;
}

.setting-url-input::placeholder {
  color: var(--theme-text-subtle);
}
.setting-url-input:focus {
  border-color: var(--theme-accent-strong);
}

.setting-select {
  width: 100%;
  padding: 6px 10px;
  background: var(--theme-bg-base);
  border: 1px solid var(--theme-border);
  border-radius: 6px;
  color: var(--theme-text-secondary);
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
  outline: none;
  box-sizing: border-box;
  cursor: pointer;
}

.setting-select:focus {
  border-color: var(--theme-accent-strong);
}

.setting-hint {
  font-size: 11px;
  color: var(--theme-warning);
}
</style>
