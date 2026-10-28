import { describe, expect, it } from 'vitest';
import {
  formatGlobToolTitle,
  formatListToolTitle,
  formatQueryToolTitle,
  formatWebfetchToolTitle,
  guessLanguageFromPath,
  resolveReadRange,
  resolveReadWritePath,
  toolColor,
} from './toolWindowFormat';

describe('formatGlobToolTitle', () => {
  it('joins pattern, path and include in that order', () => {
    expect(formatGlobToolTitle({ pattern: '**/*.ts', path: 'src', include: '*.vue' })).toBe(
      '**/*.ts @ src include *.vue',
    );
  });
  it('omits missing parts and trims', () => {
    expect(formatGlobToolTitle({ pattern: '  **/*.ts  ' })).toBe('**/*.ts');
    expect(formatGlobToolTitle({ path: 'src' })).toBe('@ src');
  });
  it('returns undefined when there is nothing to show', () => {
    expect(formatGlobToolTitle(undefined)).toBeUndefined();
    expect(formatGlobToolTitle({})).toBeUndefined();
    expect(formatGlobToolTitle({ pattern: '   ', path: 42 })).toBeUndefined();
  });
});

describe('resolveReadWritePath', () => {
  it('prefers input.filePath, then input.path, then metadata, then the state title', () => {
    expect(
      resolveReadWritePath(
        { filePath: 'a.ts', path: 'b.ts' },
        { filepath: 'c.ts' },
        { title: 'd.ts' },
      ),
    ).toBe('a.ts');
    expect(resolveReadWritePath({ path: 'b.ts' }, { filepath: 'c.ts' }, { title: 'd.ts' })).toBe(
      'b.ts',
    );
    expect(resolveReadWritePath({}, { filepath: 'c.ts' }, { title: 'd.ts' })).toBe('c.ts');
    expect(resolveReadWritePath({}, {}, { title: 'd.ts' })).toBe('d.ts');
  });
  it('skips blank candidates and returns undefined when all are empty', () => {
    expect(resolveReadWritePath({ filePath: '   ' }, {}, { title: 'd.ts' })).toBe('d.ts');
    expect(resolveReadWritePath(undefined, undefined, undefined)).toBeUndefined();
  });
});

describe('resolveReadRange', () => {
  it('floors valid numbers', () => {
    expect(resolveReadRange({ offset: 10.9, limit: 5.4 })).toEqual({ offset: 10, limit: 5 });
    expect(resolveReadRange({ offset: 0, limit: 1 })).toEqual({ offset: 0, limit: 1 });
  });
  it('drops negative offsets, non-positive limits and non-numbers', () => {
    expect(resolveReadRange({ offset: -1, limit: 0 })).toEqual({
      offset: undefined,
      limit: undefined,
    });
    expect(resolveReadRange({ offset: '3', limit: Number.NaN })).toEqual({
      offset: undefined,
      limit: undefined,
    });
    expect(resolveReadRange(undefined)).toEqual({ offset: undefined, limit: undefined });
  });
});

describe('single-field tool titles', () => {
  it('trims and returns undefined when blank', () => {
    expect(formatListToolTitle({ path: '  src  ' })).toBe('src');
    expect(formatListToolTitle({ path: '  ' })).toBeUndefined();
    expect(formatWebfetchToolTitle({ url: ' http://x ' })).toBe('http://x');
    expect(formatWebfetchToolTitle({})).toBeUndefined();
    expect(formatQueryToolTitle({ query: ' hi ' })).toBe('hi');
    expect(formatQueryToolTitle(undefined)).toBeUndefined();
  });
});

describe('toolColor', () => {
  it('gives edit-shaped tools the same colour', () => {
    const write = toolColor('write');
    expect(toolColor('edit')).toBe(write);
    expect(toolColor('multiedit')).toBe(write);
    expect(toolColor('apply_patch')).toBe(write);
  });
  it('returns a hex colour for unknown tools', () => {
    expect(toolColor('who-knows')).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('guessLanguageFromPath', () => {
  it('maps extensions to shiki language ids', () => {
    expect(guessLanguageFromPath('a/b/c.ts')).toBe('typescript');
    expect(guessLanguageFromPath('C.VUE')).toBe('vue');
    expect(guessLanguageFromPath('x.yml')).toBe('yaml');
    expect(guessLanguageFromPath('x.yaml')).toBe('yaml');
    expect(guessLanguageFromPath('x.patch')).toBe('diff');
    expect(guessLanguageFromPath('x.hpp')).toBe('cpp');
  });
  it('falls back to text for unknown or missing paths', () => {
    expect(guessLanguageFromPath('Makefile')).toBe('text');
    expect(guessLanguageFromPath('x.unknownext')).toBe('text');
    expect(guessLanguageFromPath(undefined)).toBe('text');
    expect(guessLanguageFromPath('')).toBe('text');
  });
});
