import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  StorageKeys,
  storageGet,
  storageGetJSON,
  storageKey,
  storageRemove,
  storageSet,
  storageSetJSON,
} from './storageKeys';

const PREFIX = 'opencode.';

/** Minimal localStorage stand-in; this file runs in the node environment. */
function installStorage(overrides: Partial<Storage> = {}) {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    ...overrides,
  };
  vi.stubGlobal('window', { localStorage: storage });
  return store;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('storageKey', () => {
  it('namespaces every key under the app prefix', () => {
    expect(storageKey('settings.theme.v1')).toBe(`${PREFIX}settings.theme.v1`);
  });

  it('gives every declared key a unique, versioned name', () => {
    const keys = Object.values(StorageKeys).flatMap((group) => Object.values(group));
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key).toMatch(/^[a-z]+\.[A-Za-z]+\.v\d+$/);
    }
  });
});

describe('get / set / remove', () => {
  it('round-trips a value under the prefixed key', () => {
    const store = installStorage();

    storageSet(StorageKeys.state.mainTab, 'thread');

    expect(store.get(`${PREFIX}${StorageKeys.state.mainTab}`)).toBe('thread');
    expect(storageGet(StorageKeys.state.mainTab)).toBe('thread');

    storageRemove(StorageKeys.state.mainTab);
    expect(storageGet(StorageKeys.state.mainTab)).toBeNull();
  });

  it('returns null with no window (the SharedWorker and SSR-less prerender)', () => {
    expect(storageGet(StorageKeys.state.mainTab)).toBeNull();
    expect(() => storageSet(StorageKeys.state.mainTab, 'x')).not.toThrow();
    expect(() => storageRemove(StorageKeys.state.mainTab)).not.toThrow();
  });

  it('swallows a storage that throws, as private mode does', () => {
    installStorage({
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    });

    expect(storageGet(StorageKeys.state.mainTab)).toBeNull();
    expect(() => storageSet(StorageKeys.state.mainTab, 'x')).not.toThrow();
    expect(() => storageRemove(StorageKeys.state.mainTab)).not.toThrow();
  });
});

describe('JSON helpers', () => {
  it('round-trips structured values', () => {
    installStorage();

    storageSetJSON(StorageKeys.settings.hiddenModels, ['a/b', 'c/d']);

    expect(storageGetJSON<string[]>(StorageKeys.settings.hiddenModels)).toEqual(['a/b', 'c/d']);
  });

  it('returns null for a missing or unparseable value', () => {
    installStorage();

    expect(storageGetJSON(StorageKeys.settings.hiddenModels)).toBeNull();
    storageSet(StorageKeys.settings.hiddenModels, 'not json');
    expect(storageGetJSON(StorageKeys.settings.hiddenModels)).toBeNull();
  });
});

describe('the anti-FOUC script in nuxt.config.ts', () => {
  // The theme is applied before first paint by an inline script that cannot
  // import from here, so it repeats the key names literally.
  const nuxtConfig = readFileSync(
    fileURLToPath(new URL('../../nuxt.config.ts', import.meta.url)),
    'utf8',
  );

  it('uses the same prefix', () => {
    expect(nuxtConfig).toContain(`var PREFIX='${PREFIX}'`);
  });

  it('uses the same theme keys', () => {
    expect(nuxtConfig).toContain(`THEME_KEY=PREFIX+'${StorageKeys.settings.theme}'`);
    expect(nuxtConfig).toContain(`SEEDS_KEY=PREFIX+'${StorageKeys.settings.customThemeSeeds}'`);
  });
});
