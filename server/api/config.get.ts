import type { ServerConfigResponse } from '#shared/types/api';

/**
 * Runtime configuration for the client. A static host has no such route, so a
 * 404 here is how the client detects "no server, show the login form".
 */
export default defineEventHandler((event): ServerConfigResponse => {
  const config = useRuntimeConfig(event);
  setResponseHeader(event, 'Cache-Control', 'no-store');
  const base = config.app.baseURL.replace(/\/+$/, '');
  return {
    openCodeUrl: config.opencodeUrl || null,
    claudeEnabled: config.claudeEnabled,
    claudeApiBase: config.claudeEnabled ? `${base}/api/claude` : null,
  };
});
