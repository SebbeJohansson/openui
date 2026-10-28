# Projects & Sessions

## Data Model

The state graph uses a **project-first tree model**:

```
Project (keyed by projectID)
 ├─ worktree (the primary directory)
 └─ Sandboxes (keyed by directory)
     ├─ name (VCS branch name)
     ├─ rootSessions[] (display order)
     └─ sessions (flat: roots plus all descendants)
         ├─ Session (root)
         │   └─ Session (child)  ← subagent sessions
         └─ Session (root)
```

### Tree Structure

The primary data structure is `ServerState` (`app/types/worker-state.ts`):

```typescript
type ServerState = {
  projects: Record<string, ProjectState>; // keyed by projectID
};

type ProjectState = {
  id: string;
  name?: string;
  worktree: string; // primary worktree directory
  sandboxes: Record<string, SandboxState>; // keyed by directory
};
```

**Key insight**: ProjectID is the first-class citizen. Directories are keys
within a project. The builder keeps a `projectIdByDirectory` reverse index so a
directory can be mapped back to its owning project in O(1) — that is what
`resolveProjectIdForDirectory()` reads.

This inverts the older `sessionGraph.ts` model, which nested
`tree[worktree][sandbox]` and treated projectID as a mere session namespace.

### Worktree

A project's primary directory, selected via the top-left dropdown. Typically the
root of a git repository.

- Example: `/home/user/prog/vis`
- The API exposes this as `ProjectInfo.worktree`.
- Stored as `projects[projectID].worktree`, and always also present as a sandbox
  key, so `sandboxes[worktree]` exists for every project.

### Sandbox

A directory belonging to a project. Can be:

- The worktree itself (`sandbox == worktree`)
- A git worktree (`/path/to/.git/worktrees/...`)
- A sandbox directory (`ProjectInfo.sandboxes[]`)

- Example: `/home/user/prog/vis`, `/home/user/.local/share/opencode/worktree/.../neon-canyon`
- Passed to the API as `?directory=` query parameter or `x-opencode-directory` header.
- Stored as `projects[projectID].sandboxes[directory]`.

### ProjectID

An identifier assigned by OpenCode to each project (SHA hash string), taken
from `ProjectInfo.id`.

- Example: `95c06a8380e966d762e14efc434b1111b7169ab7`
- Used directly as the key into `state.projects`.
- The literal id `global` is a special case: it names the fallback project,
  worktree `/`, for sessions that belong to no project on disk. It never reports
  sandboxes, so sandbox pruning is skipped for it and directories learned from
  `session.created` survive.

### Session

A conversation session belonging to a specific project.

- Sessions without a `parentID` are **root sessions**, listed in
  `sandbox.rootSessions` and shown in the top-right session list.
- Sessions with a `parentID` are **child sessions**, created by subagents. They
  live in the _root_ session's sandbox, not their own directory, and are pruned
  20 minutes after going idle.

## API and Directory

Most API calls require a `?directory=` parameter or `x-opencode-directory` header to specify the directory. Without it, the server defaults to its startup working directory, which is not robust.

### Building the Tree from APIs

The graph is built from three primary APIs:

| API                        | Purpose                                        | State Update                                                     |
| -------------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| `GET /project`             | List all projects with worktrees and sandboxes | `applyProjects()` → create `projects[id]` and its sandbox keys   |
| `GET /session?directory=X` | List root sessions for a directory             | `applySessions()` → place sessions under their project's sandbox |
| `GET /session/status?...`  | Per-session busy/idle/retry                    | `applyStatuses()` → set `SessionState.status`                    |

VCS branch names come from `getVcsInfo(directory)` and land on
`sandbox.name` via `applyVcsInfo()`.

### Enumerating Sandboxes

A single project may have multiple sandboxes:

- The worktree itself (`ProjectInfo.worktree`)
- Sandboxes (`ProjectInfo.sandboxes[]`)
- Directories first seen on a `session.created` event

