import type { PermissionRule } from '../types/sse';

/** Permission action as defined by the OpenCode server. */
export type PermissionAction = 'allow' | 'ask' | 'deny';

/** Where an effective permission came from, most specific last. */
export type PermissionSource = 'default' | 'global' | 'agent' | 'session';

export type EffectivePermission = {
  /** Permission key, e.g. `bash`, `edit`, `todowrite`. */
  permission: string;
  action: PermissionAction;
  source: PermissionSource;
  /** The pattern of the winning rule, `*` when it is a catch-all. */
  pattern: string;
  /** Every rule that contributed, in evaluation order. */
  rules: Array<{ rule: PermissionRule; source: PermissionSource }>;
};

/**
 * Permission keys the OpenCode server documents. Used to render a stable table
 * even when the server has no explicit rule for a given key.
 * @see https://opencode.ai/docs/permissions
 */
export const KNOWN_PERMISSIONS = [
  'read',
  'edit',
  'glob',
  'grep',
  'bash',
  'task',
  'skill',
  'lsp',
  'question',
  'webfetch',
  'websearch',
  'external_directory',
  'doom_loop',
] as const;

/**
 * Server defaults when nothing is configured.
 * Most permissions default to allow; these two default to ask.
 */
const DEFAULT_ACTIONS: Record<string, PermissionAction> = {
  doom_loop: 'ask',
  external_directory: 'ask',
};

function defaultActionFor(permission: string): PermissionAction {
  return DEFAULT_ACTIONS[permission] ?? 'allow';
}

/**
 * Translate an OpenCode permission pattern into a RegExp.
 * `*` matches zero or more characters, `?` matches exactly one, everything
 * else is literal.
 */
function patternToRegExp(pattern: string): RegExp {
  let source = '';
  for (const char of pattern) {
    if (char === '*') source += '.*';
    else if (char === '?') source += '.';
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

/** True when `value` matches an OpenCode wildcard `pattern`. */
export function matchesPattern(pattern: string, value: string): boolean {
  if (pattern === '*') return true;
  return patternToRegExp(pattern).test(value);
}

export type RulesetLayer = {
  source: PermissionSource;
  rules: PermissionRule[];
};

/**
 * Resolve the effective action for a permission key.
 *
 * Rules are evaluated in layer order (global -> agent -> session) and, within a
 * layer, in declaration order. The last matching rule wins, mirroring the
 * server's own resolution.
 */
export function resolvePermission(
  permission: string,
  layers: RulesetLayer[],
  target = '*',
): EffectivePermission {
  const contributing: EffectivePermission['rules'] = [];
  let action = defaultActionFor(permission);
  let source: PermissionSource = 'default';
  let pattern = '*';

  for (const layer of layers) {
    for (const rule of layer.rules) {
      if (rule.permission !== permission) continue;
      const rulePattern = rule.pattern || '*';
      // A `*` target means "what happens generally", so every rule counts.
      if (target !== '*' && !matchesPattern(rulePattern, target)) continue;
      contributing.push({ rule, source: layer.source });
      action = rule.action;
      source = layer.source;
      pattern = rulePattern;
    }
  }

  return { permission, action, source, pattern, rules: contributing };
}

/**
 * Build the full effective permission table for the known permission keys plus
 * any extra keys that appear in the supplied rulesets.
 */
export function resolvePermissionTable(layers: RulesetLayer[]): EffectivePermission[] {
  const keys = new Set<string>(KNOWN_PERMISSIONS);
  for (const layer of layers) {
    for (const rule of layer.rules) keys.add(rule.permission);
  }
  return [...keys]
    .sort((a, b) => a.localeCompare(b))
    .map((permission) => resolvePermission(permission, layers));
}

/**
 * Convert the deprecated `tools: Record<string, boolean>` map into rules so it
 * can participate in the same resolution pipeline.
 */
export function rulesFromToolsMap(tools?: Record<string, boolean>): PermissionRule[] {
  if (!tools) return [];
  return Object.entries(tools).map(([permission, enabled]) => ({
    permission,
    pattern: '*',
    action: enabled ? ('allow' as const) : ('deny' as const),
  }));
}

/**
 * Normalize the many shapes the server config can use for permissions into a
 * flat rule list.
 *
 * Accepts:
 * - `"allow"`                                  -> catch-all
 * - `{ bash: "ask" }`                          -> per-permission action
 * - `{ bash: { "*": "ask", "git *": "allow" }}` -> granular patterns
 * - `[{ permission, pattern, action }]`        -> already-normalized rules
 */
export function normalizePermissionConfig(value: unknown): PermissionRule[] {
  if (!value) return [];

  if (typeof value === 'string') {
    if (!isAction(value)) return [];
    return [{ permission: '*', pattern: '*', action: value }];
  }

  if (Array.isArray(value)) {
    return value.filter((entry): entry is PermissionRule => isPermissionRule(entry));
  }

  if (typeof value !== 'object') return [];

  const rules: PermissionRule[] = [];
  for (const [permission, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string') {
      if (isAction(entry)) rules.push({ permission, pattern: '*', action: entry });
      continue;
    }
    if (typeof entry === 'boolean') {
      rules.push({ permission, pattern: '*', action: entry ? 'allow' : 'deny' });
      continue;
    }
    if (entry && typeof entry === 'object') {
      for (const [pattern, action] of Object.entries(entry as Record<string, unknown>)) {
        if (typeof action === 'string' && isAction(action)) {
          rules.push({ permission, pattern, action });
        }
      }
    }
  }
  return rules;
}

function isAction(value: string): value is PermissionAction {
  return value === 'allow' || value === 'ask' || value === 'deny';
}

export function isPermissionRule(value: unknown): value is PermissionRule {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.permission === 'string' &&
    typeof record.pattern === 'string' &&
    typeof record.action === 'string' &&
    isAction(record.action)
  );
}

/**
 * Produce an `opencode.json` snippet that would set `permission` for a key.
 * Shown in the UI because the server exposes no endpoint to write config.
 */
export function buildConfigSnippet(permission: string, action: PermissionAction): string {
  return JSON.stringify(
    {
      $schema: 'https://opencode.ai/config.json',
      permission: { [permission]: action },
    },
    null,
    2,
  );
}
