import { reactive } from 'vue';
import GlobContent from '~/components/ToolWindow/Glob.vue';
import GrepContent from '~/components/ToolWindow/Grep.vue';
import ReasoningContent from '~/components/ToolWindow/Reasoning.vue';
import WebContent from '~/components/ToolWindow/Web.vue';
import ThreadHistoryContent from '~/components/ThreadHistoryContent.vue';
import type { MessagePart, QuestionInfo, ReasoningPart, ToolPart } from '~/types/sse';
import type { FileNode } from './useFileTree';
import * as opencodeApi from '~/utils/opencode';
import { splitFileContentDirectoryAndPath } from '~/utils/path';
import {
  extractFileRead as extractToolFileRead,
  extractPatch as extractToolPatch,
} from '~/utils/toolRenderers';
import {
  formatGlobToolTitle,
  formatListToolTitle,
  formatQueryToolTitle,
  formatWebfetchToolTitle,
  guessLanguageFromPath,
  resolveReadRange,
  resolveReadWritePath,
  toolColor,
} from '~/utils/toolWindowFormat';
import { renderWorkerHtml } from '~/utils/workerRenderer';
import { defineFeature } from './useAppContext';
import { decodeApiTextContent, useFileViewers, type FileContentResponse } from './useFileViewers';

export type ThreadHistoryEntry =
  | { key: string; kind: 'message'; content: string; time: number; agent?: string }
  | { key: string; kind: 'tool'; part: ToolPart; time: number }
  | { key: string; kind: 'reasoning'; part: ReasoningPart; time: number }
  | {
      key: string;
      kind: 'question';
      questions: QuestionInfo[];
      status: 'pending' | 'replied' | 'rejected';
      answers?: string[][];
      time: number;
    };

const TOOL_WINDOW_HIDDEN = new Set([
  'question',
  'todoread',
  'todowrite',
  'lsp',
  'plan_enter',
  'plan_exit',
  'task',
]);
const TOOL_WINDOW_SUPPORTED = new Set([
  'apply_patch',
  'bash',
  'codesearch',
  'edit',
  'glob',
  'grep',
  'list',
  'multiedit',
  'read',
  'task',
  'webfetch',
  'websearch',
  'write',
]);

export function shouldRenderToolWindow(tool: string) {
  return !TOOL_WINDOW_HIDDEN.has(tool) && TOOL_WINDOW_SUPPORTED.has(tool);
}

export function formatToolValue(value: unknown) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function parseToolOutputText(output: unknown) {
  if (output === undefined) return undefined;
  if (typeof output === 'string') return output;
  if (output && typeof output === 'object') {
    const outputRecord = output as Record<string, unknown>;
    const outputContent =
      (outputRecord.content as string | undefined) ??
      (outputRecord.text as string | undefined) ??
      (outputRecord.body as string | undefined) ??
      (outputRecord.result as string | undefined);
    if (typeof outputContent === 'string') return outputContent;
    const parts: string[] = [];
    if (typeof outputRecord.stdout === 'string' && outputRecord.stdout.length > 0) {
      parts.push(outputRecord.stdout);
    }
    if (typeof outputRecord.stderr === 'string' && outputRecord.stderr.length > 0) {
      parts.push(outputRecord.stderr);
    }
    if (parts.length > 0) return parts.join('\n');
  }
  return formatToolValue(output);
}

export function formatTaskToolOutput(value: string) {
  return value
    .split('\n')
    .filter((line) => !/^task_id:\s*/i.test(line.trim()))
    .join('\n')
    .replace(/<\/?task_result>/gi, '')
    .trim();
}

