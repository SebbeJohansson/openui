/** Session as listed in pickers and side panels (view model over worker state). */
export type SessionEntry = {
  id: string;
  projectID?: string;
  projectId?: string;
  parentID?: string;
  title?: string;
  slug?: string;
  status?: 'busy' | 'idle' | 'retry';
  directory?: string;
  source?: 'claude' | 'opencode';
  time?: {
    created?: number;
    updated?: number;
    archived?: number;
  };
  revert?: {
    messageID: string;
    partID?: string;
    snapshot?: string;
    diff?: string;
  };
};

export type WorktreeInfo = {
  name: string;
  branch: string;
  directory: string;
};

export type SessionRetryStatus = {
  message: string;
  next: number;
  attempt: number;
};
