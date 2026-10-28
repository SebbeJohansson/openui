/**
 * Fixture data for the fake OpenCode server.
 *
 * A seed is the whole world an end-to-end test runs against: the projects that
 * exist, the sessions in them and each session's history. Nothing about the
 * machine running the test leaks in, so a spec can name `ses_alpha` and know
 * exactly what it is.
 */

export type SeedProject = {
  id: string;
  worktree: string;
  name?: string;
  branch?: string;
};

export type SeedMessage = {
  role: 'user' | 'assistant';
  text: string;
};

export type SeedSession = {
  id: string;
  projectID: string;
  directory: string;
  title: string;
  /** Set to make the session a subagent of another one. */
  parentID?: string;
  status?: 'busy' | 'idle' | 'retry';
  /** Sort key; the newest session is the one the app selects by default. */
  created?: number;
  messages?: SeedMessage[];
  todos?: Array<{ content: string; status?: string; priority?: string }>;
};

export type Seed = {
  home: string;
  projects: SeedProject[];
  sessions: SeedSession[];
};

/** One project, two root sessions, one message each. The default fixture. */
export const twoSessions: Seed = {
  home: '/home/dev',
  projects: [{ id: 'p1', worktree: '/home/dev/api', name: 'api', branch: 'main' }],
  sessions: [
    {
      id: 'ses_alpha',
      projectID: 'p1',
      directory: '/home/dev/api',
      title: 'Fix the login bug',
      created: 1_000,
      messages: [{ role: 'user', text: 'why is login broken' }],
      todos: [{ content: 'Reproduce the 401', status: 'in_progress' }],
    },
    {
      id: 'ses_beta',
      projectID: 'p1',
      directory: '/home/dev/api',
      title: 'Add rate limiting',
      created: 2_000,
      messages: [{ role: 'user', text: 'add a rate limiter' }],
    },
  ],
};
