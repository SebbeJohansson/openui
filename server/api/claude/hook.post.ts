import { installClaudeHook } from 'agent-conduit/node';

/**
 * POST /api/claude/hook: install or update agent-conduit's Claude Code hook in
 * ~/.claude, the same as `yarn claude-hook:install`.
 *
 * It edits ~/.claude/settings.json, so it asks for a header a page on another
 * origin cannot send without a CORS preflight, which this server never answers.
 */
export default defineEventHandler(async (event) => {
  if (getHeader(event, 'x-openui-install') !== '1') {
    throw createError({ statusCode: 403, statusMessage: 'missing x-openui-install' });
  }
  try {
    const { installed, current } = await installClaudeHook();
    return { installed, current };
  } catch (cause) {
    throw createError({
      statusCode: 500,
      statusMessage: String((cause as Error).message ?? cause),
    });
  }
});
