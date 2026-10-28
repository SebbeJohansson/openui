# Window / Viewer / Renderer Architecture

## Layer Overview

```
FloatingWindow  (window layer — drag, resize, z-index, titlebar)
└── component :is="..."  (viewer/renderer layer — content display)
```

`FloatingWindow` is a generic window shell managed by `useFloatingWindows`.
The `entry.component` plugged into each window determines what gets rendered.

The feature composables pick the appropriate Viewer depending on the use case:

| Use case              | component          |
| --------------------- | ------------------ |
| File / binary / image | `ContentViewer`    |
| Diff (git, message)   | `DiffViewer`       |
| Debug text dump       | `ContentViewer`    |
| Shell / terminal      | `ShellContent`     |
| Tool output (grep, …) | per-tool component |

---

## Renderer Layer

Renderers are **primitive, stateless display components**.
Each one knows how to draw a single kind of content — nothing more.

```
app/components/renderers/
├── CodeRenderer.vue       Syntax-highlighted source code + line highlighting
├── DiffRenderer.vue       Side-by-side / unified diff (with file tabs for multi-file diffs)
├── MarkdownRenderer.vue   markdown-it rendered HTML via Web Worker
├── ImageRenderer.vue      Zoomable / pannable image display
└── HexRenderer.vue        Hexdump display for binary content
```

### CodeRenderer

- Props: `path`, `fileContent`, `rawHtml`, `lang`, `isBinary`, `gutterMode`, `theme`, `lines`
- Uses `useCodeRender` composable + `CodeContent` for syntax highlighting
- Supports line-range highlighting via `lines` prop (e.g. `"5-10,20"`)
- Emits `rendered` after content is ready

### DiffRenderer

- Props: `path`, `diffCode`, `diffAfter`, `diffPatch`, `diffTabs`, `gutterMode`, `lang`, `theme`
- Renders diff output via `useCodeRender` with `after`/`patch` params
- Has its own file tabs when `diffTabs` contains multiple entries
- Emits `rendered`

### MarkdownRenderer

- Props: `code`, `lang`, `theme`, `html`, `files`, `copyButton`
- Sends markdown to `renderWorkerHtml` (Web Worker with markdown-it + Shiki)
- Accepts pre-rendered HTML via `html` prop (skips worker)
- Handles copy-button click events on code blocks
- Emits `rendered`

### ImageRenderer

- Props: `src`, `alt`
- Zoomable (scroll wheel) and pannable (drag) image viewer
- Double-click resets zoom/pan

### HexRenderer

- Props: `rawHtml`
- Thin wrapper around `CodeContent` with `variant="binary"`

---

## Viewer Layer

Viewers **select and switch between Renderers** based on file type and user choice.
They own the mode-toggle tabs.

```
app/components/viewers/
├── ContentViewer.vue      Single-file display with mode toggle
└── DiffViewer.vue         Diff display with file tabs + mode tabs
```

### ContentViewer

Used for opening individual files, images, and debug text dumps.

```
ContentViewer
├── [mode tabs]   (shown only when multiple modes available)
└── active renderer
    ├── ImageRenderer   (mode: image)
    ├── MarkdownRenderer (mode: rendered)
    ├── HexRenderer     (mode: hex)
    └── CodeRenderer    (mode: source)
```

**Mode selection logic:**

| Condition                 | Available modes         | Default  |
| ------------------------- | ----------------------- | -------- |
| `imageSrc` provided       | Image, Hex (if rawHtml) | Image    |
| Binary or image extension | Hex                     | Hex      |
| Markdown file w/ content  | Rendered, Source        | Rendered |
| Other text file           | Source                  | Source   |

Props: `path`, `rawHtml`, `fileContent`, `lang`, `isBinary`, `gutterMode`,
`theme`, `lines`, `imageSrc`, `imageAlt`

### DiffViewer

Used for git diffs, message diffs, and commit diffs.

```
DiffViewer
├── [file tabs]      (multi-file diffs only)
├── [primary tabs]   Original | Modified | Diff
├── [sub tabs]       Rendered | Source  (markdown files, non-diff mode only)
└── active renderer
    ├── DiffRenderer     (primary: diff)
    ├── MarkdownRenderer (primary: original/modified, sub: rendered, markdown file)
    └── CodeRenderer     (primary: original/modified, sub: source)
```

**Primary mode logic:**

