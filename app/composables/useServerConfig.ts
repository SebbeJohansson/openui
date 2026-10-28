import { computed, ref } from 'vue';
import { useRuntimeConfig } from '#imports';
import type { ServerConfigResponse } from '#shared/types/api';
import { defineFeature } from './useAppContext';

/**
 * Runtime configuration served by the Nitro server at /api/config. Absent on
 * static hosting, in which case the manual login form is shown.
 */
export const useServerConfig = defineFeature('serverConfig', ({ credentials }) => {
  const runtimeConfig = useRuntimeConfig();
  const serverConfig = ref<ServerConfigResponse | null>(null);

  const claudeEnabled = computed(() => Boolean(serverConfig.value?.claudeEnabled));
  const claudeApiBase = computed(() => serverConfig.value?.claudeApiBase ?? '');

  /** Absolute-path URL for a Claude route; throws when the server has Claude disabled. */
  function claudeApiUrl(path: string): string {
    const base = claudeApiBase.value;
    if (!base) throw new Error('Claude Code support is not enabled on this server.');
    return `${base}${path}`;
  }

  /**
   * Probe /api/config. Resolves true when the server supplied an OpenCode URL
   * (credentials are saved), false when running statically or on any failure.
   */
  async function load(): Promise<boolean> {
    try {
      const base = runtimeConfig.app.baseURL.replace(/\/+$/, '');
      const res = await fetch(`${base}/api/config`, { signal: AbortSignal.timeout(2000) });
      // Static hosts either 404 or serve the SPA shell with a 200; only JSON means a server.
      if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) return false;
      const cfg = (await res.json()) as Partial<ServerConfigResponse>;
      serverConfig.value = {
        openCodeUrl: cfg.openCodeUrl ?? null,
        claudeEnabled: cfg.claudeEnabled ?? false,
        claudeApiBase: cfg.claudeApiBase ?? null,
      };
      if (cfg.openCodeUrl) credentials.save(cfg.openCodeUrl, '', '');
      return Boolean(cfg.openCodeUrl);
    } catch {
      return false;
    }
  }

  return { serverConfig, claudeEnabled, claudeApiBase, claudeApiUrl, load };
});
