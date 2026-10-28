/** Emoji indicator used in session lists for a session's live status. */
export function sessionStatusIcon(status: string | undefined): string {
  if (status === 'busy') return '\u{1F914}';
  if (status === 'retry') return '\u{1F534}';
  if (status === 'idle') return '\u{1F7E2}';
  return '\u26AA';
}

/** True when every whitespace-separated term of `query` appears in at least one field. */
export function matchesQuery(query: string, ...fields: (string | undefined)[]): boolean {
  const terms = query.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return false;
  return terms.every((term) => fields.some((field) => field?.toLowerCase().includes(term)));
}
