/**
 * translator.ts
 * Converts Claude Code stream-json events into the OpenCode SSE envelope format
 * so the existing Vue app can consume them without changes.
 *
 * OpenCode SSE envelope:
 *   { directory: string, payload: { type: string, properties: Record<string,unknown> } }
 */

import type {
  ClaudeStreamEvent,
  ClaudeAssistantMessage,
  ClaudeUserMessage,
  ClaudeResultMessage,
  ClaudeControlRequest,
  ClaudeSystemInit,
  StoredUserEntry,
  StoredAssistantEntry,
  StoredEntry,
} from './types';
import type { ClaudeSessionMeta } from './storage';
import type { ClaudeSessionInfo, SseEnvelope } from '#shared/types/events';
import {
  CC_MSG_PREFIX,
  CC_PART_PREFIX,
  CC_PERM_PREFIX,
  ccProjectId,
  ccSessionId,
} from '#shared/utils/claude-ids';

// ---------------------------------------------------------------------------
// Envelope helpers
// ---------------------------------------------------------------------------

function envelope(
  directory: string,
  type: string,
  properties: Record<string, unknown>,
): SseEnvelope {
  return { directory, payload: { type, properties } };
}

// ---------------------------------------------------------------------------
// Session → OpenCode SessionInfo shape
// ---------------------------------------------------------------------------

export function sessionMetaToInfo(meta: ClaudeSessionMeta): ClaudeSessionInfo {
  return {
    id: ccSessionId(meta.id),
    slug: meta.id.slice(0, 8),
    projectID: ccProjectId(meta.projectID),
    directory: meta.directory,
    title: meta.title,
    version: '0',
    time: {
      created: meta.timeCreated,
      updated: meta.timeUpdated,
    },
  };
}

// ---------------------------------------------------------------------------
// Live event translation: Claude stream-json → OpenCode SSE envelopes
// ---------------------------------------------------------------------------

/** Counter per session for synthetic message/part IDs */
const sessionCounters = new Map<string, { msgIdx: number; partIdx: number }>();

function counters(sessionId: string) {
  if (!sessionCounters.has(sessionId)) {
    sessionCounters.set(sessionId, { msgIdx: 0, partIdx: 0 });
  }
  return sessionCounters.get(sessionId)!;
}

/**
 * Translate one Claude stream-json event into zero or more OpenCode SSE envelopes.
 * `directory` is the session's working directory.
 * `sessionId` is the raw (non-prefixed) Claude session ID.
 */
