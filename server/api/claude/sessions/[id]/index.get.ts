import { rawSessionId } from '#shared/utils/claude-ids';
import { findSessionMeta } from '../../../../utils/claude/storage';
import { sessionMetaToInfo } from '../../../../utils/claude/translator';

export default defineEventHandler(async (event) => {
  const id = rawSessionId(getRouterParam(event, 'id') ?? '');
  const meta = await findSessionMeta(id);
  if (!meta) throw createError({ statusCode: 404, statusMessage: 'Session not found' });
  return sessionMetaToInfo(meta);
});
