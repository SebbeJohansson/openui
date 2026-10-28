import { describe, expect, it } from 'vitest';
import {
  asNonEmptyString,
  asObjectArray,
  asRecord,
  asString,
  asStringArray,
  toErrorMessage,
} from './strings';

describe('toErrorMessage', () => {
  it('uses the message of an Error', () => {
    expect(toErrorMessage(new Error('boom'))).toBe('boom');
  });
  it('stringifies anything else', () => {
    expect(toErrorMessage('plain')).toBe('plain');
    expect(toErrorMessage(404)).toBe('404');
    expect(toErrorMessage(null)).toBe('null');
    expect(toErrorMessage(undefined)).toBe('undefined');
  });
});

describe('asString / asNonEmptyString', () => {
  it('passes strings through and rejects other types', () => {
    expect(asString('a')).toBe('a');
    expect(asString('')).toBe('');
    expect(asString(1)).toBeUndefined();
    expect(asString(null)).toBeUndefined();
  });
  it('treats the empty string as absent', () => {
    expect(asNonEmptyString('a')).toBe('a');
    expect(asNonEmptyString('')).toBeUndefined();
  });
});

describe('asRecord', () => {
  it('accepts plain objects only', () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    expect(asRecord([])).toBeNull();
    expect(asRecord(null)).toBeNull();
    expect(asRecord('x')).toBeNull();
    expect(asRecord(0)).toBeNull();
  });
});

describe('asObjectArray', () => {
  it('returns the array or an empty one', () => {
    const input = [{ a: 1 }];
    expect(asObjectArray(input)).toBe(input);
    expect(asObjectArray('nope')).toEqual([]);
    expect(asObjectArray(undefined)).toEqual([]);
  });
});

describe('asStringArray', () => {
  it('returns null unless every item is a string', () => {
    expect(asStringArray(['a', 'b'])).toEqual(['a', 'b']);
    expect(asStringArray([])).toEqual([]);
    expect(asStringArray(['a', 1])).toBeNull();
    expect(asStringArray('a')).toBeNull();
  });
});
