/**
 * Fan-out of translated Claude events to every open SSE stream.
 */
import type { SseEnvelope } from '#shared/types/events';
import { ccSessionId } from '#shared/utils/claude-ids';
import { getClaudeSession, sessionEvents } from './sessions';
import { translateEvent } from './translator';
import type { ClaudeStreamEvent } from './types';

type Subscriber = (envelope: SseEnvelope) => void;

const subscribers = new Set<Subscriber>();
let wired = false;

export function subscribeClaudeEvents(subscriber: Subscriber): () => void {
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
}

export function broadcastClaude(envelope: SseEnvelope): void {
  for (const subscriber of subscribers) {
    try {
      subscriber(envelope);
    } catch {
      subscribers.delete(subscriber);
    }
  }
}

/** Connect the subprocess event emitter to the SSE subscribers. Idempotent. */
export function wireClaudeBroadcast(): void {
  if (wired) return;
  wired = true;

  sessionEvents.on('event', (sessionId: string, event: ClaudeStreamEvent) => {
    const session = getClaudeSession(sessionId);
    if (!session) return;
    for (const envelope of translateEvent(event, sessionId, session.directory)) {
      broadcastClaude(envelope);
    }
  });

  sessionEvents.on('status', (sessionId: string, status: string) => {
    const session = getClaudeSession(sessionId);
    if (!session) return;
    broadcastClaude({
      directory: session.directory,
      payload: {
        type: 'session.status',
        properties: { sessionID: ccSessionId(sessionId), status: { type: status } },
      },
    });
  });
}
