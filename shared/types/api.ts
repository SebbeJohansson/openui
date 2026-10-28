/** Response of GET /api/config. Absent (404) on static hosting. */
export type ServerConfigResponse = {
  /** OpenCode server the UI should connect to; null means show the manual login form. */
  openCodeUrl: string | null;
  /** True when the experimental Claude Code routes are enabled on this server. */
  claudeEnabled: boolean;
  /** Same-origin base path of the Claude routes (e.g. `/api/claude`), or null when disabled. */
  claudeApiBase: string | null;
};
