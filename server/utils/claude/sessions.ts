/**
 * sessions.ts
 * Manages claude subprocess lifecycle: spawn, resume, write prompts, abort.
 * Each session gets one subprocess. Subprocesses are reused until they exit.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import type {
  ClaudeStreamEvent,
  ClaudeControlRequest,
  ClaudeControlResponse,
  ClaudeAllowResponse,
  ClaudeDenyResponse,
} from './types';
import { useRuntimeConfig } from '#imports';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionStatus = 'idle' | 'busy' | 'error' | 'exited';

export interface PendingPermission {
  requestId: string;
  sessionId: string;
  toolName: string;
  input: Record<string, unknown>;
  toolUseId: string;
  title: string;
  description: string;
}

export interface ClaudeSession {
  id: string;
  directory: string;
  status: SessionStatus;
  process: ChildProcess | null;
  pendingPermissions: Map<string, PendingPermission>;
}

// ---------------------------------------------------------------------------
// Session registry
// ---------------------------------------------------------------------------

/** Global map of sessionId → session state */
const sessions = new Map<string, ClaudeSession>();

/** Event emitter for SSE fan-out: emits ('event', sessionId, event) */
export const sessionEvents = new EventEmitter();
sessionEvents.setMaxListeners(200);

// Named to avoid clashing with h3's auto-imported cookie-session `getSession`.
export function getClaudeSession(id: string): ClaudeSession | undefined {
  return sessions.get(id);
}

export function getAllClaudeSessions(): ClaudeSession[] {
  return Array.from(sessions.values());
}

/** Terminate every running claude subprocess (server shutdown). */
export function killAllClaudeSessions(signal: NodeJS.Signals = 'SIGTERM'): void {
  for (const session of sessions.values()) {
    if (session.process && !session.process.killed) session.process.kill(signal);
  }
}

export function createSessionRecord(id: string, directory: string): ClaudeSession {
  const existing = sessions.get(id);
  if (existing) return existing;
  const session: ClaudeSession = {
    id,
    directory,
    status: 'idle',
    process: null,
    pendingPermissions: new Map(),
  };
  sessions.set(id, session);
  return session;
}

// ---------------------------------------------------------------------------
// Find the claude binary
// ---------------------------------------------------------------------------

async function findClaudeBin(): Promise<string> {
  const configured = useRuntimeConfig().claudeBin?.trim();
  if (configured) return configured;
  // Try well-known locations
  const candidates = [
    'claude',
    '/usr/local/bin/claude',
    `${process.env.HOME}/.local/bin/claude`,
    // npx fallback is handled separately
  ];
  for (const c of candidates) {
    try {
      const { execSync } = await import('node:child_process');
      execSync(`which ${c}`, { stdio: 'ignore' });
      return c;
    } catch {
      // try next
    }
  }
  // Fall back to npx
  return 'npx @anthropic-ai/claude-code';
}

// ---------------------------------------------------------------------------
// Spawn or resume a subprocess
// ---------------------------------------------------------------------------

function buildClaudeArgs(resumeSessionId?: string): string[] {
  const args = [
    '--print',
    '--output-format',
    'stream-json',
    '--input-format',
    'stream-json',
    '--permission-prompt-tool',
    'stdio',
    '--verbose',
    '--include-partial-messages',
  ];
  if (resumeSessionId) {
    args.push('--resume', resumeSessionId);
  }
  return args;
}

