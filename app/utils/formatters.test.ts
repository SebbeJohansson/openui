import { describe, expect, it } from 'vitest';
import {
  detectBlockedTool,
  detectModelError,
  formatElapsedTime,
  formatMessageError,
  formatTokenCount,
} from './formatters';

describe('formatTokenCount', () => {
  it('abbreviates thousands and millions', () => {
    expect(formatTokenCount(0)).toBe('0');
    expect(formatTokenCount(-5)).toBe('0');
    expect(formatTokenCount(999)).toBe('999');
    expect(formatTokenCount(1500)).toBe('1.5K');
    expect(formatTokenCount(25_000)).toBe('25K');
    expect(formatTokenCount(1_200_000)).toBe('1.2M');
  });
});

describe('formatElapsedTime', () => {
  it('formats seconds and minutes', () => {
    expect(formatElapsedTime(0, 400)).toBe('');
    expect(formatElapsedTime(0, 30_000)).toBe('30s');
    expect(formatElapsedTime(0, 65_000)).toBe('1m5s');
    expect(formatElapsedTime(0, 120_000)).toBe('2m');
    expect(formatElapsedTime(undefined, 1)).toBe('');
  });
});

describe('detectBlockedTool', () => {
  it('recognises summary-time blocks as not grantable', () => {
    const info = detectBlockedTool({
      name: 'Error',
      message: 'tool call not allowed while generating summary: bash',
    });
    expect(info).toMatchObject({ tool: 'bash', reason: 'summary', grantable: false });
  });
  it('recognises denied permissions as grantable', () => {
    const info = detectBlockedTool({ name: 'Error', message: 'permission denied: edit' });
    expect(info).toMatchObject({ tool: 'edit', reason: 'permission', grantable: true });
  });
  it('returns null for unrelated errors', () => {
    expect(detectBlockedTool({ name: 'Error', message: 'network down' })).toBeNull();
  });
});

describe('detectModelError', () => {
  it('reports quota before auth when both match', () => {
    expect(detectModelError({ name: 'E', message: 'forbidden 429' })?.reason).toBe('quota');
    expect(detectModelError({ name: 'E', message: 'invalid api key' })?.reason).toBe(
      'unauthorized',
    );
    expect(detectModelError({ name: 'E', message: 'fine' })).toBeNull();
  });
});

describe('formatMessageError', () => {
  it('passes abort messages through and joins name/message otherwise', () => {
    expect(formatMessageError({ name: 'MessageAbortedError', message: 'stopped' })).toBe('stopped');
    expect(formatMessageError({ name: 'X', message: 'y' })).toBe('X: y');
  });
});
