import type { SseEnvelope } from '#shared/types/events';
import { subscribeClaudeEvents } from '../../utils/claude/broadcast';

const HEARTBEAT_MS = 15_000;

/**
 * SSE stream of translated Claude events, same envelope shape as OpenCode's
 * /global/event so the client can reuse its parser.
 */
export default defineEventHandler((event) => {
  const stream = createEventStream(event);
  const push = (envelope: SseEnvelope) => {
    void stream.push(JSON.stringify(envelope)).catch(() => {});
  };

  const unsubscribe = subscribeClaudeEvents(push);
  push({ directory: '', payload: { type: 'server.connected', properties: {} } });
  const heartbeat = setInterval(() => {
    push({ directory: '', payload: { type: 'server.heartbeat', properties: {} } });
  }, HEARTBEAT_MS);

  stream.onClosed(async () => {
    clearInterval(heartbeat);
    unsubscribe();
    await stream.close();
  });

  return stream.send();
});
