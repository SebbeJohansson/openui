import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// storage.ts resolves ~/.claude and ~/.config/openui at import time, so the
// fake home has to exist before the module is loaded.
const HOME = await mkdtemp(join(tmpdir(), 'openui-storage-'));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => HOME, default: { ...actual, homedir: () => HOME } };
});

const {
  addPendingSession,
  decodeProjectDir,
  encodeProjectDir,
  findSessionMeta,
  listClaudeProjects,
  listClaudeSessions,
  readAllEntries,
  readSessionMeta,
  removePendingSession,
  PROJECTS_DIR,
} = await import('./storage');

const PENDING_PATH = join(HOME, '.config', 'openui', 'pending-claude-sessions.json');

function userEntry(overrides: Record<string, unknown> = {}) {
  return {
    type: 'user',
    uuid: 'u1',
    parentUuid: null,
    timestamp: '2026-01-01T00:00:00.000Z',
    sessionId: 'session-a',
    cwd: '/home/u/projects/foo',
    gitBranch: 'main',
    message: { role: 'user', content: 'first prompt' },
    ...overrides,
  };
}

async function writeJsonl(encodedDir: string, file: string, entries: unknown[]) {
  const dir = join(PROJECTS_DIR, encodedDir);
  await mkdir(dir, { recursive: true });
  const path = join(dir, file);
  await writeFile(path, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return path;
}

beforeAll(async () => {
  await mkdir(PROJECTS_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(PROJECTS_DIR, { recursive: true, force: true });
  await mkdir(PROJECTS_DIR, { recursive: true });
  await rm(PENDING_PATH, { force: true });
});

afterAll(async () => {
  await rm(HOME, { recursive: true, force: true });
});

describe('project directory encoding', () => {
  it('encodes a path the way ~/.claude/projects names its folders', () => {
    expect(encodeProjectDir('/home/u/projects/foo')).toBe('-home-u-projects-foo');
  });
  it('decodes back to a path', () => {
    expect(decodeProjectDir('-home-u-projects-foo')).toBe('/home/u/projects/foo');
  });
  it('is lossy for directories containing a dash, which is why cwd is preferred', () => {
    // A folder named `my-app` encodes to `-home-u-my-app` and decodes to
    // `/home/u/my/app`. listClaudeProjects therefore groups by the cwd inside
    // the JSONL, not by the folder name.
    expect(decodeProjectDir(encodeProjectDir('/home/u/my-app'))).toBe('/home/u/my/app');
  });
});

describe('readSessionMeta', () => {
  it('reads id, directory, branch and timestamps from the entries', async () => {
    const path = await writeJsonl('-home-u-projects-foo', 'session-a.jsonl', [
      userEntry(),
      userEntry({
        uuid: 'u2',
        timestamp: '2026-01-02T00:00:00.000Z',
        message: { role: 'user', content: 'later' },
      }),
    ]);

    const meta = await readSessionMeta(path, '/hint', '-home-u-projects-foo');

    expect(meta).toMatchObject({
      id: 'session-a',
      directory: '/home/u/projects/foo',
      projectID: '-home-u-projects-foo',
      gitBranch: 'main',
      title: 'first prompt',
      transcriptPath: path,
    });
    expect(meta!.timeCreated).toBe(Date.parse('2026-01-01T00:00:00.000Z'));
    expect(meta!.timeUpdated).toBe(Date.parse('2026-01-02T00:00:00.000Z'));
  });

  it('falls back to the directory hint and the file name when no entry has a cwd', async () => {
    const path = await writeJsonl('-x', 'fallback-id.jsonl', [
      { type: 'queue-operation', timestamp: '2026-01-01T00:00:00.000Z' },
    ]);

    const meta = await readSessionMeta(path, '/hint/dir', '-x');

    expect(meta).toMatchObject({ id: 'fallback-id', directory: '/hint/dir' });
  });

  it('skips unparseable lines instead of failing', async () => {
    const dir = join(PROJECTS_DIR, '-x');
    await mkdir(dir, { recursive: true });
    const path = join(dir, 'session-a.jsonl');
    await writeFile(path, `{ not json\n${JSON.stringify(userEntry())}\n`);

    const meta = await readSessionMeta(path, '/hint', '-x');

    expect(meta).toMatchObject({ id: 'session-a', title: 'first prompt' });
  });

  it('returns null for an empty file or a missing one', async () => {
    const dir = join(PROJECTS_DIR, '-x');
    await mkdir(dir, { recursive: true });
    const empty = join(dir, 'empty.jsonl');
    await writeFile(empty, '\n  \n');

    expect(await readSessionMeta(empty, '/hint', '-x')).toBeNull();
    expect(await readSessionMeta(join(dir, 'nope.jsonl'), '/hint', '-x')).toBeNull();
  });

  it('uses the file\'s modification time when the entries carry no usable timestamp', async () => {
    const path = await writeJsonl('-x', 'session-a.jsonl', [userEntry({ timestamp: undefined })]);

    const meta = await readSessionMeta(path, '/hint', '-x');

    expect(meta!.timeCreated).toBe((await stat(path)).mtimeMs);
  });
});

describe('title extraction', () => {
  it('prefers an explicit summary entry', async () => {
    const path = await writeJsonl('-x', 'session-a.jsonl', [
      userEntry(),
      { type: 'summary', summary: 'A tidy summary', leafUuid: 'u1' },
    ]);
    expect((await readSessionMeta(path, '/hint', '-x'))!.title).toBe('A tidy summary');
  });

  it('uses the first text block of the first user message', async () => {
    const path = await writeJsonl('-x', 'session-a.jsonl', [
      userEntry({
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'block prompt' }],
        },
      }),
    ]);
    expect((await readSessionMeta(path, '/hint', '-x'))!.title).toBe('block prompt');
  });

  it('strips IDE wrappers and other tags out of the title', async () => {
    const path = await writeJsonl('-x', 'session-a.jsonl', [
      userEntry({
        message: {
          role: 'user',
          content: [
            {
              type: 'text',
              text: '<ide_selection>const a = 1</ide_selection>\n<ide_opened_file>x.ts</ide_opened_file>\n<other>real question</other>',
            },
          ],
        },
      }),
    ]);
    expect((await readSessionMeta(path, '/hint', '-x'))!.title).toBe('real question');
  });

  it('truncates long titles to 80 characters', async () => {
    const path = await writeJsonl('-x', 'session-a.jsonl', [
      userEntry({ message: { role: 'user', content: 'x'.repeat(200) } }),
    ]);
    expect((await readSessionMeta(path, '/hint', '-x'))!.title).toHaveLength(80);
  });

  it('falls back to "Untitled session" when nothing is usable', async () => {
    const path = await writeJsonl('-x', 'session-a.jsonl', [
      { type: 'assistant', timestamp: '2026-01-01T00:00:00.000Z', cwd: '/w', sessionId: 's' },
    ]);
    expect((await readSessionMeta(path, '/hint', '-x'))!.title).toBe('Untitled session');
  });
});

