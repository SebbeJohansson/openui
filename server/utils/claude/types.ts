/**
 * Claude Code CLI wire protocol types.
 * Covers the stream-json stdout events and stdin control messages.
 */

// ---------------------------------------------------------------------------
// Outbound: Claude → proxy (stdout, newline-delimited JSON)
// ---------------------------------------------------------------------------

export interface ClaudeSystemInit {
  type: 'system';
  subtype: 'init';
  session_id: string;
  tools: string[];
  mcp_servers: unknown[];
  model: string;
  permissionMode: string;
  apiKeySource: string;
  cwd: string;
}

export interface ClaudeAssistantMessage {
  type: 'assistant';
  message: {
    id: string;
    type: 'message';
    role: 'assistant';
    content: ClaudeContentBlock[];
    model: string;
    stop_reason: string | null;
    stop_sequence: string | null;
    usage: { input_tokens: number; output_tokens: number };
  };
  session_id: string;
}

export type ClaudeContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: unknown; is_error?: boolean };

export interface ClaudeUserMessage {
  type: 'user';
  message: {
    role: 'user';
    content: ClaudeContentBlock[];
  };
  session_id: string;
}

export interface ClaudeResultMessage {
  type: 'result';
  subtype: 'success' | 'error_max_turns' | 'error_during_execution';
  session_id: string;
  total_cost_usd: number;
  duration_ms: number;
  num_turns: number;
  result?: string;
  is_error?: boolean;
}

export interface ClaudeControlRequest {
  type: 'control_request';
  request_id: string;
  request: ClaudeCanUseTool | ClaudeInitialize;
}

export interface ClaudeCanUseTool {
  subtype: 'can_use_tool';
  tool_name: string;
  input: Record<string, unknown>;
  tool_use_id: string;
  agent_id: string | null;
  title: string;
  display_name: string;
  description: string;
  permission_suggestions: string[];
  blocked_path: string | null;
  decision_reason: string | null;
  matched_ask_rule: { source: string; tool_name: string; rule_content: string } | null;
}

export interface ClaudeInitialize {
  subtype: 'initialize';
  pending_permission_requests: unknown[];
  pending_user_dialog_requests: unknown[];
}

export interface ClaudeControlCancelRequest {
  type: 'control_cancel_request';
  request_id: string;
}

export type ClaudeStreamEvent =
  | ClaudeSystemInit
  | ClaudeAssistantMessage
  | ClaudeUserMessage
  | ClaudeResultMessage
  | ClaudeControlRequest
  | ClaudeControlCancelRequest;

// ---------------------------------------------------------------------------
// Inbound: proxy → Claude (stdin, newline-delimited JSON)
// ---------------------------------------------------------------------------

export interface ClaudeControlResponse {
  type: 'control_response';
  response: ClaudeControlResponseSuccess | ClaudeControlResponseError;
}

export interface ClaudeControlResponseSuccess {
  subtype: 'success';
  request_id: string;
  response: ClaudeAllowResponse | ClaudeDenyResponse;
}

export interface ClaudeControlResponseError {
  subtype: 'error';
  request_id: string;
  error: string;
}

export interface ClaudeAllowResponse {
  behavior: 'allow';
  updatedInput: Record<string, unknown>;
  toolUseID: string;
}

export interface ClaudeDenyResponse {
  behavior: 'deny';
  message: string;
  toolUseID: string;
}

// ---------------------------------------------------------------------------
// Stored JSONL entry shapes (from ~/.claude/projects/<dir>/<session>.jsonl),
// shared with my-widget through agent-conduit
// ---------------------------------------------------------------------------

export type {
  StoredAssistantEntry,
  StoredEntry,
  StoredSummaryEntry,
  StoredUserEntry,
} from 'agent-conduit';
