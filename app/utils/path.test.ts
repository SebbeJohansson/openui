import { describe, expect, it } from 'vitest';
import {
  normalizeAbsolutePathNoParent,
  normalizeDirectory,
  normalizeRelativePathNoParent,
  splitFileContentDirectoryAndPath,
  toForwardSlashes,
} from './path';

describe('toForwardSlashes', () => {
  it('converts backslashes and is idempotent', () => {
    expect(toForwardSlashes('a\\b\\c')).toBe('a/b/c');
    expect(toForwardSlashes(toForwardSlashes('a\\b'))).toBe('a/b');
  });
});

describe('normalizeDirectory', () => {
  it('strips trailing slashes and converts separators', () => {
    expect(normalizeDirectory('/a/b/')).toBe('/a/b');
    expect(normalizeDirectory('C:\\x\\')).toBe('C:/x');
  });
  it('returns empty for missing input and root for bare slashes', () => {
    expect(normalizeDirectory(undefined)).toBe('');
    expect(normalizeDirectory('   ')).toBe('');
    expect(normalizeDirectory('///')).toBe('/');
  });
});

describe('normalizeRelativePathNoParent', () => {
  it('drops ., .. and empty segments', () => {
    expect(normalizeRelativePathNoParent('a\\..\\b\\.\\c')).toBe('a/b/c');
    expect(normalizeRelativePathNoParent('./x//y/')).toBe('x/y');
  });
});

describe('normalizeAbsolutePathNoParent', () => {
  it('resolves .. and always starts with /', () => {
    expect(normalizeAbsolutePathNoParent('/a/b/../c')).toBe('/a/c');
    expect(normalizeAbsolutePathNoParent('C:\\Users\\x')).toBe('/C:/Users/x');
  });
});

describe('splitFileContentDirectoryAndPath', () => {
  it('makes paths inside the sandbox relative', () => {
    expect(splitFileContentDirectoryAndPath('/home/u/p/src/a.ts', '/home/u/p')).toEqual({
      directory: '/home/u/p',
      path: 'src/a.ts',
    });
  });
  it('uses . for the sandbox itself', () => {
    expect(splitFileContentDirectoryAndPath('/home/u/p', '/home/u/p')).toEqual({
      directory: '/home/u/p',
      path: '.',
    });
  });
  it('splits at the root when outside the sandbox', () => {
    expect(splitFileContentDirectoryAndPath('/etc/hosts', '/home/u/p')).toEqual({
      directory: '/',
      path: 'etc/hosts',
    });
  });
  it('handles a null sandbox', () => {
    expect(splitFileContentDirectoryAndPath('/', null)).toEqual({ directory: '/', path: '.' });
    expect(splitFileContentDirectoryAndPath('rel/x', null)).toEqual({
      directory: '/',
      path: 'rel/x',
    });
  });
});