export async function ensureRunning(
  sessionId: string,
  directory: string,
  isResume: boolean,
): Promise<ClaudeSession> {
  let session = sessions.get(sessionId);
  if (!session) {
    session = createSessionRecord(sessionId, directory);
  }

  if (session.process && !session.process.killed) {
    return session;
  }

  const claudeBin = await findClaudeBin();
  const args = buildClaudeArgs(isResume ? sessionId : undefined);

  // If claudeBin is an npx command, split it
  const [cmd = 'claude', ...extraArgs] = claudeBin.split(' ');
  const proc = spawn(cmd, [...extraArgs, ...args], {
    cwd: directory,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  session.process = proc;
  session.status = 'busy';

  // Emit session status update
  emit(session, {
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    tools: [],
    mcp_servers: [],
    model: '',
    permissionMode: 'default',
    apiKeySource: 'unknown',
    cwd: directory,
  } as ClaudeStreamEvent);

  // Read stdout line by line
  const rl = createInterface({ input: proc.stdout! });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line) as ClaudeStreamEvent;
      handleEvent(session!, event);
    } catch {
      // Not valid JSON — ignore
    }
  });

  // Stderr → log only
  proc.stderr!.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    if (text.trim()) console.error(`[claude:${sessionId.slice(0, 8)}] stderr:`, text.trim());
  });

  proc.on('exit', (code, signal) => {
    console.log(`[claude:${sessionId.slice(0, 8)}] exited (code ${code}, signal ${signal})`);
    // A SIGTERM is our own abort, not a failure.
    session!.status = code === 0 || signal === 'SIGTERM' ? 'idle' : 'error';
    session!.process = null;
    sessionEvents.emit('status', sessionId, session!.status);
  });

  return session;
}

// ---------------------------------------------------------------------------
// Event handling
// ---------------------------------------------------------------------------

function emit(session: ClaudeSession, event: ClaudeStreamEvent) {
  sessionEvents.emit('event', session.id, event);
}

function handleEvent(session: ClaudeSession, event: ClaudeStreamEvent) {
  // Handle permission requests — hold them, don't forward directly
  if (event.type === 'control_request') {
    const req = event as unknown as ClaudeControlRequest;
    if (req.request.subtype === 'can_use_tool') {
      const perm: PendingPermission = {
        requestId: req.request_id,
        sessionId: session.id,
        toolName: req.request.tool_name,
        input: req.request.input,
        toolUseId: req.request.tool_use_id,
        title: req.request.title,
        description: req.request.description,
      };
      session.pendingPermissions.set(req.request_id, perm);
      sessionEvents.emit('permission', session.id, perm);
      // Also emit so SSE subscribers see it
      emit(session, event);
      return;
    }
    if (req.request.subtype === 'initialize') {
      // No action needed — just emit
      emit(session, event);
      return;
    }
  }

  if (event.type === 'result') {
    session.status = event.subtype === 'success' ? 'idle' : 'error';
    sessionEvents.emit('status', session.id, session.status);
  }

  emit(session, event);
}

// ---------------------------------------------------------------------------
// Send a prompt
// ---------------------------------------------------------------------------

export function sendPrompt(session: ClaudeSession, text: string): void {
  if (!session.process || session.process.killed) {
    throw new Error(`Session ${session.id} has no running process`);
  }
  const payload = JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n';
  session.process.stdin!.write(payload);
  session.status = 'busy';
  sessionEvents.emit('status', session.id, session.status);
}

// ---------------------------------------------------------------------------
// Reply to a permission request
// ---------------------------------------------------------------------------

export function replyPermission(
  session: ClaudeSession,
  requestId: string,
  behavior: 'allow' | 'deny',
  message?: string,
): void {
  const perm = session.pendingPermissions.get(requestId);
  if (!perm) throw new Error(`No pending permission request ${requestId}`);

  const responsePayload: ClaudeControlResponse = {
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: requestId,
      response:
        behavior === 'allow'
          ? ({
              behavior: 'allow',
              updatedInput: perm.input,
              toolUseID: perm.toolUseId,
            } satisfies ClaudeAllowResponse)
          : ({
              behavior: 'deny',
              message: message ?? 'User denied this action.',
              toolUseID: perm.toolUseId,
            } satisfies ClaudeDenyResponse),
    },
  };

  if (!session.process || session.process.killed) {
    throw new Error(`Session ${session.id} has no running process`);
  }
  session.process.stdin!.write(JSON.stringify(responsePayload) + '\n');
  session.pendingPermissions.delete(requestId);
}

// ---------------------------------------------------------------------------
// Abort
// ---------------------------------------------------------------------------

export function abortSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session?.process || session.process.killed) return;
  session.process.kill('SIGTERM');
  session.status = 'idle';
}
