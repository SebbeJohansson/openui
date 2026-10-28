import { ref, watch, effectScope } from 'vue';
import { StorageKeys, storageGetJSON, storageKey, storageSetJSON } from '../utils/storageKeys';

const hiddenModels = ref<string[]>(
  storageGetJSON<string[]>(StorageKeys.settings.hiddenModels) ?? [],
);

const scope = effectScope(true);
scope.run(() => {
  watch(
    hiddenModels,
    (value) => {
      storageSetJSON(StorageKeys.settings.hiddenModels, value);
    },
    { deep: true },
  );
});

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === storageKey(StorageKeys.settings.hiddenModels)) {
      try {
        hiddenModels.value = event.newValue ? JSON.parse(event.newValue) : [];
      } catch {
        hiddenModels.value = [];
      }
    }
  });
}

export function useHiddenModels() {
  function isHidden(id: string): boolean {
    return hiddenModels.value.includes(id);
  }

  function toggleHidden(id: string): void {
    const idx = hiddenModels.value.indexOf(id);
    if (idx === -1) {
      hiddenModels.value = [...hiddenModels.value, id];
    } else {
      hiddenModels.value = hiddenModels.value.filter((v) => v !== id);
    }
  }

  return { hiddenModels, isHidden, toggleHidden };
}
