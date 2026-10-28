import { OpenCodeApiError } from './opencode';

/** User-facing message for a failed OpenCode API call. */
export function describeLoadError(error: unknown): string {
  if (error instanceof OpenCodeApiError) {
    if (error.status === 401 || error.status === 403) {
      return `Not authorized (${error.status}). Check your OpenCode credentials.`;
    }
    return error.detail
      ? `Server returned ${error.status}: ${error.detail}`
      : `Server returned ${error.status}.`;
  }
  if (error instanceof TypeError) {
    return 'Could not reach the OpenCode server. Is it still running?';
  }
  return error instanceof Error ? error.message : String(error);
}
