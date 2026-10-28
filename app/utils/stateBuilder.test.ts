import { describe, expect, it } from 'vitest';
import type { ProjectInfo, SessionInfo } from '../types/sse';
import { createStateBuilder, resolveProjectColorHex } from './stateBuilder';

const project: ProjectInfo = {
  id: 'p1',
  worktree: '/home/u/p',
  sandboxes: ['/home/u/p'],
  time: { created: 1, updated: 1 },
};

function session(overrides: Partial<SessionInfo> & { id: string }): SessionInfo {
  return {
    slug: overrides.id,
    projectID: 'p1',
    directory: '/home/u/p',
    title: overrides.id,
    version: '1',
    time: { created: 1, updated: 1 },
    ...overrides,
  };
}

describe('createStateBuilder', () => {
  it('places a created session in the sandbox keyed by normalized directory', () => {
    const builder = createStateBuilder();
    builder.applyProjects([project]);
    builder.processSessionCreated(session({ id: 's1', directory: '/home/u/p/' }));

    const sandbox = builder.getState().projects.p1?.sandboxes['/home/u/p'];
    expect(sandbox?.sessions.s1?.id).toBe('s1');
    expect(sandbox?.rootSessions).toContain('s1');
    expect(builder.resolveProjectIdForDirectory('/home/u/p/')).toBe('p1');
  });

  it('tracks status across the session tree', () => {
    const builder = createStateBuilder();
    builder.applyProjects([project]);
    builder.processSessionCreated(session({ id: 's1' }));
    builder.processSessionCreated(session({ id: 's2', parentID: 's1' }));

    expect(builder.processSessionStatus('s1', 'busy', 'p1')).toBe('p1');
    expect(builder.isSessionTreeIdle('p1', 's1')).toBe(false);

    builder.processSessionStatus('s1', 'idle', 'p1');
    builder.processSessionStatus('s2', 'busy', 'p1');
    expect(builder.isSessionTreeIdle('p1', 's1')).toBe(false);

    builder.processSessionStatus('s2', 'idle', 'p1');
    expect(builder.isSessionTreeIdle('p1', 's1')).toBe(true);
    expect(builder.processSessionStatus('s1', 'nonsense', 'p1')).toBeNull();
  });

  it('removes deleted sessions', () => {
    const builder = createStateBuilder();
    builder.applyProjects([project]);
    builder.processSessionCreated(session({ id: 's1' }));
    expect(builder.processSessionDeleted('s1', 'p1')).toBe('p1');
    expect(builder.getState().projects.p1?.sandboxes['/home/u/p']?.sessions.s1).toBeUndefined();
    expect(builder.processSessionDeleted('missing')).toBeNull();
  });
});

describe('resolveProjectColorHex', () => {
  it('passes hex colours through trimmed and returns undefined for empty input', () => {
    expect(resolveProjectColorHex('#aabbcc')).toBe('#aabbcc');
    expect(resolveProjectColorHex('  #abc ')).toBe('#abc');
    expect(resolveProjectColorHex(undefined)).toBeUndefined();
    expect(resolveProjectColorHex('')).toBeUndefined();
  });
});
