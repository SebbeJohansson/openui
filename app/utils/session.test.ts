import { describe, expect, it } from 'vitest';
import { matchesQuery, sessionStatusIcon } from './session';

describe('sessionStatusIcon', () => {
  it('maps every known status to its own icon', () => {
    const icons = ['busy', 'retry', 'idle'].map(sessionStatusIcon);
    expect(new Set(icons).size).toBe(3);
    expect(icons).not.toContain(sessionStatusIcon(undefined));
  });
  it('falls back for unknown or missing status', () => {
    expect(sessionStatusIcon('something-else')).toBe(sessionStatusIcon(undefined));
  });
});

describe('matchesQuery', () => {
  it('requires every term to hit at least one field', () => {
    expect(matchesQuery('foo bar', 'a foo thing', 'the BAR')).toBe(true);
    expect(matchesQuery('foo baz', 'a foo thing', 'the bar')).toBe(false);
  });
  it('lowercases the field but not the term, and ignores surrounding whitespace', () => {
    // Documented as-is: an uppercase term never matches, because only the
    // field is lowercased.
    expect(matchesQuery('  FOO   ', 'foo')).toBe(false);
    expect(matchesQuery('  foo   ', 'FOOBAR')).toBe(true);
  });
  it('skips undefined fields and returns false for an empty query', () => {
    expect(matchesQuery('foo', undefined, 'foo')).toBe(true);
    expect(matchesQuery('', 'anything')).toBe(false);
    expect(matchesQuery('   ', 'anything')).toBe(false);
  });
});
