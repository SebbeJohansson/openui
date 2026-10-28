import { describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import { waitForState } from './waitForState';

describe('waitForState', () => {
  it('resolves synchronously when the predicate already holds', async () => {
    const source = ref(5);
    await expect(
      waitForState(
        () => source.value,
        (v) => v === 5,
      ),
    ).resolves.toBe(5);
  });

  it('resolves once the watched value satisfies the predicate', async () => {
    const source = ref(0);
    const promise = waitForState(
      () => source.value,
      (v) => v > 2,
    );
    source.value = 1;
    await nextTick();
    source.value = 3;
    await expect(promise).resolves.toBe(3);
  });

  it('watches deeply, so a nested mutation counts', async () => {
    const source = ref<{ items: string[] }>({ items: [] });
    const promise = waitForState(
      () => source.value,
      (v) => v.items.includes('ready'),
    );
    source.value.items.push('ready');
    await expect(promise).resolves.toEqual({ items: ['ready'] });
  });

  it('rejects after the timeout and stops watching', async () => {
    vi.useFakeTimers();
    try {
      const source = ref(0);
      const promise = waitForState(
        () => source.value,
        (v) => v > 10,
        100,
      );
      const assertion = expect(promise).rejects.toThrow('Timed out waiting for state update.');
      await vi.advanceTimersByTimeAsync(100);
      await assertion;
      // The watcher is gone: a late match must not resolve or throw.
      source.value = 99;
      await nextTick();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears its timer on success so a pending timeout cannot fire', async () => {
    vi.useFakeTimers();
    try {
      const source = ref(0);
      const promise = waitForState(
        () => source.value,
        (v) => v === 1,
        100,
      );
      source.value = 1;
      await expect(promise).resolves.toBe(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('can be used inside an effect scope', async () => {
    const scope = effectScope();
    const source = ref(0);
    const promise = scope.run(() =>
      waitForState(
        () => source.value,
        (v) => v === 2,
      ),
    )!;
    source.value = 2;
    await expect(promise).resolves.toBe(2);
    scope.stop();
  });
});
