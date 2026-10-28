import { describe, expect, it } from 'vitest';
import { normalizeBaseUrl } from './url';

describe('normalizeBaseUrl', () => {
  it('strips trailing slashes and is idempotent', () => {
    expect(normalizeBaseUrl('http://host:4096/')).toBe('http://host:4096');
    expect(normalizeBaseUrl('http://host:4096///')).toBe('http://host:4096');
    expect(normalizeBaseUrl(normalizeBaseUrl('http://host/'))).toBe('http://host');
  });
  it('leaves a url without a trailing slash alone', () => {
    expect(normalizeBaseUrl('http://host:4096')).toBe('http://host:4096');
    expect(normalizeBaseUrl('')).toBe('');
  });
});
