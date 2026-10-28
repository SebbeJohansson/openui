import DiffViewer from '~/components/viewers/DiffViewer.vue';
import type { MessageDiffEntry } from '~/types/message';
import {
  COMMIT_SNAPSHOT_SCRIPT,
  FILE_SNAPSHOT_SCRIPT,
  buildWorktreeSnapshotScript,
  parseCommitSnapshotOutput,
  parseFileSnapshotOutput,
  type CommitSnapshotEntry,
  type WorktreeSnapshotMode,
} from '~/utils/gitSnapshotScripts';
import { guessLanguageFromPath } from '~/utils/toolWindowFormat';
import { defineFeature } from './useAppContext';
import { useFileViewers } from './useFileViewers';
import {
  FILE_VIEWER_WINDOW_HEIGHT,
  FILE_VIEWER_WINDOW_WIDTH,
  useFloatingCanvas,
} from './useFloatingCanvas';
import { usePtyOneshot } from './usePtyOneshot';

const BASH_ARGS = ['--noprofile', '--norc', '-c'];

/** Diff windows fed by git snapshots fetched through a one-shot PTY. */
export const useGitSnapshots = defineFeature('gitSnapshots', (context) => {
  const { fw, selection } = context;
  const { getFileViewerPosition } = useFloatingCanvas(context);
  const { shikiTheme } = useFileViewers(context);
  const { runOneShotPtyCommand } = usePtyOneshot({ activeDirectory: selection.activeDirectory });

  function windowOptions(title: string, pos: { x: number; y: number }) {
    return {
      closable: true,
      resizable: true,
      focusOnOpen: true,
      scroll: 'manual' as const,
      title,
      x: pos.x,
      y: pos.y,
      width: FILE_VIEWER_WINDOW_WIDTH,
      height: FILE_VIEWER_WINDOW_HEIGHT,
      expiry: Infinity,
    };
  }

  function toDiffTabs(files: CommitSnapshotEntry[]) {
    return files.length > 1
      ? files.map((entry) => ({
          file: entry.file,
          before: entry.before,
          after: entry.after,
          beforeBase64: entry.beforeBase64,
          afterBase64: entry.afterBase64,
        }))
      : undefined;
  }

  async function openGitDiff(payload: { path: string; staged: boolean }) {
    const { path, staged } = payload;
    const key = `git-diff:${staged ? 'staged' : 'changes'}:${path}`;
    if (fw.has(key)) {
      fw.bringToFront(key);
      return;
    }
    const mode = staged ? 'staged' : 'unstaged';
    const pos = getFileViewerPosition();
    await fw.open(key, {
      content: `Loading ${mode} diff for ${path}...`,
      lang: 'text',
      variant: 'plain',
      ...windowOptions(`${path} (${mode})`, pos),
    });
    try {
      const output = await runOneShotPtyCommand('bash', [
        ...BASH_ARGS,
        FILE_SNAPSHOT_SCRIPT,
        '_',
        mode,
        path,
      ]);
      const snapshot = parseFileSnapshotOutput(output);
      if (!fw.has(key)) return;
      await fw.open(key, {
        component: DiffViewer,
        props: {
          path,
          isDiff: true,
          diffCode: snapshot.before,
          diffAfter: snapshot.after,
          diffCodeBase64: snapshot.beforeBase64,
          diffAfterBase64: snapshot.afterBase64,
          gutterMode: 'double',
          lang: guessLanguageFromPath(path),
          theme: shikiTheme.value,
        },
        ...windowOptions(`${path} (${mode})`, pos),
      });
    } catch {
      if (fw.has(key)) await fw.close(key);
    }
  }

  async function openAllGitDiff(mode: WorktreeSnapshotMode = 'all') {
    const key = `git-diff:${mode}`;
    if (fw.has(key)) {
      fw.bringToFront(key);
      return;
    }
    const pos = getFileViewerPosition();
    await fw.open(key, {
      content: 'Loading all changes...',
      lang: 'text',
      variant: 'plain',
      ...windowOptions('Loading...', pos),
    });
    try {
      const output = await runOneShotPtyCommand('bash', [
        ...BASH_ARGS,
        buildWorktreeSnapshotScript(mode),
      ]);
      const snapshot = parseCommitSnapshotOutput(output);
      const first = snapshot.files[0];
      if (!first) throw new Error('no files parsed from working tree snapshot');
      if (!fw.has(key)) return;
      const title =
        snapshot.files.length === 1 ? first.file : `${snapshot.files.length} files changed`;
      await fw.open(key, {
        component: DiffViewer,
        props: {
          path: first.file,
          isDiff: true,
          diffCode: first.before,
          diffAfter: first.after,
          diffCodeBase64: first.beforeBase64,
          diffAfterBase64: first.afterBase64,
          diffTabs: toDiffTabs(snapshot.files),
          gutterMode: 'double',
          lang: snapshot.files.length === 1 ? guessLanguageFromPath(first.file) : 'text',
          theme: shikiTheme.value,
        },
        ...windowOptions(title, pos),
      });
    } catch {
      if (fw.has(key)) await fw.close(key);
    }
  }

  function showMessageDiff(payload: { messageKey: string; diffs: MessageDiffEntry[] }) {
    const { messageKey, diffs } = payload;
    if (!diffs || diffs.length === 0) return;
    const key = `message-diff:${messageKey}`;
    if (fw.has(key)) {
      fw.bringToFront(key);
      return;
    }
    const hasBeforeAfter = diffs.some(
      (d) => typeof d.before === 'string' && typeof d.after === 'string',
    );
    const combinedDiff = hasBeforeAfter ? '' : diffs.map((d) => d.diff).join('\n');
    const fileCount = diffs.length;
    const firstFile = diffs[0]?.file ?? '';
    const title = fileCount === 1 ? firstFile : `${fileCount} files changed`;
    const diffTabs =
      hasBeforeAfter && fileCount > 1
        ? diffs
            .filter((d) => typeof d.before === 'string' && typeof d.after === 'string')
            .map((d) => ({ file: d.file, before: d.before!, after: d.after! }))
        : undefined;
    const pos = getFileViewerPosition();
    fw.open(key, {
      component: DiffViewer,
      props: {
        path: firstFile,
        isDiff: true,
        diffCode: hasBeforeAfter ? (diffs[0]?.before ?? '') : '',
        diffAfter: hasBeforeAfter ? (diffs[0]?.after ?? '') : undefined,
        diffPatch: hasBeforeAfter ? undefined : combinedDiff,
        diffTabs,
        gutterMode: hasBeforeAfter ? 'double' : 'none',
        lang: fileCount === 1 ? guessLanguageFromPath(firstFile) : 'text',
        theme: shikiTheme.value,
      },
      ...windowOptions(title, pos),
    });
  }

  async function showCommit(hashRaw: string) {
    const hash = hashRaw.trim();
    if (!/^[0-9a-f]{7,40}$/i.test(hash)) return;
    const key = `commit-diff:${hash}`;
    if (fw.has(key)) {
      fw.bringToFront(key);
      return;
    }
    const pos = getFileViewerPosition();
    await fw.open(key, {
      content: `Loading commit ${hash}...`,
      lang: 'text',
      variant: 'plain',
      ...windowOptions(`commit ${hash}`, pos),
    });
    try {
      const output = await runOneShotPtyCommand('bash', [
        ...BASH_ARGS,
        COMMIT_SNAPSHOT_SCRIPT,
        '_',
        hash,
      ]);
      const snapshot = parseCommitSnapshotOutput(output);
      const first = snapshot.files[0];
      if (!first) throw new Error('no files parsed from commit snapshot');
      if (!fw.has(key)) return;
      const title =
        snapshot.title ||
        (snapshot.files.length === 1 ? first.file : `${snapshot.files.length} files changed`);
      await fw.open(key, {
        component: DiffViewer,
        props: {
          path: first.file,
          isDiff: true,
          diffCode: first.before,
          diffAfter: first.after,
          diffCodeBase64: first.beforeBase64,
          diffAfterBase64: first.afterBase64,
          diffTabs: toDiffTabs(snapshot.files),
          gutterMode: 'double',
          lang: snapshot.files.length === 1 ? guessLanguageFromPath(first.file) : 'text',
          theme: shikiTheme.value,
        },
        ...windowOptions(title, pos),
      });
    } catch {
      if (fw.has(key)) await fw.close(key);
    }
  }

  return { openGitDiff, openAllGitDiff, showMessageDiff, showCommit };
});
