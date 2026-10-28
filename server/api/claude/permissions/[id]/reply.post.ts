import { rawPermissionId } from '#shared/utils/claude-ids';
import { getAllClaudeSessions, replyPermission } from '../../../../utils/claude/sessions';

/** POST /api/claude/permissions/:id/reply { reply: 'accept' | 'reject' } */
export default defineEventHandler(async (event) => {
  const requestId = rawPermissionId(getRouterParam(event, 'id') ?? '');
  const body = (await readBody<{ reply?: unknown }>(event).catch(() => null)) ?? {};
  const behavior = body.reply === 'reject' ? 'deny' : 'allow';

  const owner = getAllClaudeSessions().find((s) => s.pendingPermissions.has(requestId));
  if (!owner) throw createError({ statusCode: 404, statusMessage: 'Permission request not found' });

  replyPermission(owner, requestId, behavior);
  return { ok: true };
});
