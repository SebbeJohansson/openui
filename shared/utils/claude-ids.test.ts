import { describe, expect, it } from 'vitest';
import {
  CC_PART_PREFIX,
  CC_PROJECT_PREFIX,
  CC_SESSION_PREFIX,
  ccProjectId,
  ccSessionId,
  isClaudeProjectId,
  isClaudeSessionId,
  rawPermissionId,
  rawSessionId,
} from './claude-ids';

describe('claude id prefixes', () => {
  it('keeps the part prefix distinct from the project prefix', () => {
    // These were both 'ccp_' before the Nitro port, so part ids could collide
    // with project ids.
    expect(CC_PART_PREFIX).not.toBe(CC_PROJECT_PREFIX);
  });
});

describe('session ids', () => {
  it('prefixes once and round-trips', () => {
    expect(ccSessionId('abc')).toBe(`${CC_SESSION_PREFIX}abc`);
    expect(ccSessionId(ccSessionId('abc'))).toBe(`${CC_SESSION_PREFIX}abc`);
    expect(rawSessionId(ccSessionId('abc'))).toBe('abc');
    expect(rawSessionId('plain')).toBe('plain');
  });

  it('recognises only prefixed ids', () => {
    expect(isClaudeSessionId('cc_abc')).toBe(true);
    expect(isClaudeSessionId('ses_abc')).toBe(false);
    expect(isClaudeSessionId(undefined)).toBe(false);
    expect(isClaudeSessionId(null)).toBe(false);
  });
});

describe('project ids', () => {
  it('prefixes and recognises', () => {
    const id = ccProjectId('-home-u-p');
    expect(id).toBe(`${CC_PROJECT_PREFIX}-home-u-p`);
    expect(isClaudeProjectId(id)).toBe(true);
    expect(isClaudeProjectId('global')).toBe(false);
  });
});

describe('rawPermissionId', () => {
  it('strips the permission prefix when present', () => {
    expect(rawPermissionId('ccperm_req-1')).toBe('req-1');
    expect(rawPermissionId('req-1')).toBe('req-1');
  });
});
