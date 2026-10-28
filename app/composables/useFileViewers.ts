import { ref } from 'vue';
import { bundledThemes } from 'shiki/bundle/web';
import ContentViewer from '~/components/viewers/ContentViewer.vue';
import * as opencodeApi from '~/utils/opencode';
import { splitFileContentDirectoryAndPath } from '~/utils/path';
import { toErrorMessage } from '~/utils/strings';
import { toUint8ArrayFromBase64 } from '~/utils/gitSnapshotScripts';
import { guessLanguageFromPath } from '~/utils/toolWindowFormat';
import { defineFeature } from './useAppContext';
import {
  FILE_VIEWER_WINDOW_HEIGHT,
  FILE_VIEWER_WINDOW_WIDTH,
  useFloatingCanvas,
} from './useFloatingCanvas';
import { useSessionCatalog } from './useSessionCatalog';

export type FileContentResponse = {
  content?: string;
  encoding?: string;
  type?: 'text' | 'binary';
};

function getBundledThemeNames() {
  if (Array.isArray(bundledThemes)) {
    return bundledThemes
      .map((theme) => {
        if (typeof theme === 'string') return theme;
        if (theme && typeof theme === 'object' && 'name' in theme) return String(theme.name ?? '');
        return '';
      })
      .filter((name) => name.length > 0);
  }
  return Object.keys(bundledThemes);
}

function pickShikiTheme(names: string[]) {
  if (names.length === 0) return 'github-dark';
  const preferred = [
    'github-dark',
    'github-dark-dimmed',
    'vitesse-dark',
    'dark-plus',
    'nord',
    'dracula',
    'monokai',
  ];
  for (const theme of preferred) {
    if (names.includes(theme)) return theme;
  }
  const darkMatch = names.find((name) => /dark|night|nord|dracula|monokai/i.test(name));
  return darkMatch ?? names[0];
}

/** Decode a `/file/content` response body (utf-8 or base64) to text. */
export function decodeApiTextContent(data: FileContentResponse) {
  const encoding = typeof data?.encoding === 'string' ? data.encoding : 'utf-8';
  const content = typeof data?.content === 'string' ? data.content : '';
  if (!content) return '';
  if (encoding !== 'base64') return content;
  const bytes = toUint8ArrayFromBase64(content);
  try {
    return new TextDecoder().decode(bytes);
  } catch {
    return atob(content);
  }
}

export function toFileViewerKey(path: string, lines?: string) {
  if (!lines) return `file-viewer:${path}`;
  return `file-viewer:${path}:${lines}`;
}

/** Floating windows that show a file (text, binary hexdump or image). */
export const useFileViewers = defineFeature('fileViewers', (context) => {
  const { fw, selection } = context;
  const { activeDirectory } = selection;
  const { getFileViewerPosition } = useFloatingCanvas(context);
  const { resolveWorktreeRelativePath } = useSessionCatalog(context);

  /** Shiki theme used by code windows; the first bundled dark theme available. */
  const shikiTheme = ref(pickShikiTheme(getBundledThemeNames()) ?? 'github-dark');

  function toFileViewerTitle(path: string, lines?: string) {
    const base = resolveWorktreeRelativePath(path) || path;
    if (!lines) return base;
    return `${base}:${lines}`;
  }

  function openImage(payload: { url: string; filename: string }) {
    const { url, filename } = payload;
    const key = `image-viewer:${url}`;
    if (fw.has(key)) {
      fw.bringToFront(key);
      return;
    }
    const pos = getFileViewerPosition();
    fw.open(key, {
      component: ContentViewer,
      props: { path: filename, imageSrc: url },
      closable: true,
      resizable: true,
      focusOnOpen: true,
      scroll: 'manual',
      title: filename || 'Image',
      x: pos.x,
      y: pos.y,
      width: 800,
      height: 600,
      expiry: Infinity,
    });
  }

  async function openFileViewer(path: string, lines?: string) {
    const key = toFileViewerKey(path, lines);
    if (fw.has(key)) {
      fw.bringToFront(key);
      return;
    }
    const pos = getFileViewerPosition(0.18, 0.14);
    const lang = guessLanguageFromPath(path);
    fw.open(key, {
      component: ContentViewer,
      props: { path, lang, lines, gutterMode: 'default', theme: shikiTheme.value },
      closable: true,
      resizable: true,
      focusOnOpen: true,
      scroll: 'manual',
      title: toFileViewerTitle(path, lines),
      x: pos.x,
      y: pos.y,
      width: FILE_VIEWER_WINDOW_WIDTH,
      height: FILE_VIEWER_WINDOW_HEIGHT,
      expiry: Infinity,
    });
    const directory = activeDirectory.value.trim();
    const showRaw = (rawHtml: string) =>
      fw.updateOptions(key, {
        props: { path, rawHtml, lines, gutterMode: 'none', theme: shikiTheme.value },
      });
    if (!directory) {
      showRaw('No active directory selected.');
      return;
    }

    try {
      const requestPath = splitFileContentDirectoryAndPath(path, directory);
      const data = (await opencodeApi.readFileContent({
        directory: requestPath.directory,
        path: requestPath.path,
      })) as FileContentResponse;
      const type = data?.type === 'binary' ? 'binary' : 'text';
      const encoding = typeof data?.encoding === 'string' ? data.encoding : 'utf-8';
      const content = typeof data?.content === 'string' ? data.content : '';
      if (type === 'binary' || encoding === 'base64') {
        if (!content) {
          showRaw(
            'Binary content is not included in this API response.\nUnable to render hexdump for this file.',
          );
          return;
        }
        fw.updateOptions(key, {
          props: {
            path,
            binaryBase64: content,
            lang: guessLanguageFromPath(path),
            lines,
            gutterMode: 'default',
            theme: shikiTheme.value,
          },
        });
        return;
      }
      fw.updateOptions(key, {
        props: {
          path,
          fileContent: content,
          lang: guessLanguageFromPath(path),
          lines,
          gutterMode: 'default',
          theme: shikiTheme.value,
        },
      });
    } catch (error) {
      showRaw(`File load failed: ${toErrorMessage(error)}`);
    }
  }

  return { shikiTheme, toFileViewerTitle, openFileViewer, openImage };
});
