import { describe, expect, it } from 'vitest';
import {
  matchesPattern,
  normalizePermissionConfig,
  resolvePermission,
  rulesFromToolsMap,
  type RulesetLayer,
} from './permissions';

describe('resolvePermission', () => {
  it('falls back to server defaults', () => {
    expect(resolvePermission('bash', [])).toMatchObject({ action: 'allow', source: 'default' });
    expect(resolvePermission('doom_loop', []).action).toBe('ask');
    expect(resolvePermission('external_directory', []).action).toBe('ask');
  });

  it('lets a later layer override an earlier one', () => {
    const layers: RulesetLayer[] = [
      { source: 'global', rules: [{ permission: 'bash', pattern: '*', action: 'deny' }] },
      { source: 'agent', rules: [{ permission: 'bash', pattern: '*', action: 'allow' }] },
    ];
    const result = resolvePermission('bash', layers);
    expect(result.action).toBe('allow');
    expect(result.source).toBe('agent');
    expect(result.rules).toHaveLength(2);
  });

  it('only applies pattern rules that match the target', () => {
    const layers: RulesetLayer[] = [
      { source: 'global', rules: [{ permission: 'bash', pattern: 'git *', action: 'deny' }] },
    ];
    expect(resolvePermission('bash', layers, 'git status').action).toBe('deny');
    expect(resolvePermission('bash', layers, 'rm -rf /').source).toBe('default');
    expect(resolvePermission('bash', layers, '*').rules).toHaveLength(1);
  });
});

describe('matchesPattern', () => {
  it('treats * and ? as wildcards and escapes regex characters', () => {
    expect(matchesPattern('git *', 'git status')).toBe(true);
    expect(matchesPattern('a?c', 'abc')).toBe(true);
    expect(matchesPattern('a.b', 'axb')).toBe(false);
    expect(matchesPattern('a.b', 'a.b')).toBe(true);
  });
});

describe('normalizePermissionConfig', () => {
  it('accepts every documented config shape', () => {
    expect(normalizePermissionConfig('allow')).toEqual([
      { permission: '*', pattern: '*', action: 'allow' },
    ]);
    expect(normalizePermissionConfig({ bash: 'ask' })).toEqual([
      { permission: 'bash', pattern: '*', action: 'ask' },
    ]);
    expect(normalizePermissionConfig({ edit: false })).toEqual([
      { permission: 'edit', pattern: '*', action: 'deny' },
    ]);
    expect(normalizePermissionConfig({ bash: { '*': 'ask', 'git *': 'allow' } })).toEqual([
      { permission: 'bash', pattern: '*', action: 'ask' },
      { permission: 'bash', pattern: 'git *', action: 'allow' },
    ]);
  });

  it('drops invalid actions', () => {
    expect(normalizePermissionConfig('bogus')).toEqual([]);
    expect(normalizePermissionConfig([{ permission: 'x', pattern: '*', action: 'bogus' }])).toEqual(
      [],
    );
  });
});

describe('rulesFromToolsMap', () => {
  it('turns the legacy boolean map into catch-all rules', () => {
    expect(rulesFromToolsMap({ edit: false, bash: true })).toEqual([
      { permission: 'edit', pattern: '*', action: 'deny' },
      { permission: 'bash', pattern: '*', action: 'allow' },
    ]);
    expect(rulesFromToolsMap(undefined)).toEqual([]);
  });
});
