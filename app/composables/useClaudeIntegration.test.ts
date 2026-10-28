// @vitest-environment nuxt
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountAppContext, projectState } from '../../test/nuxt/app-context';
import type { AppContext } from './useAppContext';
import { useClaudeIntegration } from './useClaudeIntegration';
import { useServerConfig } from './useServerConfig';

const CLAUDE_BASE = '/api/claude';
const mounted: Array<() => void> = [];

type Request = { url: string; method: string; body: unknown };
let requests: Request[];
let routes: Record<string, unknown>;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Serves `routes` by pathname; anything unmapped 404s. */
function installFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({
        url,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (!(url in routes)) return Promise.resolve(jsonResponse({ error: 'not found' }, 404));
      return Promise.resolve(jsonResponse(routes[url]));
    }),
  );
}

/** An app context whose /api/config says Claude is enabled. */
async function claudeContext(): Promise<AppContext> {
  const { context, unmount } = await mountAppContext();
  mounted.push(unmount);
  routes['/api/config'] = {
    openCodeUrl: null,
    claudeEnabled: true,
    claudeApiBase: CLAUDE_BASE,
  };
  await useServerConfig(context).load();
  return context;
}

beforeEach(() => {
  requests = [];
  routes = {};
  localStorage.clear();
  installFetch();
});

afterEach(() => {
  while (mounted.length) mounted.pop()?.();
  vi.unstubAllGlobals();
});

describe('endpoints', () => {
  // These paths moved when the standalone Hono server became Nitro routes.
  // If they drift from server/api/claude/**, Claude support silently 404s.
  it('creates a session with POST /sessions', async () => {
    const context = await claudeContext();
    routes[`${CLAUDE_BASE}/sessions`] = {
      sessionID: 'cc_new',
      session: {
        id: 'cc_new',
        projectID: 'ccp_-w',
        directory: '/w',
        title: 'New Claude session',
      },
    };

    await useClaudeIntegration(context).createClaudeSession('/w');

    expect(requests.at(-1)).toMatchObject({
      url: `${CLAUDE_BASE}/sessions`,
      method: 'POST',
      body: { directory: '/w' },
    });
  });

  it('sends a prompt to POST /sessions/:rawId/prompt', async () => {
    const context = await claudeContext();
    routes[`${CLAUDE_BASE}/sessions/abc/prompt`] = { ok: true };

    await useClaudeIntegration(context).sendClaudePrompt('cc_abc', 'hello');

    // The cc_ prefix is a client-side concern; the server sees the raw id.
    expect(requests.at(-1)).toMatchObject({
      url: `${CLAUDE_BASE}/sessions/abc/prompt`,
      method: 'POST',
      body: { text: 'hello' },
    });
  });

  it('reads history from GET /sessions/:rawId/messages', async () => {
    const context = await claudeContext();
    routes[`${CLAUDE_BASE}/sessions/abc/messages`] = { messages: [], parts: [] };

    await useClaudeIntegration(context).fetchClaudeHistory('cc_abc');

    expect(requests.at(-1)).toMatchObject({
      url: `${CLAUDE_BASE}/sessions/abc/messages`,
      method: 'GET',
    });
  });

  it('lists sessions from GET /sessions', async () => {
    const context = await claudeContext();
    routes[`${CLAUDE_BASE}/sessions`] = [];

    await useClaudeIntegration(context).syncClaudeProjects();

    expect(requests.at(-1)).toMatchObject({ url: `${CLAUDE_BASE}/sessions`, method: 'GET' });
  });

  it('honours a base url served under a sub-path', async () => {
    const { context, unmount } = await mountAppContext();
    mounted.push(unmount);
    routes['/api/config'] = {
      openCodeUrl: null,
      claudeEnabled: true,
      claudeApiBase: '/openui/api/claude',
    };
    await useServerConfig(context).load();
    routes['/openui/api/claude/sessions/abc/prompt'] = { ok: true };

    await useClaudeIntegration(context).sendClaudePrompt('cc_abc', 'hi');

    expect(requests.at(-1)!.url).toBe('/openui/api/claude/sessions/abc/prompt');
  });
});

describe('isClaudeSession', () => {
  it('follows the cc_ prefix of the selected session', async () => {
    const context = await claudeContext();
    const claude = useClaudeIntegration(context);

    expect(claude.isClaudeSession.value).toBe(false);
    context.selection.selectedSessionId.value = 'ses_opencode';
    expect(claude.isClaudeSession.value).toBe(false);
    context.selection.selectedSessionId.value = 'cc_abc';
    expect(claude.isClaudeSession.value).toBe(true);
  });
});

