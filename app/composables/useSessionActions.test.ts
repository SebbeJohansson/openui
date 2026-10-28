// @vitest-environment nuxt
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { mountAppContext, projectState } from '../../test/nuxt/app-context';
import type { AppContext } from './useAppContext';
import { useServerConfig } from './useServerConfig';
import { useSessionActions } from './useSessionActions';

const CLAUDE_BASE = '/api/claude';
const OPENCODE_URL = 'http://localhost:4096';

const mounted: Array<() => void> = [];
let requests: string[];
let routes: Record<string, unknown>;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function installFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      const key = Object.keys(routes).find((route) => url === route || url.startsWith(`${route}?`));
      if (!key) return Promise.resolve(jsonResponse({ error: 'not found' }, 404));
      return Promise.resolve(jsonResponse(routes[key]));
    }),
  );
}

/** A context connected to OpenCode with the Claude routes enabled. */
async function connectedContext(): Promise<AppContext> {
  const { context, unmount } = await mountAppContext();
  mounted.push(unmount);
  // useMessages keeps its state at module level, so it outlives the context.
  context.msg.reset();
  context.credentials.save(OPENCODE_URL, '', '');
  routes['/api/config'] = {
    openCodeUrl: OPENCODE_URL,
    claudeEnabled: true,
    claudeApiBase: CLAUDE_BASE,
  };
  await useServerConfig(context).load();
  return context;
}