describe('listClaudeProjects', () => {
  it('returns an empty list when ~/.claude/projects does not exist', async () => {
    await rm(PROJECTS_DIR, { recursive: true, force: true });
    expect(await listClaudeProjects()).toEqual([]);
    await mkdir(PROJECTS_DIR, { recursive: true });
  });

  it('groups sessions by the cwd inside the file, not by the folder name', async () => {
    // Two differently-named folders, same cwd: one project.
    await writeJsonl('-home-u-projects-foo', 'a.jsonl', [userEntry({ sessionId: 'a' })]);
    await writeJsonl('-home-u-projects-foo-worktree', 'b.jsonl', [
      userEntry({ sessionId: 'b', timestamp: '2026-01-03T00:00:00.000Z' }),
    ]);

    const projects = await listClaudeProjects();

    expect(projects).toHaveLength(1);
    expect(projects[0]!.directory).toBe('/home/u/projects/foo');
    expect(projects[0]!.sessions.map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('sorts projects by most recent session activity', async () => {
    await writeJsonl('-old', 'a.jsonl', [
      userEntry({ sessionId: 'a', cwd: '/old', timestamp: '2026-01-01T00:00:00.000Z' }),
    ]);
    await writeJsonl('-new', 'b.jsonl', [
      userEntry({ sessionId: 'b', cwd: '/new', timestamp: '2026-06-01T00:00:00.000Z' }),
    ]);

    const projects = await listClaudeProjects();

    expect(projects.map((p) => p.directory)).toEqual(['/new', '/old']);
  });

  it('ignores non-directories, non-jsonl files and unreadable sessions', async () => {
    await writeFile(join(PROJECTS_DIR, 'loose-file.txt'), 'not a project');
    const dir = join(PROJECTS_DIR, '-x');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'notes.md'), 'ignored');
    await writeFile(join(dir, 'empty.jsonl'), '');
    await writeJsonl('-x', 'good.jsonl', [userEntry({ sessionId: 'good', cwd: '/w' })]);

    const projects = await listClaudeProjects();

    expect(projects).toHaveLength(1);
    expect(projects[0]!.sessions.map((s) => s.id)).toEqual(['good']);
  });
});

describe('listClaudeSessions', () => {
  it('filters by directory when one is given', async () => {
    await writeJsonl('-a', 'a.jsonl', [userEntry({ sessionId: 'a', cwd: '/a' })]);
    await writeJsonl('-b', 'b.jsonl', [userEntry({ sessionId: 'b', cwd: '/b' })]);

    expect((await listClaudeSessions('/a')).map((s) => s.id)).toEqual(['a']);
    expect((await listClaudeSessions()).map((s) => s.id).sort()).toEqual(['a', 'b']);
  });

  it('returns an empty list for a directory with no sessions', async () => {
    await writeJsonl('-a', 'a.jsonl', [userEntry({ sessionId: 'a', cwd: '/a' })]);
    expect(await listClaudeSessions('/nope')).toEqual([]);
  });

  it('appends pending sessions that are not on disk yet', async () => {
    await addPendingSession('pending-1', '/a', 'New Claude session');

    const all = await listClaudeSessions();

    expect(all.map((s) => s.id)).toEqual(['pending-1']);
    expect(all[0]).toMatchObject({
      directory: '/a',
      title: 'New Claude session',
      transcriptPath: '',
      projectID: '-a',
    });
    expect(await listClaudeSessions('/other')).toEqual([]);
  });

  it('drops a pending session once the same id appears on disk', async () => {
    await addPendingSession('session-a', '/home/u/projects/foo', 'New Claude session');
    await writeJsonl('-home-u-projects-foo', 'session-a.jsonl', [userEntry()]);

    const all = await listClaudeSessions();

    expect(all).toHaveLength(1);
    expect(all[0]!.title).toBe('first prompt');
  });
});

describe('pending session store', () => {
  it('adds once, ignores duplicates and removes by id', async () => {
    await addPendingSession('p1', '/a', 'one');
    await addPendingSession('p1', '/a', 'one again');
    await addPendingSession('p2', '/b', 'two');

    const stored = JSON.parse(await readFile(PENDING_PATH, 'utf8')) as Array<{
      id: string;
      title: string;
    }>;
    expect(stored.map((s) => s.id)).toEqual(['p1', 'p2']);
    expect(stored[0]!.title).toBe('one');

    await removePendingSession('p1');
    const after = JSON.parse(await readFile(PENDING_PATH, 'utf8')) as Array<{ id: string }>;
    expect(after.map((s) => s.id)).toEqual(['p2']);
  });

  it('treats a missing or corrupt store as empty', async () => {
    await mkdir(join(HOME, '.config', 'openui'), { recursive: true });
    await writeFile(PENDING_PATH, 'not json');
    await addPendingSession('p1', '/a', 'one');
    const stored = JSON.parse(await readFile(PENDING_PATH, 'utf8')) as Array<{ id: string }>;
    expect(stored.map((s) => s.id)).toEqual(['p1']);
  });
});

describe('findSessionMeta', () => {
  it('finds a session on disk and a pending one, and returns null otherwise', async () => {
    await writeJsonl('-home-u-projects-foo', 'session-a.jsonl', [userEntry()]);
    await addPendingSession('pending-1', '/a', 'New Claude session');

    expect((await findSessionMeta('session-a'))!.title).toBe('first prompt');
    expect((await findSessionMeta('pending-1'))!.transcriptPath).toBe('');
    expect(await findSessionMeta('cc_session-a')).toBeNull();
    expect(await findSessionMeta('nope')).toBeNull();
  });
});

describe('readAllEntries', () => {
  it('parses every line and skips blanks and bad JSON', async () => {
    const dir = join(PROJECTS_DIR, '-x');
    await mkdir(dir, { recursive: true });
    const path = join(dir, 'session-a.jsonl');
    await writeFile(
      path,
      `${JSON.stringify(userEntry())}\n\n{oops}\n${JSON.stringify({ type: 'summary', summary: 's', leafUuid: 'u1' })}\n`,
    );

    const entries = await readAllEntries(path);

    expect(entries.map((e) => e.type)).toEqual(['user', 'summary']);
  });

  it('returns an empty list for a missing file', async () => {
    expect(await readAllEntries(join(PROJECTS_DIR, 'nope.jsonl'))).toEqual([]);
  });
});
