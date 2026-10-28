import type { ClaudeMessagesResponse } from '#shared/types/events';
import { rawSessionId } from '#shared/utils/claude-ids';
import { findSessionMeta, readAllEntries } from '../../../../utils/claude/storage';
import { translateStoredEntries } from '../../../../utils/claude/translator';

/** Replay a session's JSONL history as OpenCode-shaped messages and parts. */
export default defineEventHandler(async (event): Promise<ClaudeMessagesResponse> => {
  const id = rawSessionId(getRouterParam(event, 'id') ?? '');
  const meta = await findSessionMeta(id);
  if (!meta || !meta.transcriptPath) return { messages: [], parts: [] };

  const entries = await readAllEntries(meta.transcriptPath);
  const messages: unknown[] = [];
  const parts: unknown[] = [];
  for (const envelope of translateStoredEntries(entries, id, meta.directory)) {
    const { type, properties } = envelope.payload;
    if (type === 'message.updated') messages.push(properties.info);
    else if (type === 'message.part.updated') parts.push(properties.part);
  }
  return { messages, parts };
});