describe('createClaudeSession', () => {
  it('injects the new session into the tree and selects it', async () => {
    const context = await claudeContext();
    routes[`${CLAUDE_BASE}/sessions`] = {
      sessionID: 'cc_new',
      session: { id: 'cc_new', projectID: 'ccp_-w', directory: '/w', title: 'New Claude session' },
    };

    await useClaudeIntegration(context).createClaudeSession('/w');

    const project = context.serverState.projects['ccp_-w'];
    expect(project).toBeDefined();
    expect(project!.worktree).toBe('/w');
    expect(project!.sandboxes['/w']!.sessions['cc_new']).toMatchObject({
      id: 'cc_new',
      title: 'New Claude session',
    });
    expect(context.selection.selectedProjectId.value).toBe('ccp_-w');
    expect(context.selection.selectedSessionId.value).toBe('cc_new');
  });

  it('merges into the OpenCode project that owns the directory and selects that project', async () => {
    const context = await claudeContext();
    context.serverState.projects.oc1 = projectState('oc1', '/w', ['ses_existing']) as never;
    routes[`${CLAUDE_BASE}/sessions`] = {
      sessionID: 'cc_new',
      session: { id: 'cc_new', projectID: 'ccp_-w', directory: '/w', title: 'Claude here' },
    };

    await useClaudeIntegration(context).createClaudeSession('/w');

    expect(context.serverState.projects['ccp_-w']).toBeUndefined();
    const sandbox = context.serverState.projects.oc1!.sandboxes['/w']!;
    expect(sandbox.rootSessions).toEqual(['cc_new', 'ses_existing']);
    expect(context.selection.selectedProjectId.value).toBe('oc1');
    expect(context.selection.selectedSessionId.value).toBe('cc_new');
  });

  it('falls back to the active directory', async () => {
    const context = await claudeContext();
    context.serverState.projects.oc1 = projectState('oc1', '/active', ['ses_1']) as never;
    context.selection.selectedProjectId.value = 'oc1';
    context.selection.selectedSessionId.value = 'ses_1';
    routes[`${CLAUDE_BASE}/sessions`] = {
      sessionID: 'cc_new',
      session: { id: 'cc_new', projectID: 'ccp_-active', directory: '/active' },
    };

    await useClaudeIntegration(context).createClaudeSession();

    expect(requests.at(-1)!.body).toEqual({ directory: '/active' });
  });

  it('reports an empty active directory instead of calling the server', async () => {
    const context = await claudeContext();
    const before = requests.length;

    await useClaudeIntegration(context).createClaudeSession();

    expect(requests).toHaveLength(before);
    expect(context.sessionError.value).toBe(
      'Claude session create failed: Active directory is empty.',
    );
  });

  it('reports a server failure through sessionError and leaves the tree alone', async () => {
    const context = await claudeContext();
    // /sessions is unmapped, so the stub 404s.

    await useClaudeIntegration(context).createClaudeSession('/w');

    expect(context.sessionError.value).toBe('Claude session create failed: HTTP 404');
    expect(context.serverState.projects).toEqual({});
  });

  it('clears a previous error on the next attempt', async () => {
    const context = await claudeContext();
    context.sessionError.value = 'stale';
    routes[`${CLAUDE_BASE}/sessions`] = {
      sessionID: 'cc_new',
      session: { id: 'cc_new', projectID: 'ccp_-w', directory: '/w' },
    };

    await useClaudeIntegration(context).createClaudeSession('/w');

    expect(context.sessionError.value).toBe('');
  });
});

describe('sendClaudePrompt', () => {
  it('throws on a non-ok response so the caller can surface it', async () => {
    const context = await claudeContext();

    await expect(useClaudeIntegration(context).sendClaudePrompt('cc_abc', 'hi')).rejects.toThrow(
      'Claude prompt failed: HTTP 404',
    );
  });

  it('throws when the server has Claude disabled', async () => {
    const { context, unmount } = await mountAppContext();
    mounted.push(unmount);

    await expect(useClaudeIntegration(context).sendClaudePrompt('cc_abc', 'hi')).rejects.toThrow(
      'Claude Code support is not enabled on this server.',
    );
  });
});

