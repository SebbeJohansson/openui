import { rawSessionId } from '#shared/utils/claude-ids';
import { ensureRunning, getClaudeSession, sendPrompt } from '../../../../utils/claude/sessions';
import { findSessionMeta, removePendingSession } from '../../../../utils/claude/storage';

/** POST /api/claude/sessions/:id/prompt { text } */
export default defineEventHandler(async (event) => {
  const id = rawSessionId(getRouterParam(event, 'id') ?? '');
  const body = (await readBody<Record<string, unknown>>(event).catch(() => null)) ?? {};
  const text = String(body.text ?? body.content ?? body.prompt ?? '');
  if (!text.trim())
    throw createError({ statusCode: 400, statusMessage: 'Prompt text is required' });

  const meta = await findSessionMeta(id);
  const directory = meta?.directory ?? getClaudeSession(id)?.directory ?? process.cwd();
  const isResume = meta != null && Boolean(meta.transcriptPath);

  const session = await ensureRunning(id, directory, isResume);
  try {
    sendPrompt(session, text);
  } catch (error) {
    throw createError({ statusCode: 409, statusMessage: (error as Error).message });
  }
  // Claude writes the session to disk from here on.
  void removePendingSession(id);
  return { ok: true };
});
