import { listClaudeSessions } from '../../../utils/claude/storage';
import { sessionMetaToInfo } from '../../../utils/claude/translator';

/** GET /api/claude/sessions[?directory=] */
export default defineEventHandler(async (event) => {
  const { directory } = getQuery(event);
  const sessions = await listClaudeSessions(typeof directory === 'string' ? directory : undefined);
  return sessions.map(sessionMetaToInfo);
});