describe('fetchClaudeHistory', () => {
  it('regroups the flat message and part arrays into thread entries', async () => {
    const context = await claudeContext();
    routes[`${CLAUDE_BASE}/sessions/abc/messages`] = {
      messages: [{ id: 'ccm_1' }, { id: 'ccm_2' }],
      parts: [
        { id: 'ccpt_1', messageID: 'ccm_1', type: 'text' },
        { id: 'ccpt_2', messageID: 'ccm_1', type: 'text' },
        { id: 'ccpt_3', messageID: 'ccm_2', type: 'text' },
        { id: 'ccpt_orphan', type: 'text' },
      ],
    };

    const entries = await useClaudeIntegration(context).fetchClaudeHistory('cc_abc');

    expect(entries).toEqual([
      {
        info: { id: 'ccm_1' },
        parts: [
          { id: 'ccpt_1', messageID: 'ccm_1', type: 'text' },
          { id: 'ccpt_2', messageID: 'ccm_1', type: 'text' },
        ],
      },
      { info: { id: 'ccm_2' }, parts: [{ id: 'ccpt_3', messageID: 'ccm_2', type: 'text' }] },
    ]);
  });

  it('gives a message with no parts an empty array', async () => {
    const context = await claudeContext();
    routes[`${CLAUDE_BASE}/sessions/abc/messages`] = { messages: [{ id: 'ccm_1' }], parts: [] };

    const entries = await useClaudeIntegration(context).fetchClaudeHistory('cc_abc');

    expect(entries).toEqual([{ info: { id: 'ccm_1' }, parts: [] }]);
  });

  it('throws on a non-ok response', async () => {
    const context = await claudeContext();

    await expect(useClaudeIntegration(context).fetchClaudeHistory('cc_abc')).rejects.toThrow(
      'Claude history failed: HTTP 404',
    );
  });
});

describe('syncClaudeProjects', () => {
  it('does nothing when the server has Claude disabled', async () => {
    const { context, unmount } = await mountAppContext();
    mounted.push(unmount);
    routes['/api/config'] = { openCodeUrl: null, claudeEnabled: false, claudeApiBase: null };
    await useServerConfig(context).load();
    const before = requests.length;

    await useClaudeIntegration(context).syncClaudeProjects();

    expect(requests).toHaveLength(before);
  });

  it('creates one project per Claude project id', async () => {
    const context = await claudeContext();
    routes[`${CLAUDE_BASE}/sessions`] = [
      { id: 'cc_1', projectID: 'ccp_-a', directory: '/a', title: 'one' },
      { id: 'cc_2', projectID: 'ccp_-a', directory: '/a', title: 'two' },
      { id: 'cc_3', projectID: 'ccp_-b', directory: '/b', title: 'three' },
    ];

    await useClaudeIntegration(context).syncClaudeProjects();

    expect(Object.keys(context.serverState.projects).sort()).toEqual(['ccp_-a', 'ccp_-b']);
    const a = context.serverState.projects['ccp_-a']!;
    expect(a.name).toBe('a');
    expect(a.sandboxes['/a']!.rootSessions).toEqual(['cc_1', 'cc_2']);
    expect(a.sandboxes['/a']!.sessions['cc_1']).toMatchObject({ id: 'cc_1', title: 'one' });
  });

  it('merges into an OpenCode project with the same worktree without replacing it', async () => {
    const context = await claudeContext();
    context.serverState.projects.oc1 = projectState('oc1', '/a', ['ses_1']) as never;
    routes[`${CLAUDE_BASE}/sessions`] = [
      { id: 'cc_1', projectID: 'ccp_-a', directory: '/a', title: 'one' },
    ];

    await useClaudeIntegration(context).syncClaudeProjects();

    expect(context.serverState.projects['ccp_-a']).toBeUndefined();
    const sandbox = context.serverState.projects.oc1!.sandboxes['/a']!;
    expect(sandbox.rootSessions).toEqual(['cc_1', 'ses_1']);
    expect(sandbox.sessions['ses_1']).toBeDefined();
  });

  it('is idempotent and never overwrites an entry it already added', async () => {
    const context = await claudeContext();
    routes[`${CLAUDE_BASE}/sessions`] = [
      { id: 'cc_1', projectID: 'ccp_-a', directory: '/a', title: 'one' },
    ];
    const claude = useClaudeIntegration(context);

    await claude.syncClaudeProjects();
    const sandbox = context.serverState.projects['ccp_-a']!.sandboxes['/a']!;
    (sandbox.sessions['cc_1'] as { title?: string }).title = 'renamed locally';
    await claude.syncClaudeProjects();

    expect(sandbox.rootSessions).toEqual(['cc_1']);
    expect(sandbox.sessions['cc_1']!.title).toBe('renamed locally');
  });

  it('derives a project id from the directory when the server omits one', async () => {
    const context = await claudeContext();
    routes[`${CLAUDE_BASE}/sessions`] = [{ id: 'cc_1', directory: '/a', title: 'one' }];

    await useClaudeIntegration(context).syncClaudeProjects();

    expect(Object.keys(context.serverState.projects)).toEqual(['ccp_/a']);
  });

  it('stays quiet when the server is unreachable', async () => {
    const context = await claudeContext();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );

    await expect(useClaudeIntegration(context).syncClaudeProjects()).resolves.toBeUndefined();
    expect(context.serverState.projects).toEqual({});
  });
});
