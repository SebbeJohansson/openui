import { killAllClaudeSessions } from '../utils/claude/sessions';
import { wireClaudeBroadcast } from '../utils/claude/broadcast';

/** Wire Claude event fan-out and make sure no subprocess outlives the server. */
export default defineNitroPlugin((nitroApp) => {
  if (!useRuntimeConfig().claudeEnabled) return;
  wireClaudeBroadcast();
  const shutdown = () => killAllClaudeSessions('SIGTERM');
  nitroApp.hooks.hookOnce('close', shutdown);
  process.once('exit', shutdown);
});