/** Convert OpenCode's `*** Update File:` patch format into unified diff blocks. */
export function parsePatchTextBlocks(patchText: string) {
  const lines = patchText.split('\n');
  const blocks: Array<{ path?: string; content: string }> = [];
  let currentPath: string | undefined;
  let currentKind: 'update' | 'add' | 'delete' | undefined;
  let currentLines: string[] = [];

  const pushCurrent = () => {
    if (!currentPath || currentLines.length === 0) {
      currentPath = undefined;
      currentKind = undefined;
      currentLines = [];
      return;
    }
    blocks.push({ path: currentPath, content: currentLines.join('\n').trim() });
    currentPath = undefined;
    currentKind = undefined;
    currentLines = [];
  };

  const startFileBlock = (kind: 'update' | 'add' | 'delete', path: string) => {
    pushCurrent();
    currentPath = path.trim();
    currentKind = kind;
    currentLines = [`diff --git a/${currentPath} b/${currentPath}`];
    if (kind === 'add') {
      currentLines.push('--- /dev/null', `+++ b/${currentPath}`);
    } else if (kind === 'delete') {
      currentLines.push(`--- a/${currentPath}`, '+++ /dev/null');
    } else {
      currentLines.push(`--- a/${currentPath}`, `+++ b/${currentPath}`);
    }
  };

  for (const line of lines) {
    if (line.startsWith('*** Update File: ')) {
      startFileBlock('update', line.replace('*** Update File: ', ''));
      continue;
    }
    if (line.startsWith('*** Add File: ')) {
      startFileBlock('add', line.replace('*** Add File: ', ''));
      continue;
    }
    if (line.startsWith('*** Delete File: ')) {
      startFileBlock('delete', line.replace('*** Delete File: ', ''));
      continue;
    }
    if (line.startsWith('*** Move to: ') && currentPath && currentKind === 'update') {
      const moveTo = line.replace('*** Move to: ', '').trim();
      currentLines.push(`rename from ${currentPath}`, `rename to ${moveTo}`);
      currentPath = moveTo;
      continue;
    }
    if (!currentPath) continue;
    if (
      line.startsWith('@@') ||
      line.startsWith('+') ||
      line.startsWith('-') ||
      line.startsWith(' ') ||
      line.startsWith('\\')
    ) {
      currentLines.push(line);
    }
  }
  pushCurrent();
  return blocks;
}

