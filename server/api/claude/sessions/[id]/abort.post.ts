import { rawSessionId } from '#shared/utils/claude-ids';
import { abortSession } from '../../../../utils/claude/sessions';

export default defineEventHandler((event) => {
  abortSession(rawSessionId(getRouterParam(event, 'id') ?? ''));
  return { ok: true };
});