`applyProject()` unions the worktree with `sandboxes[]`, then prunes any sandbox
key not in that set — except for the `global` project, which reports none.

## SSE Events

`GET /global/event` delivers events across all projects in a single stream.

Session-related events:

| Event                | Key Fields                                                               | State Update                                                          |
| -------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `session.created`    | `info.id`, `info.projectID`, `info.directory`                            | Register the directory as a sandbox, then upsert the session          |
| `session.updated`    | `info.id`, `info.projectID`, `info.directory`, `info.title`, `info.time` | Update session metadata; re-sort `rootSessions` by `timeUpdated`      |
| `session.status`     | `sessionID`, `status.type` (`busy` / `idle` / `retry`)                   | Set `SessionState.status`; recheck `isSessionTreeIdle()` for the root |
| `session.deleted`    | `sessionID`                                                              | Remove the session                                                    |
| `project.updated`    | `id`, `worktree`, `sandboxes[]`                                          | `applyProject()`: sync worktree, name, icon, and sandbox keys         |
| `vcs.branch.updated` | `directory`, `branch`                                                    | Set `sandboxes[directory].name = branch`                              |
| `worktree.ready`     | `directory`, `branch`                                                    | Forwarded to clients; the branch is applied via `vcs.branch.updated`  |

Each `process*` handler returns the projectID it changed (or `null` when nothing
changed), and the worker rebroadcasts only that project's slice.

## State Builder (stateBuilder)

`app/utils/stateBuilder.ts` is the **single source of truth (SSOT)** for:

- The project-first tree: `projects[projectId].sandboxes[directory]`
- All known sessions, root and descendant alike
- Session status (busy/idle/retry)

Only the SharedWorker constructs one (`createStateBuilder()` in
`app/workers/sse-shared-worker.ts`); the client mirrors the state it broadcasts.

### State shape