| Condition                    | Available modes          | Default |
| ---------------------------- | ------------------------ | ------- |
| Has before + after text      | Original, Modified, Diff | Diff    |
| Patch only (no before/after) | Diff                     | Diff    |

When primary mode is Original or Modified and the file is markdown,
a sub-toggle for Rendered / Source appears.

Props: `path`, `diffCode`, `diffAfter`, `diffPatch`, `diffTabs`,
`gutterMode`, `lang`, `theme`

---

## MessageViewer

```
app/components/MessageViewer.vue
```

A meta-viewer for **conversation messages** (user input, assistant output,
tool window text, etc.). Wraps `MarkdownRenderer` or `CodeRenderer`.

```
MessageViewer
├── [mode tabs]   (only when allowModeToggle=true and lang="markdown")
└── MarkdownRenderer  or  CodeRenderer
```

| Prop              | Effect                                           |
| ----------------- | ------------------------------------------------ |
| `html`            | Pre-rendered HTML — always uses MarkdownRenderer |
| `code` + `lang`   | Rendered via worker                              |
| `mode="markdown"` | Force MarkdownRenderer                           |
| `mode="code"`     | Force CodeRenderer                               |
| `allowModeToggle` | Show Rendered / Source tabs when applicable      |

Used by: `ThreadBlock`, `ThreadHistoryContent`, `Welcome`,
`ToolWindow/Question`, `ToolWindow/Subagent`, `ToolWindow/Reasoning`

---

## Where windows are opened

Every window is opened by a feature composable in `app/composables/`, never by a
component directly.

### `useFileViewers`

| Function                       | Opens                                    |
| ------------------------------ | ---------------------------------------- |
| `openFileViewer(path, lines)`  | A file from the tree or the output panel |
| `openImage({ url, filename })` | An image attachment                      |

```
open-file event -> openFileViewer()
  -> fw.open(key, { component: ContentViewer, props: { path, lang, ... } })
  -> API fetch -> fw.updateOptions(key, { props: { fileContent, ... } })
```

Binary files with an image extension also get `imageSrc` (a data URL), so
ContentViewer can offer the Image / Hex toggle.

### `useGitSnapshots`

`openGitDiff`, `openAllGitDiff`, `showMessageDiff` and `showCommit` all end in:

```
  -> fw.open(key, { component: DiffViewer, props: { diffCode, diffAfter, diffTabs, ... } })
```

The content comes from git through a one-shot PTY; the scripts and their parsers
live in `app/utils/gitSnapshotScripts.ts`.

### `useToolWindows`

`openToolPartAsWindow` renders a tool call through `utils/toolRenderers.ts`.
`openHistoryTool`, `openHistoryReasoning` and `showThreadHistory` open the
history pop-ups; they are closed together via `closeHistoryToolWindows`.

### `useTerminalWindows`

`openShellFromInput` and `runTreeShellCommand` open a `ShellContent` window per
PTY and own its xterm instance. A shell window's close must go through
`onWindowClosed(key)` so the PTY is killed.

### `useDebugCommands`

`/debug session` and `/debug notification` open plain-text `ContentViewer`
windows.

---

## File Map

```
app/
├── components/
│   ├── renderers/
│   │   ├── CodeRenderer.vue
│   │   ├── DiffRenderer.vue
│   │   ├── HexRenderer.vue
│   │   ├── ImageRenderer.vue
│   │   └── MarkdownRenderer.vue
│   ├── viewers/
│   │   ├── ContentViewer.vue
│   │   └── DiffViewer.vue
│   ├── MessageViewer.vue          (meta-viewer for conversation messages)
│   ├── FloatingWindow.vue         (generic window shell)
│   └── CodeContent.vue            (low-level HTML injector used by renderers)
├── composables/
│   ├── useFloatingWindows.ts      (window state management)
│   ├── useFloatingWindow.ts       (per-window API via provide/inject)
│   ├── useFloatingCanvas.ts       (canvas element, extent, default positions)
│   ├── useFileViewers.ts          (file and image windows)
│   ├── useGitSnapshots.ts         (diff windows)
│   ├── useToolWindows.ts          (tool call and history windows)
│   ├── useTerminalWindows.ts      (xterm shell windows)
│   └── useCodeRender.ts           (Shiki syntax highlighting composable)
├── utils/
│   └── workerRenderer.ts          (Web Worker communication)
└── workers/
    └── render-worker.ts           (markdown-it + Shiki in a Web Worker)
```
