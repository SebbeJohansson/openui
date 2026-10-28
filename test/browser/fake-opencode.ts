/**
 * A stub OpenCode server for end-to-end tests.
 *
 * It is not an OpenCode implementation: it answers only the reads the UI makes
 * during startup and navigation, all derived from a `Seed`, plus the SSE stream
 * the app keeps open. Writes that a spec does not care about are accepted and
 * ignored. Everything the browser learns comes from here, which is what makes a
 * run deterministic.
 *
 * Each instance listens on an ephemeral port, so specs can run in parallel with
 * a fixture each.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Seed, SeedSession } from './seed';

/** Outer structure of every SSE frame, mirroring app/types/sse.ts. */
export type SsePacket = {
  directory: string;
  payload: { type: string; properties: Record<string, unknown> };
};

export type FakeOpenCode = {
  /** Origin to point the app at, e.g. http://127.0.0.1:41234 */
  url: string;
  /**
   * Emit an SSE frame to every connected client. A frame sent before the
   * browser has attached goes nowhere and is not retried, so wait on
   * `eventStreamReady()` first.
   */
  push: (packet: SsePacket) => void;
  /** Resolves once at least one client is listening on /global/event. */
  eventStreamReady: (timeoutMs?: number) => Promise<void>;
  /** Replace the fixture; the next request sees the new world. */
  reseed: (next: Seed) => void;
  /** `${method} ${path}` for every request served, in order. */
  requests: string[];
  close: () => Promise<void>;
};

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
};

function normalizeDirectory(value: string) {
  const trimmed = value.trim().replace(/\/+$/, '');
  return trimmed || '';
}

function toProjectInfo(project: Seed['projects'][number]) {
  return {
    id: project.id,
    worktree: project.worktree,
    name: project.name,
    vcs: 'git' as const,
    sandboxes: [project.worktree],
    time: { created: 1, updated: 1 },
  };
}

function toSessionInfo(session: SeedSession) {
  const time = session.created ?? 1;
  return {
    id: session.id,
    slug: session.id,
    projectID: session.projectID,
    directory: session.directory,
    parentID: session.parentID,
    title: session.title,
    version: '1',
    time: { created: time, updated: time },
  };
}

const AGENT = 'build';
const PROVIDER_ID = 'anthropic';
const MODEL_ID = 'claude-opus-5';

/**
 * OpenCode returns history as `{ info, parts }` pairs. The info objects carry
 * every field UserMessageInfo and AssistantMessageInfo declare as required (see
 * app/types/sse.ts) — the thread renderer reads them without guarding, so a
 * thinner stub blanks the panel instead of rendering it.
 */
function toMessages(session: SeedSession) {
  let lastUserMessageId = '';
  return (session.messages ?? []).map((message, index) => {
    const messageId = `msg_${session.id}_${index}`;
    const created = 1_000 + index;
    if (message.role === 'user') lastUserMessageId = messageId;
    const info =
      message.role === 'user'
        ? {
            id: messageId,
            sessionID: session.id,
            role: 'user' as const,
            time: { created },
            agent: AGENT,
            model: { providerID: PROVIDER_ID, modelID: MODEL_ID },
          }
        : {
            id: messageId,
            sessionID: session.id,
            role: 'assistant' as const,
            time: { created, completed: created + 1 },
            parentID: lastUserMessageId,
            providerID: PROVIDER_ID,
            modelID: MODEL_ID,
            mode: AGENT,
            agent: AGENT,
            path: { cwd: session.directory, root: session.directory },
            cost: 0,
            tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
          };
    return {
      info,
      parts: [
        {
          id: `prt_${session.id}_${index}`,
          messageID: messageId,
          sessionID: session.id,
          type: 'text',
          text: message.text,
        },
      ],
    };
  });
}

/** One authenticated provider, so the composer has a model to select. */
const PROVIDERS = {
  providers: [
    {
      id: PROVIDER_ID,
      name: 'Anthropic',
      models: {
        [MODEL_ID]: { id: MODEL_ID, name: 'Claude Opus 5' },
      },
    },
  ],
  default: { [PROVIDER_ID]: MODEL_ID },
};

const AGENTS = [{ name: AGENT, description: 'Stub agent', mode: 'primary' }];

