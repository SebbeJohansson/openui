import { ref, watch, effectScope } from 'vue';
import {
  StorageKeys,
  storageGet,
  storageKey,
  storageSet,
  storageGetJSON,
  storageSetJSON,
} from '../utils/storageKeys';
import {
  DEFAULT_THEME_ID,
  THEMES,
  getTheme,
  listThemes,
  type ThemeDefinition,
} from '../utils/themes';
import { DEFAULT_SEED, generatePalette, type SimpleThemeSeed } from '../utils/themeGenerator';

const CUSTOM_ID = 'custom';

// ─── Load initial values ─────────────────────────────────────────────────────

const initialId = (() => {
  const stored = storageGet(StorageKeys.settings.theme);
  if (stored === CUSTOM_ID) return CUSTOM_ID;
  if (stored && THEMES[stored]) return stored;
  return DEFAULT_THEME_ID;
})();

const initialSeeds = (): SimpleThemeSeed => {
  const stored = storageGetJSON<SimpleThemeSeed>(StorageKeys.settings.customThemeSeeds);
  if (stored && stored.background && stored.text && stored.accent && stored.border) return stored;
  return { ...DEFAULT_SEED };
};

// ─── Reactive state ───────────────────────────────────────────────────────────

const themeId = ref<string>(initialId);
const customSeeds = ref<SimpleThemeSeed>(initialSeeds());

// ─── Apply helpers ────────────────────────────────────────────────────────────

function applyTheme(theme: ThemeDefinition) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme.palette)) {
    root.style.setProperty(`--theme-${key}`, value);
  }
  root.setAttribute('data-theme', theme.id);
  root.style.colorScheme = theme.mode;
}

function applySeeds(seeds: SimpleThemeSeed) {
  if (typeof document === 'undefined') return;
  const palette = generatePalette(seeds);
  const root = document.documentElement;
  for (const [key, value] of Object.entries(palette)) {
    root.style.setProperty(`--theme-${key}`, value);
  }
  root.setAttribute('data-theme', CUSTOM_ID);
  root.style.colorScheme = seeds.mode;
}

function applyCurrentTheme() {
  if (themeId.value === CUSTOM_ID) {
    applySeeds(customSeeds.value);
  } else {
    applyTheme(getTheme(themeId.value));
  }
}

// Apply immediately on module load to avoid FOUC
applyCurrentTheme();

// ─── Watchers ─────────────────────────────────────────────────────────────────

const scope = effectScope(true);
scope.run(() => {
  watch(themeId, (value) => {
    storageSet(StorageKeys.settings.theme, value);
    applyCurrentTheme();
  });

  watch(
    customSeeds,
    () => {
      storageSetJSON(StorageKeys.settings.customThemeSeeds, customSeeds.value);
      if (themeId.value === CUSTOM_ID) {
        applySeeds(customSeeds.value);
      }
    },
    { deep: true },
  );
});

// Cross-tab sync
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === storageKey(StorageKeys.settings.theme)) {
      const next = event.newValue;
      if (next && (THEMES[next] || next === CUSTOM_ID)) themeId.value = next;
    }
    if (event.key === storageKey(StorageKeys.settings.customThemeSeeds)) {
      try {
        const parsed = JSON.parse(event.newValue ?? '');
        if (parsed) customSeeds.value = parsed;
      } catch {
        /* ignore */
      }
    }
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function useTheme() {
  function setTheme(id: string) {
    if (!THEMES[id] && id !== CUSTOM_ID) return;
    themeId.value = id;
  }

  function setCustomSeeds(seeds: SimpleThemeSeed) {
    customSeeds.value = { ...seeds };
    if (themeId.value !== CUSTOM_ID) {
      themeId.value = CUSTOM_ID;
    }
  }

  function updateCustomSeed<K extends keyof SimpleThemeSeed>(key: K, value: SimpleThemeSeed[K]) {
    customSeeds.value = { ...customSeeds.value, [key]: value };
    if (themeId.value !== CUSTOM_ID) {
      themeId.value = CUSTOM_ID;
    }
  }

  return {
    themeId,
    customSeeds,
    setTheme,
    setCustomSeeds,
    updateCustomSeed,
    themes: listThemes(),
    getTheme,
    CUSTOM_ID,
  };
}
