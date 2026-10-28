import { randomUUID } from 'node:crypto';
import type { ClaudeCreateSessionResponse } from '#shared/types/events';
import { ccProjectId, ccSessionId } from '#shared/utils/claude-ids';
import { createSessionRecord } from '../../../utils/claude/sessions';
import { addPendingSession, encodeProjectDir } from '../../../utils/claude/storage';

/** POST /api/claude/sessions { directory } */
export default defineEventHandler(async (event): Promise<ClaudeCreateSessionResponse> => {
  const body = (await readBody<{ directory?: unknown }>(event).catch(() => null)) ?? {};
  const directory =
    typeof body.directory === 'string' && body.directory.trim() ? body.directory : process.cwd();
  const sessionId = randomUUID();
  createSessionRecord(sessionId, directory);
  await addPendingSession(sessionId, directory, 'New Claude session');

  const now = Date.now();
  const session = {
    id: ccSessionId(sessionId),
    slug: sessionId.slice(0, 8),
    projectID: ccProjectId(encodeProjectDir(directory)),
    directory,
    title: 'New Claude session',
    version: '0',
    time: { created: now, updated: now },
  };
  return { sessionID: session.id, session };
});
