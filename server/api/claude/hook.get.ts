import { readClaudeHookStatus } from 'agent-conduit/node';

/**
 * GET /api/claude/hook: whether agent-conduit's Claude Code hook is installed.
 * The hook marks a session while it waits on a permission prompt, which apps
 * reading sessions through agent-conduit (my-widget) show as needing approval.
 */
export default defineEventHandler(async () => {
  const { installed, current } = await readClaudeHookStatus();
  return { installed, current };
});
