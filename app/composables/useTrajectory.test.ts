import { beforeEach, describe, expect, it } from 'vitest';
import type { MessageInfo, MessagePart } from '~/types/sse';
import { useMessages } from './useMessages';
import { buildTrajectory } from './useTrajectory';

const SESSION = 'ses_1';

function userMessage(id: string, overrides: Partial<MessageInfo> = {}): MessageInfo {
  return {
    id,
    sessionID: SESSION,
    role: 'user',
    time: { created: 1_000 },
    ...overrides,
  } as MessageInfo;
}

function assistantMessage(id: string, parentID: string): MessageInfo {
  return {
    id,
    sessionID: SESSION,
    role: 'assistant',
    parentID,
    time: { created: 2_000, completed: 3_000 },
    modelID: 'model-x',
    providerID: 'provider-y',
    agent: 'build',
    path: { cwd: '/w', root: '/w' },
    cost: 0,
    tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
  } as unknown as MessageInfo;
}

function textPart(id: string, messageID: string, text: string, extra: Partial<MessagePart> = {}) {
  return {
    id,
    sessionID: SESSION,
    messageID,
    type: 'text',
    text,
    time: { start: 1_100 },
    ...extra,
  } as MessagePart;
}

describe('buildTrajectory', () => {
  let msg: ReturnType<typeof useMessages>;

  beforeEach(() => {
    msg = useMessages();
    // The store is a module-level singleton shared by the whole app.
    msg.reset();
  });

  it('emits a system record once, then again only when the prompt changes', () => {
    msg.updateMessage(userMessage('m1', { system: 'first prompt' }));
    msg.updateMessage(userMessage('m2', { system: 'first prompt' }));
    msg.updateMessage(userMessage('m3', { system: 'second prompt' }));

    const titles = buildTrajectory(msg)
      .events.filter((event) => event.kind === 'system')
      .map((event) => event.title);
    expect(titles).toEqual(['Initial System Prompt', 'System Prompt Updated']);
  });

  it('classifies harness-injected text as context, not user input', () => {
    msg.updateMessage(userMessage('m1'));
    msg.updatePart(textPart('p1', 'm1', 'what humans type'));
    msg.updatePart(textPart('p2', 'm1', '<system-reminder>injected</system-reminder>'));
    msg.updatePart(textPart('p3', 'm1', 'marked synthetic', { synthetic: true } as never));

    const kinds = buildTrajectory(msg)
      .events.filter((event) => event.kind === 'user' || event.kind === 'context')
      .map((event) => event.kind);
    expect(kinds).toEqual(['user', 'context', 'context']);
  });

  it('merges a tool call and its result into one record', () => {
    msg.updateMessage(userMessage('m1'));
    msg.updateMessage(assistantMessage('m2', 'm1'));
    msg.updatePart({
      id: 'p1',
      sessionID: SESSION,
      messageID: 'm2',
      type: 'tool',
      callID: 'call-1',
      tool: 'bash',
      state: { status: 'running', input: { command: 'ls' }, time: { start: 2_100 } },
    } as unknown as MessagePart);
    msg.updatePart({
      id: 'p2',
      sessionID: SESSION,
      messageID: 'm2',
      type: 'tool',
      callID: 'call-1',
      tool: '',
      state: {
        status: 'completed',
        input: {},
        output: 'a\nb',
        time: { start: 2_100, end: 2_400 },
      },
    } as unknown as MessagePart);

    const toolEvents = buildTrajectory(msg).events.filter((event) => event.kind === 'tool');
    expect(toolEvents).toHaveLength(1);
    const [tool] = toolEvents;
    expect(tool?.toolName).toBe('bash');
    expect(tool?.status).toBe('completed');
    expect(tool?.result).toBe('a\nb');
    expect(tool?.durationMs).toBe(300);
    expect(Array.isArray(tool?.raw)).toBe(true);
  });

  it('counts turns and tool calls in the stats', () => {
    msg.updateMessage(userMessage('m1'));
    msg.updatePart(textPart('p1', 'm1', 'hello'));
    msg.updateMessage(assistantMessage('m2', 'm1'));
    msg.updatePart(textPart('p2', 'm2', 'hi back'));

    const { stats } = buildTrajectory(msg);
    expect(stats.turns).toBe(1);
    expect(stats.inputTokens).toBe(10);
    expect(stats.outputTokens).toBe(5);
  });
});