function selectSession(context: AppContext, projectId: string, sessionId: string, dir = '/w') {
  context.serverState.projects[projectId] = projectState(projectId, dir, [sessionId]) as never;
  context.selection.selectedProjectId.value = projectId;
  context.selection.selectedSessionId.value = sessionId;
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

describe('fetchHistory', () => {
  it('asks the Claude routes for a cc_ session, not OpenCode', async () => {
    // Regression guard: asking OpenCode for a Claude session's messages
    // returns 400 and leaves the thread empty.
    const context = await connectedContext();
    selectSession(context, 'ccp_-w', 'cc_abc');
    routes[`${CLAUDE_BASE}/sessions/abc/messages`] = {
      messages: [{ id: 'ccm_1', sessionID: 'cc_abc', role: 'user' }],
      parts: [{ id: 'ccpt_1', messageID: 'ccm_1', sessionID: 'cc_abc', type: 'text', text: 'hi' }],
    };

    await useSessionActions(context).fetchHistory('cc_abc');

    expect(requests).toContain(`${CLAUDE_BASE}/sessions/abc/messages`);
    expect(requests.some((url) => url.includes(OPENCODE_URL))).toBe(false);
    expect(context.msg.roots.value.map((root) => root.id)).toEqual(['ccm_1']);
  });

  it('asks OpenCode for a normal session', async () => {
    const context = await connectedContext();
    selectSession(context, 'p1', 'ses_1');
    routes[`${OPENCODE_URL}/session/ses_1/message`] = [
      { info: { id: 'msg_1', sessionID: 'ses_1', role: 'user' }, parts: [] },
    ];

    await useSessionActions(context).fetchHistory('ses_1');

    expect(requests.some((url) => url.startsWith(`${OPENCODE_URL}/session/ses_1/message`))).toBe(
      true,
    );
    expect(requests.some((url) => url.startsWith(CLAUDE_BASE))).toBe(false);
    expect(context.msg.roots.value.map((root) => root.id)).toEqual(['msg_1']);
  });

  it('passes the selected worktree directory to OpenCode', async () => {
    const context = await connectedContext();
    selectSession(context, 'p1', 'ses_1', '/home/u/proj');
    routes[`${OPENCODE_URL}/session/ses_1/message`] = [];

    await useSessionActions(context).fetchHistory('ses_1');

    const url = requests.find((entry) => entry.includes('/session/ses_1/message'))!;
    expect(new URL(url).searchParams.get('directory')).toBe('/home/u/proj');
  });

  it('does nothing without a session id', async () => {
    const context = await connectedContext();
    const before = requests.length;

    await useSessionActions(context).fetchHistory('');

    expect(requests).toHaveLength(before);
  });

  it('discards a response for a session that is no longer selected', async () => {
    const context = await connectedContext();
    selectSession(context, 'p1', 'ses_1');
    routes[`${OPENCODE_URL}/session/ses_2/message`] = [
      { info: { id: 'msg_stale', sessionID: 'ses_2', role: 'user' }, parts: [] },
    ];

    await useSessionActions(context).fetchHistory('ses_2');

    expect(context.msg.roots.value).toEqual([]);
  });

  it('swallows a failed load and leaves the thread empty', async () => {
    const context = await connectedContext();
    selectSession(context, 'p1', 'ses_1');
    // The message route is unmapped, so the stub 404s.

    await expect(useSessionActions(context).fetchHistory('ses_1')).resolves.toBeUndefined();
    expect(context.msg.roots.value).toEqual([]);
  });

  it('records the agent and model metadata of user messages', async () => {
    const context = await connectedContext();
    selectSession(context, 'p1', 'ses_1');
    routes[`${OPENCODE_URL}/session/ses_1/message`] = [
      {
        info: {
          id: 'msg_1',
          sessionID: 'ses_1',
          role: 'user',
          agent: 'build',
          providerID: 'anthropic',
          modelID: 'claude-opus-5',
          time: { created: 1234 },
        },
        parts: [],
      },
    ];

    const actions = useSessionActions(context);
    await actions.fetchHistory('ses_1');

    expect(actions.userMessageMetaById.value.msg_1).toMatchObject({
      agent: 'build',
      providerId: 'anthropic',
      modelId: 'claude-opus-5',
    });
    expect(actions.userMessageTimeById.value.msg_1).toBe(1234);
  });
});

describe('switching session', () => {
  /** Two root sessions in one project, each with its own history. */
  function twoSessionProject(context: AppContext) {
    context.serverState.projects.p1 = projectState('p1', '/w', ['ses_1', 'ses_2']) as never;
    routes[`${OPENCODE_URL}/session/ses_1/message`] = [
      { info: { id: 'msg_1', sessionID: 'ses_1', role: 'user' }, parts: [] },
    ];
    routes[`${OPENCODE_URL}/session/ses_2/message`] = [
      { info: { id: 'msg_2', sessionID: 'ses_2', role: 'user' }, parts: [] },
    ];
  }

  const rootIds = (context: AppContext) => context.msg.roots.value.map((root) => root.id);

  it('loads the new session history when the selection changes', async () => {
    // Regression guard: the selection watcher was lost when App.vue was split
    // into feature composables, so switching session left the previous
    // session's thread on screen.
    const context = await connectedContext();
    twoSessionProject(context);
    useSessionActions(context);

    await context.selection.switchSession('p1', 'ses_1');
    await vi.waitFor(() => expect(rootIds(context)).toEqual(['msg_1']));

    await context.selection.switchSession('p1', 'ses_2');
    await vi.waitFor(() => expect(rootIds(context)).toEqual(['msg_2']));
  });

  it('clears the thread when the new session has no history', async () => {
    const context = await connectedContext();
    twoSessionProject(context);
    routes[`${OPENCODE_URL}/session/ses_2/message`] = [];
    useSessionActions(context);

    await context.selection.switchSession('p1', 'ses_1');
    await vi.waitFor(() => expect(rootIds(context)).toEqual(['msg_1']));

    await context.selection.switchSession('p1', 'ses_2');
    await vi.waitFor(() => expect(rootIds(context)).toEqual([]));
  });

  it('does not reload when the selection is set to the same session', async () => {
    const context = await connectedContext();
    twoSessionProject(context);
    useSessionActions(context);

    await context.selection.switchSession('p1', 'ses_1');
    await vi.waitFor(() => expect(rootIds(context)).toEqual(['msg_1']));
    const loads = requests.filter((url) => url.includes('/session/ses_1/message')).length;

    await context.selection.switchSession('p1', 'ses_1');
    await nextTick();
    expect(requests.filter((url) => url.includes('/session/ses_1/message'))).toHaveLength(loads);
  });
});

describe('todo scope', () => {
  function todoLoads(sessionId: string) {
    return requests.filter((url) => url.includes(`/session/${sessionId}/todo`));
  }

  async function selectedWithTodos() {
    const context = await connectedContext();
    context.serverState.projects.p1 = projectState('p1', '/w', ['ses_1']) as never;
    routes[`${OPENCODE_URL}/session/ses_1/message`] = [];
    routes[`${OPENCODE_URL}/session/ses_1/todo`] = [];
    useSessionActions(context);
    await context.selection.switchSession('p1', 'ses_1');
    await vi.waitFor(() => expect(todoLoads('ses_1')).toHaveLength(1));
    return context;
  }

  it('loads the todos for a session exactly once per switch', async () => {
    // The selection reset and the scope watcher both want to reload; the
    // scope guard makes sure only one of them actually fetches.
    const context = await selectedWithTodos();
    await nextTick();
    await nextTick();
    expect(todoLoads('ses_1')).toHaveLength(1);
    expect(context.selection.selectedSessionId.value).toBe('ses_1');
  });

  it('reloads when a subagent joins the selected session', async () => {
    const context = await selectedWithTodos();
    routes[`${OPENCODE_URL}/session/ses_sub/todo`] = [];

    const sandbox = context.serverState.projects.p1!.sandboxes['/w']!;
    sandbox.sessions.ses_sub = { id: 'ses_sub', directory: '/w', parentID: 'ses_1' } as never;

    await vi.waitFor(() => expect(todoLoads('ses_sub')).toHaveLength(1));
  });
});

describe('selection self-healing', () => {
  /** Two root sessions, ses_2 the more recent, so it is the preferred pick. */
  function twoRoots(context: AppContext) {
    context.serverState.projects.p1 = projectState('p1', '/w', ['ses_1', 'ses_2']) as never;
    const sandbox = context.serverState.projects.p1!.sandboxes['/w']!;
    sandbox.sessions.ses_1!.timeCreated = 1;
    sandbox.sessions.ses_2!.timeCreated = 2;
    routes[`${OPENCODE_URL}/session/ses_1/message`] = [];
    routes[`${OPENCODE_URL}/session/ses_2/message`] = [];
    context.serverState.bootstrapped.value = true;
  }

  it('picks the preferred session when nothing is selected', async () => {
    const context = await connectedContext();
    twoRoots(context);
    useSessionActions(context);

    context.selection.selectedProjectId.value = 'p1';

    await vi.waitFor(() => expect(context.selection.selectedSessionId.value).toBe('ses_2'));
  });

  it('replaces a selection whose session is gone', async () => {
    const context = await connectedContext();
    twoRoots(context);
    useSessionActions(context);
    await context.selection.switchSession('p1', 'ses_1');

    delete context.serverState.projects.p1!.sandboxes['/w']!.sessions.ses_1;

    await vi.waitFor(() => expect(context.selection.selectedSessionId.value).toBe('ses_2'));
  });

  it('leaves the selection alone before the state mirror has bootstrapped', async () => {
    const context = await connectedContext();
    twoRoots(context);
    context.serverState.bootstrapped.value = false;
    useSessionActions(context);

    context.selection.selectedProjectId.value = 'p1';
    await nextTick();
    await nextTick();

    expect(context.selection.selectedSessionId.value).toBe('');
  });
});

describe('fetchHomePath', () => {
  it('stores the home and worktree paths reported by the server', async () => {
    const context = await connectedContext();
    routes[`${OPENCODE_URL}/path`] = { home: ' /home/u ', worktree: ' /home/u/proj ' };

    await useSessionActions(context).fetchHomePath();

    expect(context.homePath.value).toBe('/home/u');
    expect(context.serverWorktreePath.value).toBe('/home/u/proj');
  });

  it('ignores blank values', async () => {
    const context = await connectedContext();
    routes[`${OPENCODE_URL}/path`] = { home: '   ', worktree: '' };

    await useSessionActions(context).fetchHomePath();

    expect(context.homePath.value).toBe('');
    expect(context.serverWorktreePath.value).toBe('');
  });

  it('stays quiet when the request fails', async () => {
    const context = await connectedContext();

    await expect(useSessionActions(context).fetchHomePath()).resolves.toBeUndefined();
    expect(context.homePath.value).toBe('');
  });
});