export function renderEditDiffHtml(params: {
  diff: string;
  code?: string;
  after?: string;
  lang: string;
}): () => Promise<string> {
  return () =>
    renderWorkerHtml({
      id: `edit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      code: params.code ?? '',
      after: params.after,
      patch: params.diff,
      lang: params.lang,
      theme: 'github-dark',
      gutterMode: 'double',
    });
}

/**
 * Floating windows for tool calls (read/edit/grep/... output), plus the history
 * pop-ups opened from the thread history window.
 */
export const useToolWindows = defineFeature('toolWindows', (context) => {
  const { fw, selection } = context;
  const { activeDirectory } = selection;
  const { shikiTheme } = useFileViewers(context);

  /** Tool call ids currently running; drives the "thinking" indicator. */
  const runningToolIds = reactive(new Set<string>());
  const historyToolWindowKeys = new Set<string>();

  async function renderReadHtmlFromApi(params: {
    callId?: string;
    path?: string;
    lang: string;
    lineOffset?: number;
    lineLimit?: number;
    fallbackText?: string;
  }): Promise<string> {
    const id = `read-${params.callId ?? 'unknown'}-${Date.now().toString(36)}`;
    const renderText = (text: string, gutterMode: 'none' | 'single' = 'none') =>
      renderWorkerHtml({ id, code: text, lang: 'text', theme: 'github-dark', gutterMode });

    const directory = activeDirectory.value.trim();
    if (!directory) return renderText('No active directory selected for READ window.');
    if (!params.path) return renderText('READ path is missing in tool payload.');
    const requestPath = splitFileContentDirectoryAndPath(params.path, directory);

    try {
      const listData = await opencodeApi.listFiles({
        directory: requestPath.directory,
        path: requestPath.path,
      });
      if (Array.isArray(listData) && listData.length > 0) {
        const entries = listData
          .map((item) => {
            if (!item || typeof item !== 'object') return null;
            const record = item as FileNode;
            const name = record.name ?? record.path?.split('/').pop();
            if (!name) return null;
            return record.type === 'directory' ? `${name}/` : name;
          })
          .filter((entry): entry is string => Boolean(entry));
        return renderText(entries.length > 0 ? entries.join('\n') : '(empty directory)', 'none');
      }
    } catch {
      // Not a directory, or listing failed: read as file content below.
    }

    try {
      const data = (await opencodeApi.readFileContent({
        directory: requestPath.directory,
        path: requestPath.path,
      })) as FileContentResponse;
      if (data?.type === 'binary') {
        return renderText(`Binary file: ${params.path}\nPreview is not available.`, 'none');
      }
      return renderWorkerHtml({
        id,
        code: decodeApiTextContent(data),
        lang: params.lang,
        theme: 'github-dark',
        gutterMode: 'single',
        lineOffset: params.lineOffset,
        lineLimit: params.lineLimit,
      });
    } catch {
      if (params.fallbackText) {
        return renderWorkerHtml({
          id,
          code: params.fallbackText,
          lang: params.lang,
          theme: 'github-dark',
          gutterMode: 'single',
          lineOffset: params.lineOffset,
          lineLimit: params.lineLimit,
        });
      }
      return renderText(`Failed to load: ${params.path ?? 'unknown file'}`);
    }
  }

  /** Helper bundle handed to utils/toolRenderers. */
  const toolRendererHelpers = {
    FILE_READ_EVENT_TYPES: new Set(['session.diff', 'file.edited']),
    FILE_WRITE_EVENT_TYPES: new Set<string>([]),
    MESSAGE_EVENT_TYPES: new Set([
      'message.updated',
      'message.part.updated',
      'message.removed',
      'message.part.removed',
    ]),
    parsePatchTextBlocks,
    guessLanguage: guessLanguageFromPath,
    shouldRenderToolWindow,
    extractToolOutputText: parseToolOutputText,
    formatToolValue,
    renderWorkerHtml,
    renderReadHtmlFromApi,
    resolveReadWritePath,
    guessLanguageFromPath,
    resolveReadRange,
    renderEditDiffHtml,
    formatGlobToolTitle,
    formatListToolTitle,
    formatWebfetchToolTitle,
    formatQueryToolTitle,
    formatTaskToolOutput,
    GrepContent,
    GlobContent,
    WebContent,
  };

  function openToolPartAsWindow(
    toolPart: ToolPart,
    overrides?: Record<string, unknown>,
    keyPrefix?: string,
  ): string[] {
    const openedKeys: string[] = [];
    const payload = {
      type: 'message.part.updated',
      payload: { type: 'message.part.updated', properties: { part: toolPart } },
    };

    const patchEvents = extractToolPatch(payload, toolRendererHelpers as never);
    if (patchEvents) {
      patchEvents.forEach((patchEvent, index: number) => {
        const rawId = patchEvent.callId ?? `apply_patch:${index}`;
        const key = keyPrefix ? `${keyPrefix}${rawId}` : rawId;
        fw.open(key, {
          content: renderEditDiffHtml({
            diff: '',
            code: patchEvent.code,
            after: patchEvent.after,
            lang: patchEvent.lang ?? 'text',
          }),
          variant: 'diff',
          status:
            patchEvent.toolStatus === 'running' ||
            patchEvent.toolStatus === 'completed' ||
            patchEvent.toolStatus === 'error'
              ? patchEvent.toolStatus
              : undefined,
          title: patchEvent.title,
          color: toolColor(patchEvent.toolName),
          ...overrides,
        });
        openedKeys.push(key);
      });
      return openedKeys;
    }

    const fileReadResult = extractToolFileRead(
      payload,
      'message.part.updated',
      toolRendererHelpers as never,
    );
    const fileReads = fileReadResult
      ? Array.isArray(fileReadResult)
        ? fileReadResult
        : [fileReadResult]
      : null;
    if (!fileReads) return openedKeys;
    fileReads.forEach((entry: Record<string, unknown> & { callId?: string }) => {
      if (!entry.callId) return;
      const { callId, toolName, toolStatus, ...rest } = entry as Record<string, never> & {
        callId: string;
        toolName?: string;
        toolStatus?: string;
      };
      const key = keyPrefix ? `${keyPrefix}${callId}` : callId;
      fw.open(key, {
        ...rest,
        status:
          toolStatus === 'running' || toolStatus === 'completed' || toolStatus === 'error'
            ? toolStatus
            : undefined,
        color: toolColor(toolName ?? ''),
        ...overrides,
      });
      openedKeys.push(key);
    });
    return openedKeys;
  }

  function closeHistoryToolWindows() {
    for (const key of historyToolWindowKeys) fw.close(key);
    historyToolWindowKeys.clear();
  }

  function centeredWindow(winW: number, winH: number) {
    const { width, height } = fw.getExtent();
    return {
      x: Math.max(0, Math.round((width - winW) / 2)),
      y: Math.max(0, Math.round((height - winH) / 2)),
    };
  }

  function openHistoryTool(payload: { part: ToolPart }) {
    closeHistoryToolWindows();
    const { x, y } = centeredWindow(600, 400);
    const keys = openToolPartAsWindow(
      payload.part,
      {
        closable: true,
        resizable: true,
        focusOnOpen: true,
        expiry: Infinity,
        scroll: 'manual',
        x,
        y,
      },
      'history-tool:',
    );
    for (const key of keys) historyToolWindowKeys.add(key);
  }

  function openHistoryReasoning(payload: { part: ReasoningPart }) {
    closeHistoryToolWindows();
    const winW = 600;
    const winH = 400;
    const { x, y } = centeredWindow(winW, winH);
    const key = `history-reasoning:${payload.part.id}`;
    historyToolWindowKeys.add(key);
    fw.open(key, {
      component: ReasoningContent,
      props: { entries: [{ id: payload.part.id, text: payload.part.text }], theme: 'github-dark' },
      title: '🤔 Thought',
      scroll: 'manual',
      closable: true,
      resizable: true,
      focusOnOpen: true,
      color: '#8b5cf6',
      variant: 'message',
      expiry: Infinity,
      width: winW,
      height: winH,
      x,
      y,
    });
  }

  function showThreadHistory(payload: { entries: ThreadHistoryEntry[] }) {
    const entries = payload.entries;
    const key = 'thread-history';
    if (fw.has(key)) {
      fw.updateOptions(key, { props: { entries } });
      fw.bringToFront(key);
      return;
    }
    const winW = 720;
    const winH = 520;
    const { x, y } = centeredWindow(winW, winH);
    fw.open(key, {
      component: ThreadHistoryContent,
      props: {
        entries,
        theme: shikiTheme.value,
        onToolClick: (part: ToolPart) => openHistoryTool({ part }),
        onReasoningClick: (part: ReasoningPart) => openHistoryReasoning({ part }),
      },
      title: 'Thread History',
      scroll: 'follow',
      smoothEngine: 'native',
      closable: true,
      resizable: true,
      focusOnOpen: true,
      variant: 'message',
      expiry: Infinity,
      width: winW,
      height: winH,
      x,
      y,
      afterClose: closeHistoryToolWindows,
    });
  }

  /** Prompt for new text and PATCH the message part on the server. */
  async function editMessage(payload: { sessionId: string; part: MessagePart }) {
    const directory = activeDirectory.value.trim();
    if (payload.part.type !== 'text') return;
    const nextText = window.prompt('Edit message', payload.part.text);
    if (nextText === null) return;
    const trimmed = nextText.trimEnd();
    if (!trimmed || trimmed === payload.part.text) return;
    try {
      const part = { ...payload.part, text: trimmed };
      await opencodeApi.patchMessagePart({
        sessionID: payload.sessionId,
        messageID: part.messageID,
        partID: part.id,
        part,
        directory: directory || undefined,
      });
    } catch (error) {
      console.error('Failed to update message part', error);
    }
  }

  return {
    runningToolIds,
    toolRendererHelpers,
    renderReadHtmlFromApi,
    openToolPartAsWindow,
    closeHistoryToolWindows,
    openHistoryTool,
    openHistoryReasoning,
    showThreadHistory,
    editMessage,
  };
});