`ServerState` and `ProjectState` are shown under [Tree Structure](#tree-structure)
above. The remaining piece, from `app/types/worker-state.ts`:

```typescript
type SandboxState = {
  directory: string;
  name: string; // VCS branch name
  rootSessions: string[]; // ordered root session IDs, for display
  sessions: Record<string, SessionState>; // flat: root plus all descendants
};
```

Note the two deliberate choices baked into `SandboxState`:

- **Every descendant session is stored under its root session's sandbox**, not
  under its own directory. `sessions` is flat, so a subagent three levels deep
  sits beside its root.
- **`rootSessions` carries display order**, sorted by `timeUpdated` descending.
  `sessions` is an unordered map; do not iterate it for UI order.

### Sessions

Each session is a `SessionState`:

| Field         | Description                                               |
| ------------- | --------------------------------------------------------- |
| `id`          | Session ID (`ses_...`)                                    |
| `parentID`    | Parent session ID (`undefined` for root sessions)         |
| `status`      | This session's own status: `busy` / `idle` / `retry`      |
| `directory`   | The session's own directory                               |
| `title`       | Display title                                             |
| `slug`        | URL slug                                                  |
| `timeCreated` | Creation timestamp                                        |
| `timeUpdated` | Last-update timestamp; sorts `rootSessions`               |
| `permission`  | Session-scoped permission rules for the permissions panel |

Child sessions are pruned 20 minutes after they go idle
(`CHILD_SESSION_PRUNE_TTL_MS`).

### Public API

`createStateBuilder()` returns:

**Snapshot loaders** — for the initial REST fetch:

- `applyProjects(projects)`
- `applySessions(sessions)`
- `applyStatuses(statuses)`
- `applyVcsInfo(info)`

**Event processors** — one per SSE event, each returning the projectID it
touched (or `undefined`) so the worker knows what to rebroadcast:

- `processSessionCreated(info)`
- `processSessionUpdated(info)`
- `processSessionDeleted(sessionId, projectId?)`
- `processSessionStatus(sessionId, status, projectId?)`
- `processProjectUpdated(info)`
- `processVcsBranchUpdated(directory, branch)`

**Mutations and lookups:**

- `registerSandboxDirectory(projectId, directory)` → creates a sandbox entry if missing
- `applySessionMutated(info)` / `applySessionRemoved(...)` → generic session upsert/remove
- `resolveProjectIdForDirectory(directory)` → maps a directory to its owning project
- `resolveRootSessionIdForProject(projectId, sessionId)` → walks `parentID` up to the root
- `isSessionTreeIdle(projectId, rootSessionId)` → true when the root and every descendant are idle
- `getState()` → the full `ServerState`
- `getProject(projectId)` / `getDefaultProjectId()`

`resolveProjectColorHex(raw)` is exported separately and maps OpenCode's named
project colors (pink, mint, orange, purple, cyan, lime) to hex.

### Where this state lives

The worker owns the project graph; the client mirrors it and derives read models
from it. Nothing is stored twice.

| Piece                                                                                     | Owner                                     |
| ----------------------------------------------------------------------------------------- | ----------------------------------------- |
| `projects` (the graph)                                                                    | `useServerState`, fed by the SharedWorker |
| `selectedProjectId`, `selectedSessionId`, `projectDirectory`, `activeDirectory`           | `useSessionSelection`                     |
| `sessions`, `sessionsByProject`, `topPanelTreeData`, `navigableTree`, `allowedSessionIds` | `useSessionCatalog` (computed)            |
| Selection mirrored into `?project=&session=`                                              | `useSelectionRouting`                     |
| Create / delete / archive / fork / revert                                                 | `useSessionActions`                       |

All of these are reached through `useAppContext()`, which is provided once by
`app/pages/index.vue`.

### Session Fetching Flow

`bootstrapState()` in `app/workers/sse-shared-worker.ts` builds a fresh
`stateBuilder` from REST, then swaps it in and broadcasts `state.bootstrap`:

```
1. Bootstrap
   a. listProjects()                    → applyProjects(projects)
   b. Collect every directory: '' plus each project's worktree and sandboxes
   c. Per directory, in parallel:
        listSessions({ directory, roots: true }) → applySessions(sessions)
        getSessionStatusMap(directory)           → applyStatuses(statuses)
   d. Per directory, in parallel:
        getVcsInfo(directory)           → applyVcsInfo(directory, { branch })
   e. getDefaultProjectId(), then broadcast state.bootstrap
2. SSE events (real-time updates)
   a. project.updated     → processProjectUpdated(info)
   b. session.created     → processSessionCreated(info)
   c. session.updated     → processSessionUpdated(info)
   d. session.deleted     → processSessionDeleted(sessionId, projectId?)
   e. session.status      → processSessionStatus(sessionId, status, projectId?)
   f. vcs.branch.updated  → processVcsBranchUpdated(directory, branch)
```

Each `process*` call returns the projectID it touched, and the worker
rebroadcasts only that project's slice.

### Watcher Architecture

Each watcher lives in the feature that owns its effect, and handles one concern:

| Watcher                                                  | Feature                | Effect                                                |
| -------------------------------------------------------- | ---------------------- | ----------------------------------------------------- |
| `[projectDirectory, activeDirectory, selectedSessionId]` | `useAppBootstrap`      | Pick a session for the new directory; reload commands |
| `filteredSessions`                                       | `useAppBootstrap`      | Keep the selection valid as sessions come and go      |
| `selectedSessionId`                                      | `useAppBootstrap`      | Reset the view and load history                       |
| `selectedSessionId`                                      | `useComposer`          | Swap in that session's draft                          |
| `selectedSessionId`, `selectedProjectId`                 | `useSelectionRouting`  | Mirror the selection into the URL                     |
| `allowedSessionIds`                                      | `usePermissionRouting` | Drop prompts for sessions out of scope                |
| `isThinking`                                             | `useComposer`          | Expire reasoning windows once idle                    |
| `hiddenModels`, `selectedModel`                          | `useProviderCatalog`   | Keep the model selection valid                        |
