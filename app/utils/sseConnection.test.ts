import { describe, expect, it } from 'vitest';
import { parseSsePacket, splitSseBlocks } from './sseConnection';

describe('parseSsePacket', () => {
  it('parses a valid envelope', () => {
    const packet = parseSsePacket(
      '{"directory":"/d","payload":{"type":"session.status","properties":{"a":1}}}',
    );
    expect(packet).toEqual({
      directory: '/d',
      payload: { type: 'session.status', properties: { a: 1 } },
    });
  });
  it('defaults directory to empty string', () => {
    expect(parseSsePacket('{"payload":{"type":"x","properties":{}}}')?.directory).toBe('');
  });
  it('rejects malformed payloads', () => {
    expect(parseSsePacket('not json')).toBeNull();
    expect(parseSsePacket('[1]')).toBeNull();
    expect(parseSsePacket('{"payload":{"properties":{}}}')).toBeNull();
    expect(parseSsePacket('{"payload":{"type":"x"}}')).toBeNull();
  });
});

describe('splitSseBlocks', () => {
  it('keeps a trailing partial frame as rest', () => {
    expect(splitSseBlocks('data: {a}\n\ndata: {b')).toEqual({
      blocks: ['data: {a}'],
      rest: 'data: {b',
    });
  });
  it('returns an empty rest when the buffer ends on a frame boundary', () => {
    expect(splitSseBlocks('data: {a}\n\n')).toEqual({ blocks: ['data: {a}'], rest: '' });
  });
});