export async function startFakeOpenCode(initialSeed: Seed): Promise<FakeOpenCode> {
  let seed = initialSeed;
  const streams = new Set<ServerResponse>();
  const streamWaiters = new Set<() => void>();
  const requests: string[] = [];

  /**
   * Sessions the bootstrap should see for a directory. The shared worker asks
   * for the empty directory first, which means "everything".
   */
  function sessionsIn(directory: string, rootsOnly: boolean) {
    const wanted = normalizeDirectory(directory);
    return seed.sessions.filter((session) => {
      if (rootsOnly && session.parentID) return false;
      if (!wanted) return true;
      return normalizeDirectory(session.directory) === wanted;
    });
  }

  function sendJson(res: ServerResponse, body: unknown, status = 200) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      ...CORS_HEADERS,
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(payload),
    });
    res.end(payload);
  }

  function openEventStream(req: IncomingMessage, res: ServerResponse) {
    res.writeHead(200, {
      ...CORS_HEADERS,
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    // A comment frame flushes the headers so the client reports "connected".
    res.write(': connected\n\n');
    streams.add(res);
    streamWaiters.forEach((notify) => notify());
    streamWaiters.clear();
    req.on('close', () => streams.delete(res));
  }

  function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://fake');
    const path = url.pathname;
    const directory = url.searchParams.get('directory') ?? '';
    requests.push(`${req.method} ${path}`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    if (path === '/global/event') {
      openEventStream(req, res);
      return;
    }

    // ── Startup reads ────────────────────────────────────────────────────
    if (path === '/path') {
      sendJson(res, { home: seed.home, worktree: seed.projects[0]?.worktree ?? seed.home });
      return;
    }
    if (path === '/project') {
      sendJson(res, seed.projects.map(toProjectInfo));
      return;
    }
    if (path === '/project/current') {
      const project = seed.projects[0];
      sendJson(res, project ? toProjectInfo(project) : null);
      return;
    }
    if (path === '/session') {
      const rootsOnly = url.searchParams.get('roots') === 'true';
      sendJson(res, sessionsIn(directory, rootsOnly).map(toSessionInfo));
      return;
    }
    if (path === '/session/status') {
      const statuses: Record<string, { type: string }> = {};
      sessionsIn(directory, false).forEach((session) => {
        statuses[session.id] = { type: session.status ?? 'idle' };
      });
      sendJson(res, statuses);
      return;
    }
    if (path === '/vcs') {
      const wanted = normalizeDirectory(directory);
      const project = seed.projects.find((entry) => normalizeDirectory(entry.worktree) === wanted);
      sendJson(res, project?.branch ? { branch: project.branch } : {});
      return;
    }

    // ── Per-session reads ────────────────────────────────────────────────
    const sessionMatch = /^\/session\/([^/]+)\/(message|todo)$/.exec(path);
    if (sessionMatch) {
      const session = seed.sessions.find((entry) => entry.id === sessionMatch[1]);
      if (!session) {
        sendJson(res, { error: 'unknown session' }, 404);
        return;
      }
      if (sessionMatch[2] === 'message') {
        sendJson(res, toMessages(session));
        return;
      }
      sendJson(
        res,
        (session.todos ?? []).map((todo) => ({
          content: todo.content,
          status: todo.status ?? 'pending',
          priority: todo.priority ?? 'medium',
        })),
      );
      return;
    }

    // ── Catalogue reads the UI treats as optional ────────────────────────
    if (path === '/agent') {
      sendJson(res, AGENTS);
      return;
    }
    if (path === '/config/providers') {
      sendJson(res, PROVIDERS);
      return;
    }
    if (
      path === '/command' ||
      path === '/permission' ||
      path === '/question' ||
      path === '/pty' ||
      path === '/file'
    ) {
      sendJson(res, []);
      return;
    }

    // Anything else: a 404 the UI is expected to survive. The recorded request
    // list makes an unexpected one easy to spot from a failing spec.
    sendJson(res, { error: `unhandled ${req.method} ${path}` }, 404);
  }

  const server: Server = createServer((req, res) => {
    try {
      handle(req, res);
    } catch (error) {
      sendJson(res, { error: String(error) }, 500);
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    push(packet) {
      const frame = `data: ${JSON.stringify(packet)}\n\n`;
      streams.forEach((stream) => stream.write(frame));
    },
    eventStreamReady(timeoutMs = 5_000) {
      if (streams.size > 0) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('No client attached to /global/event.')),
          timeoutMs,
        );
        streamWaiters.add(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
    reseed(next) {
      seed = next;
    },
    requests,
    async close() {
      streams.forEach((stream) => stream.end());
      streams.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
