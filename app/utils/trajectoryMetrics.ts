/** How the trajectory timeline maps events onto its horizontal axis. */
export type TrajectoryMetric = 'duration' | 'turns' | 'calls';

export const TRAJECTORY_METRICS: Array<{
  id: TrajectoryMetric;
  label: string;
  icon: string;
  hint: string;
}> = [
  {
    id: 'duration',
    label: 'Duration',
    icon: 'lucide:clock',
    hint: 'Axis is wall-clock time; block width is how long the record took',
  },
  { id: 'turns', label: 'Turns', icon: 'lucide:rows-3', hint: 'Axis is one slot per user turn' },
  { id: 'calls', label: 'Calls', icon: 'lucide:list', hint: 'Axis is one slot per record' },
];

export function formatDuration(ms?: number): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function formatTimestamp(value?: number): string {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.` +
    `${pad(date.getMilliseconds(), 3)}`
  );
}

export function toJson(value: unknown): string {
  if (value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const JSON_TOKEN =
  /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

/**
 * Colourises pretty-printed JSON. Input is escaped first, so the produced HTML
 * only ever contains the spans added here.
 */
export function highlightJson(json: string): string {
  return escapeHtml(json).replace(JSON_TOKEN, (match, str, colon, literal) => {
    if (str) {
      if (colon) return `<span class="tj-json-key">${str}</span>${colon}`;
      return `<span class="tj-json-string">${str}</span>`;
    }
    if (literal) return `<span class="tj-json-literal">${match}</span>`;
    return `<span class="tj-json-number">${match}</span>`;
  });
}

type SchemaNode = { type: string; items?: SchemaNode; properties?: Record<string, SchemaNode> };

/**
 * The server does not expose tool definitions to the client, so the "schema"
 * shown for a call is inferred from the shape of that call's own input.
 */
export function inferSchema(value: unknown): SchemaNode {
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) {
    return { type: 'array', items: value.length > 0 ? inferSchema(value[0]) : { type: 'unknown' } };
  }
  const kind = typeof value;
  if (kind !== 'object') return { type: kind };
  const properties: Record<string, SchemaNode> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    properties[key] = inferSchema(entry);
  }
  return { type: 'object', properties };
}