export function translateEvent(
  event: ClaudeStreamEvent,
  sessionId: string,
  directory: string,
): SseEnvelope[] {
  const prefixedId = ccSessionId(sessionId);
  const out: SseEnvelope[] = [];

  switch (event.type) {
    case 'system': {
      const init = event as ClaudeSystemInit;
      if (init.subtype === 'init') {
        const projectID = ccProjectId(directory.replace(/\//g, '-'));
        // Emit session.created
        out.push(
          envelope(directory, 'session.created', {
            info: {
              id: prefixedId,
              slug: sessionId.slice(0, 8),
              projectID,
              directory,
              title: 'New session',
              version: '0',
              time: { created: Date.now(), updated: Date.now() },
            },
          }),
        );
        // Emit session.status busy
        out.push(
          envelope(directory, 'session.status', {
            sessionID: prefixedId,
            status: { type: 'busy' },
          }),
        );
      }
      break;
    }

    case 'assistant': {
      const msg = event as ClaudeAssistantMessage;
      const c = counters(sessionId);
      c.msgIdx++;
      const msgId = CC_MSG_PREFIX + sessionId + '_' + c.msgIdx;

      // Emit message.updated (assistant message info)
      out.push(
        envelope(directory, 'message.updated', {
          info: {
            id: msgId,
            sessionID: prefixedId,
            role: 'assistant',
            time: { created: Date.now() },
            parentID: CC_MSG_PREFIX + sessionId + '_' + (c.msgIdx - 1),
            modelID: msg.message.model ?? 'claude',
            providerID: 'claude',
            mode: 'normal',
            agent: 'claude',
            path: { cwd: directory, root: directory },
            cost: 0,
            tokens: {
              input: msg.message.usage?.input_tokens ?? 0,
              output: msg.message.usage?.output_tokens ?? 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
          },
        }),
      );

      // Translate content blocks to parts
      for (const block of msg.message.content) {
        c.partIdx++;
        const partId = CC_PART_PREFIX + sessionId + '_p' + c.partIdx;

        if (block.type === 'text') {
          out.push(
            envelope(directory, 'message.part.updated', {
              part: {
                id: partId,
                sessionID: prefixedId,
                messageID: msgId,
                type: 'text',
                text: block.text,
                time: { start: Date.now() },
              },
            }),
          );
        } else if (block.type === 'thinking') {
          out.push(
            envelope(directory, 'message.part.updated', {
              part: {
                id: partId,
                sessionID: prefixedId,
                messageID: msgId,
                type: 'reasoning',
                text: block.thinking,
                time: { start: Date.now() },
              },
            }),
          );
        } else if (block.type === 'tool_use') {
          out.push(
            envelope(directory, 'message.part.updated', {
              part: {
                id: partId,
                sessionID: prefixedId,
                messageID: msgId,
                type: 'tool',
                callID: block.id,
                tool: block.name,
                state: {
                  status: 'running',
                  input: block.input,
                  title: block.name,
                  time: { start: Date.now() },
                },
              },
            }),
          );
        } else if (block.type === 'tool_result') {
          // Find the matching tool part and mark it completed
          const outputRaw = block.content;
          const output =
            typeof outputRaw === 'string'
              ? outputRaw
              : Array.isArray(outputRaw)
                ? (outputRaw as Array<{ text?: string }>).map((b) => b.text ?? '').join('\n')
                : JSON.stringify(outputRaw);

          out.push(
            envelope(directory, 'message.part.updated', {
              part: {
                id: partId,
                sessionID: prefixedId,
                messageID: msgId,
                type: 'tool',
                callID: block.tool_use_id,
                tool: '',
                state: {
                  status: block.is_error ? 'error' : 'completed',
                  input: {},
                  output,
                  title: '',
                  metadata: {},
                  time: { start: Date.now(), end: Date.now() },
                },
              },
            }),
          );
        }
      }
      break;
    }

    case 'user': {
      // User messages echoed back from Claude — emit as message.updated
      const msg = event as ClaudeUserMessage;
      const c = counters(sessionId);
      c.msgIdx++;
      const msgId = CC_MSG_PREFIX + sessionId + '_' + c.msgIdx;

      out.push(
        envelope(directory, 'message.updated', {
          info: {
            id: msgId,
            sessionID: prefixedId,
            role: 'user',
            time: { created: Date.now() },
            agent: 'claude',
            model: { providerID: 'claude', modelID: 'claude' },
          },
        }),
      );

      // Text content as a text part
      for (const block of msg.message.content) {
        if (block.type === 'text') {
          c.partIdx++;
          const partId = CC_PART_PREFIX + sessionId + '_p' + c.partIdx;
          out.push(
            envelope(directory, 'message.part.updated', {
              part: {
                id: partId,
                sessionID: prefixedId,
                messageID: msgId,
                type: 'text',
                text: block.text,
              },
            }),
          );
        }
      }
      break;
    }

    case 'result': {
      const result = event as ClaudeResultMessage;
      const isError = result.subtype !== 'success';

      // Update session status
      out.push(
        envelope(directory, 'session.status', {
          sessionID: prefixedId,
          status: { type: isError ? 'idle' : 'idle' },
        }),
      );

      // Update session metadata (to refresh title etc.)
      out.push(
        envelope(directory, 'session.updated', {
          info: {
            id: prefixedId,
            slug: sessionId.slice(0, 8),
            projectID: ccProjectId(directory.replace(/\//g, '-')),
            directory,
            title: result.result?.slice(0, 80) ?? 'Claude session',
            version: '0',
            time: { created: Date.now(), updated: Date.now() },
          },
        }),
      );
      break;
    }

    case 'control_request': {
      const req = event as unknown as ClaudeControlRequest;
      if (req.request.subtype === 'can_use_tool') {
        // Translate to permission.asked
        const permId = CC_PERM_PREFIX + req.request_id;
        out.push(
          envelope(directory, 'permission.asked', {
            id: permId,
            sessionID: prefixedId,
            permission: req.request.tool_name,
            patterns: Object.keys(req.request.input ?? {}),
            metadata: { input: req.request.input, title: req.request.title },
            always: [],
          }),
        );
      }
      break;
    }

    default:
      break;
  }

  return out;
}

// ---------------------------------------------------------------------------
// History replay: translate stored JSONL entries into OpenCode SSE envelopes
// ---------------------------------------------------------------------------

export function translateStoredEntries(
  entries: StoredEntry[],
  sessionId: string,
  directory: string,
): SseEnvelope[] {
  const prefixedId = ccSessionId(sessionId);
  const out: SseEnvelope[] = [];
  const c = { msgIdx: 0, partIdx: 0 };

  // Build a map of tool_use id → partId for tool_result matching
  const toolUsePartMap = new Map<string, string>();

  for (const entry of entries) {
    if (entry.type === 'user') {
      const e = entry as StoredUserEntry;
      c.msgIdx++;
      const msgId = CC_MSG_PREFIX + sessionId + '_h' + c.msgIdx;
      const created = new Date(e.timestamp).getTime();

      out.push(
        envelope(directory, 'message.updated', {
          info: {
            id: msgId,
            sessionID: prefixedId,
            role: 'user',
            time: { created },
            agent: 'claude',
            model: { providerID: 'claude', modelID: 'claude' },
          },
        }),
      );

      const content = e.message?.content;
      const blocks =
        typeof content === 'string' ? [{ type: 'text', text: content }] : (content ?? []);

      for (const block of blocks) {
        if (block.type === 'text' && block.text) {
          // Strip IDE boilerplate for cleaner display
          const clean = block.text
            .replace(/<ide_selection>[\s\S]*?<\/ide_selection>/g, '')
            .replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>/g, '')
            .replace(/<[^>]+>/g, '')
            .trim();
          if (!clean) continue;
          c.partIdx++;
          const partId = CC_PART_PREFIX + sessionId + '_hp' + c.partIdx;
          out.push(
            envelope(directory, 'message.part.updated', {
              part: {
                id: partId,
                sessionID: prefixedId,
                messageID: msgId,
                type: 'text',
                text: clean,
              },
            }),
          );
        }
      }
    } else if (entry.type === 'assistant') {
      const e = entry as StoredAssistantEntry;
      c.msgIdx++;
      const msgId = CC_MSG_PREFIX + sessionId + '_h' + c.msgIdx;
      const created = new Date(e.timestamp).getTime();

      out.push(
        envelope(directory, 'message.updated', {
          info: {
            id: msgId,
            sessionID: prefixedId,
            role: 'assistant',
            time: { created },
            parentID: CC_MSG_PREFIX + sessionId + '_h' + (c.msgIdx - 1),
            modelID: e.message?.model ?? 'claude',
            providerID: 'claude',
            mode: 'normal',
            agent: 'claude',
            path: { cwd: directory, root: directory },
            cost: 0,
            tokens: {
              input: e.message?.usage?.input_tokens ?? 0,
              output: e.message?.usage?.output_tokens ?? 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
          },
        }),
      );

      for (const block of e.message?.content ?? []) {
        c.partIdx++;
        const partId = CC_PART_PREFIX + sessionId + '_hp' + c.partIdx;

        if (block.type === 'text' && block.text) {
          out.push(
            envelope(directory, 'message.part.updated', {
              part: {
                id: partId,
                sessionID: prefixedId,
                messageID: msgId,
                type: 'text',
                text: block.text,
              },
            }),
          );
        } else if (block.type === 'thinking' && block.thinking) {
          out.push(
            envelope(directory, 'message.part.updated', {
              part: {
                id: partId,
                sessionID: prefixedId,
                messageID: msgId,
                type: 'reasoning',
                text: block.thinking,
                time: { start: created },
              },
            }),
          );
        } else if (block.type === 'tool_use' && block.id) {
          toolUsePartMap.set(block.id, partId);
          out.push(
            envelope(directory, 'message.part.updated', {
              part: {
                id: partId,
                sessionID: prefixedId,
                messageID: msgId,
                type: 'tool',
                callID: block.id,
                tool: block.name ?? '',
                state: {
                  status: 'completed',
                  input: block.input ?? {},
                  output: '',
                  title: block.name ?? '',
                  metadata: {},
                  time: { start: created, end: created },
                },
              },
            }),
          );
        } else if (block.type === 'tool_result') {
          // Tool results are in user messages in the actual API format,
          // but some stored formats embed them in assistant. Handle both.
          const outputRaw = (block as { content?: unknown }).content;
          const output =
            typeof outputRaw === 'string'
              ? outputRaw
              : Array.isArray(outputRaw)
                ? (outputRaw as Array<{ text?: string }>).map((b) => b.text ?? '').join('\n')
                : '';
          // Update the corresponding tool_use part
          const existingPartId = toolUsePartMap.get(
            (block as { tool_use_id?: string }).tool_use_id ?? '',
          );
          out.push(
            envelope(directory, 'message.part.updated', {
              part: {
                id: existingPartId ?? partId,
                sessionID: prefixedId,
                messageID: msgId,
                type: 'tool',
                callID: (block as { tool_use_id?: string }).tool_use_id ?? '',
                tool: '',
                state: {
                  status: 'completed',
                  input: {},
                  output,
                  title: '',
                  metadata: {},
                  time: { start: created, end: created },
                },
              },
            }),
          );
        }
      }
    }
  }

  return out;
}
