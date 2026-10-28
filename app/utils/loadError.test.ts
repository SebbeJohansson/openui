import { describe, expect, it } from 'vitest';
import { describeLoadError } from './loadError';
import { OpenCodeApiError } from './opencode';

describe('describeLoadError', () => {
  it('explains an auth failure for 401 and 403', () => {
    expect(describeLoadError(new OpenCodeApiError('/session', 401, 'nope'))).toBe(
      'Not authorized (401). Check your OpenCode credentials.',
    );
    expect(describeLoadError(new OpenCodeApiError('/session', 403, ''))).toBe(
      'Not authorized (403). Check your OpenCode credentials.',
    );
  });

  it('includes the server detail for other statuses', () => {
    expect(describeLoadError(new OpenCodeApiError('/session', 500, 'kaboom'))).toBe(
      'Server returned 500: kaboom',
    );
    expect(describeLoadError(new OpenCodeApiError('/session', 500, ''))).toBe(
      'Server returned 500.',
    );
  });

  it('treats a TypeError as an unreachable server (fetch failure)', () => {
    expect(describeLoadError(new TypeError('Failed to fetch'))).toBe(
      'Could not reach the OpenCode server. Is it still running?',
    );
  });

  it('falls back to the message or the stringified value', () => {
    expect(describeLoadError(new Error('plain'))).toBe('plain');
    expect(describeLoadError('just a string')).toBe('just a string');
  });
});
