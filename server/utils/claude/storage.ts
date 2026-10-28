/**
 * storage.ts
 * Reads ~/.claude/projects/ from disk to enumerate Claude Code projects and sessions.
 * Sessions are stored as JSONL files: one file per session, one entry per message.
 *
 * The reading itself is agent-wire's, shared with my-widget; this file points it
 * at this machine's ~/.claude and adds the sessions created here that Claude has
 * not written yet.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  encodeProjectDir,
  listClaudeProjects as listProjectsIn,
  readEntries,
  readSessionMeta as readMetaWith,
} from 'agent-wire';
import type { ClaudeProject, ClaudeSessionMeta, StoredEntry } from 'agent-wire';
import { nodeFileReader } from 'agent-wire/node';

export { decodeProjectDir, encodeProjectDir } from 'agent-wire';
export type { ClaudeProject, ClaudeSessionMeta } from 'agent-wire';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export const CLAUDE_DIR = join(homedir(), '.claude');
export const PROJECTS_DIR = join(CLAUDE_DIR, 'projects');

// Persisted store for sessions created via the UI but not yet written to disk by Claude
const PENDING_SESSIONS_PATH = join(homedir(), '.config', 'openui', 'pending-claude-sessions.json');

type PendingSessionRecord = {
  id: string;
  directory: string;
  title: string;
  timeCreated: number;
};

async function readPendingSessions(): Promise<PendingSessionRecord[]> {
  try {
    const raw = await readFile(PENDING_SESSIONS_PATH, 'utf8');
    return JSON.parse(raw) as PendingSessionRecord[];
  } catch {
    return [];
  }
}

async function writePendingSessions(sessions: PendingSessionRecord[]): Promise<void> {
  await mkdir(join(homedir(), '.config', 'openui'), { recursive: true });
  await writeFile(PENDING_SESSIONS_PATH, JSON.stringify(sessions, null, 2));
}

export async function addPendingSession(
  id: string,
  directory: string,
  title: string,
): Promise<void> {
  const existing = await readPendingSessions();
  if (existing.find((s) => s.id === id)) return;
  await writePendingSessions([...existing, { id, directory, title, timeCreated: Date.now() }]);
}

export async function removePendingSession(id: string): Promise<void> {
  const existing = await readPendingSessions();
  await writePendingSessions(existing.filter((s) => s.id !== id));
}

// ---------------------------------------------------------------------------
// Project + session enumeration
// ---------------------------------------------------------------------------

export function readSessionMeta(
  transcriptPath: string,
  directoryHint: string,
  projectID: string,
): Promise<ClaudeSessionMeta | null> {
  return readMetaWith(nodeFileReader, transcriptPath, projectID, directoryHint);
}

export function listClaudeProjects(): Promise<ClaudeProject[]> {
  return listProjectsIn(nodeFileReader, CLAUDE_DIR);
}

export async function listClaudeSessions(directory?: string): Promise<ClaudeSessionMeta[]> {
  const projects = await listClaudeProjects();
  const diskSessions = directory
    ? (projects.find((p) => p.directory === directory)?.sessions ?? [])
    : projects.flatMap((p) => p.sessions);

  // Also include sessions created via the UI that haven't been written to disk yet
  const pending = await readPendingSessions();
  const diskIds = new Set(diskSessions.map((s) => s.id));

  const pendingSessions: ClaudeSessionMeta[] = pending
    .filter((p) => !diskIds.has(p.id) && (!directory || p.directory === directory))
    .map((p) => ({
      id: p.id,
      transcriptPath: '',
      directory: p.directory,
      projectID: encodeProjectDir(p.directory),
      title: p.title,
      timeCreated: p.timeCreated,
      timeUpdated: p.timeCreated,
    }));

  return [...diskSessions, ...pendingSessions];
}

export async function findSessionMeta(sessionId: string): Promise<ClaudeSessionMeta | null> {
  const sessions = await listClaudeSessions();
  return sessions.find((s) => s.id === sessionId) ?? null;
}

// ---------------------------------------------------------------------------
// Full JSONL reader (for replaying history)
// ---------------------------------------------------------------------------

export function readAllEntries(transcriptPath: string): Promise<StoredEntry[]> {
  return readEntries(nodeFileReader, transcriptPath);
}
