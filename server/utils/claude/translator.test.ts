import { describe, expect, it } from 'vitest';
import {
  CC_MSG_PREFIX,
  CC_PART_PREFIX,
  CC_PROJECT_PREFIX,
  CC_SESSION_PREFIX,
  ccSessionId,
  rawSessionId,
} from '#shared/utils/claude-ids';
import { encodeProjectDir } from './storage';
import { translateEvent } from './translator';
import type { ClaudeStreamEvent } from './types';

const DIR = '/home/u/p';

describe('id helpers', () => {
  it('prefixes session ids exactly once and round-trips', () => {
    expect(ccSessionId('abc')).toBe(`${CC_SESSION_PREFIX}abc`);
    expect(ccSessionId(ccSessionId('abc'))).toBe(`${CC_SESSION_PREFIX}abc`);
    expect(rawSessionId(ccSessionId('abc'))).toBe('abc');
    expect(rawSessionId('plain')).toBe('plain');
  });
  it('encodes project directories the way ~/.claude/projects does', () => {
    expect(encodeProjectDir('/home/u/p')).toBe('-home-u-p');
  });
});

describe('translateEvent', () => {
  it('turns system/init into session.created + busy status', () => {
    const out = translateEvent(
      { type: 'system', subtype: 'init', session_id: 'abc123' } as unknown as ClaudeStreamEvent,
      'abc123',
      DIR,
    );
    expect(out.map((e) => e.payload.type)).toEqual(['session.created', 'session.status']);
    const info = out[0]!.payload.properties.info as Record<string, unknown>;
    expect(info.id).toBe('cc_abc123');
    expect(String(info.projectID).startsWith('ccp_')).toBe(true);
    expect(info.directory).toBe(DIR);
    expect(out[0]!.directory).toBe(DIR);
    expect(out[1]!.payload.properties.status).toEqual({ type: 'busy' });
  });

  it('turns assistant text blocks into message.part.updated envelopes', () => {
    const out = translateEvent(
      {
        type: 'assistant',
        session_id: 'abc123',
        message: {
          id: 'm1',
          type: 'message',
          role: 'assistant',
          model: 'claude-x',
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 3, output_tokens: 4 },
          content: [{ type: 'text', text: 'hello' }],
        },
      } as ClaudeStreamEvent,
      'abc123',
      DIR,
    );
    expect(out[0]!.payload.type).toBe('message.updated');
    const info = out[0]!.payload.properties.info as Record<string, unknown>;
    expect(String(info.id).startsWith(CC_MSG_PREFIX)).toBe(true);
    expect(info.sessionID).toBe('cc_abc123');

    const partEnvelope = out.find((e) => e.payload.type === 'message.part.updated');
    const part = partEnvelope?.payload.properties.part as Record<string, unknown>;
    expect(part.type).toBe('text');
    expect(part.text).toBe('hello');
    expect(part.messageID).toBe(info.id);
    expect(String(part.id).startsWith(CC_PART_PREFIX)).toBe(true);
    expect(CC_PART_PREFIX).not.toBe(CC_PROJECT_PREFIX);
  });

  it('turns a result into an idle status and a session update', () => {
    const out = translateEvent(
      {
        type: 'result',
        subtype: 'success',
        session_id: 'abc123',
        total_cost_usd: 0,
        duration_ms: 1,
        num_turns: 1,
        result: 'done',
      } as ClaudeStreamEvent,
      'abc123',
      DIR,
    );
    const status = out.find((e) => e.payload.type === 'session.status');
    expect(status?.payload.properties.status).toEqual({ type: 'idle' });
    expect(out.some((e) => e.payload.type === 'session.updated')).toBe(true);
  });
});
