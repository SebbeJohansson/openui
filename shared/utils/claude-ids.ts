/**
 * ID prefixes that keep Claude Code entities from colliding with OpenCode ids.
 * The client branches on these to route requests to the Claude API.
 */
export const CC_SESSION_PREFIX = 'cc_';
export const CC_PROJECT_PREFIX = 'ccp_';
export const CC_MSG_PREFIX = 'ccm_';
export const CC_PART_PREFIX = 'ccpt_';
export const CC_PERM_PREFIX = 'ccperm_';

export function ccSessionId(id: string): string {
  return id.startsWith(CC_SESSION_PREFIX) ? id : CC_SESSION_PREFIX + id;
}

export function rawSessionId(id: string): string {
  return id.startsWith(CC_SESSION_PREFIX) ? id.slice(CC_SESSION_PREFIX.length) : id;
}

export function ccProjectId(encodedDir: string): string {
  return CC_PROJECT_PREFIX + encodedDir;
}

export function rawPermissionId(id: string): string {
  return id.startsWith(CC_PERM_PREFIX) ? id.slice(CC_PERM_PREFIX.length) : id;
}

export function isClaudeSessionId(id: string | undefined | null): boolean {
  return typeof id === 'string' && id.startsWith(CC_SESSION_PREFIX);
}

export function isClaudeProjectId(id: string | undefined | null): boolean {
  return typeof id === 'string' && id.startsWith(CC_PROJECT_PREFIX);
}
