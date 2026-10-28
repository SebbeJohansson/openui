/** Shapes returned by the OpenCode /config/providers, /agent and /command endpoints. */
export type ProviderModel = {
  id: string;
  name?: string;
  providerID?: string;
  variants?: Record<string, unknown>;
  limit?: {
    context?: number;
    input?: number;
    output?: number;
  };
  capabilities?: {
    attachment?: boolean;
  };
};

export type ProviderInfo = {
  id: string;
  name?: string;
  models?: Record<string, ProviderModel>;
};

export type ProviderResponse = {
  providers?: ProviderInfo[];
  default?: Record<string, string>;
};

export type AgentInfo = {
  name: string;
  description?: string;
  mode?: string;
  hidden?: boolean;
  color?: string;
  model?: {
    providerID: string;
    modelID: string;
  };
  variant?: string;
  /** Raw permission config from the server; shape varies, normalized on read. */
  permission?: unknown;
  /** Deprecated boolean tool map, still emitted for backwards compatibility. */
  tools?: Record<string, boolean>;
};

export type CommandInfo = {
  name: string;
  description?: string;
  agent?: string;
  model?: string;
  source?: string;
  template?: string;
  hints?: string[];
};

/** A selectable model in the composer, keyed `provider/model`. */
export type ModelOption = {
  id: string;
  modelID: string;
  label: string;
  displayName: string;
  providerID?: string;
  providerLabel?: string;
  variants?: Record<string, unknown>;
  attachmentCapable?: boolean;
};

export type AgentOption = { id: string; label: string; description?: string; color?: string };
