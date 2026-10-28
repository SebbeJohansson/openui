import { onScopeDispose, ref, watch } from 'vue';
import { clamp } from '~/utils/number';
import {
  TERM_COLUMNS,
  TERM_FONT_FAMILY,
  TERM_FONT_SIZE_PX,
  TERM_GUTTER_WIDTH_EM,
  TERM_INNER_PADDING_X_PX,
  TERM_INNER_PADDING_Y_PX,
  TERM_LINE_HEIGHT,
  TERM_ROWS,
  TERM_TITLEBAR_HEIGHT_PX,
  TERM_WINDOW_BORDER_PX,
} from '~/utils/terminalMetrics';
import { defineFeature } from './useAppContext';
import { useShellLayout } from './useShellLayout';

export const FILE_VIEWER_WINDOW_WIDTH = 840;
export const FILE_VIEWER_WINDOW_HEIGHT = 520;

function measureTerminalCellWidth(fontFamily: string, fontSizePx: number) {
  if (typeof document === 'undefined') return fontSizePx * 0.62;
  const probe = document.createElement('span');
  probe.textContent = 'MMMMMMMMMM';
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  probe.style.whiteSpace = 'pre';
  probe.style.fontFamily = fontFamily;
  probe.style.fontSize = `${fontSizePx}px`;
  probe.style.lineHeight = String(TERM_LINE_HEIGHT);
  document.body.appendChild(probe);
  const rect = probe.getBoundingClientRect();
  probe.remove();
  const width = rect.width / 10;
  return Number.isFinite(width) && width > 0 ? width : fontSizePx * 0.62;
}

/** Pixel size of a default terminal window, derived from measured font metrics. */
export function getTerminalWindowSize() {
  const cellWidth = measureTerminalCellWidth(TERM_FONT_FAMILY, TERM_FONT_SIZE_PX);
  const lineHeightPx = TERM_FONT_SIZE_PX * TERM_LINE_HEIGHT;
  const gutterWidthPx = TERM_FONT_SIZE_PX * TERM_GUTTER_WIDTH_EM;
  const contentWidth = TERM_COLUMNS * cellWidth;
  const contentHeight = TERM_ROWS * lineHeightPx;
  const width = Math.ceil(
    contentWidth + gutterWidthPx + TERM_INNER_PADDING_X_PX + TERM_WINDOW_BORDER_PX,
  );
  const height = Math.ceil(
    contentHeight + TERM_TITLEBAR_HEIGHT_PX + TERM_INNER_PADDING_Y_PX + TERM_WINDOW_BORDER_PX,
  );
  return { width, height };
}

/**
 * The floating-window canvas: keeps the window manager's extent in sync with
 * the space between header and composer, and computes default window positions.
 */
export const useFloatingCanvas = defineFeature('floatingCanvas', (context) => {
  const { fw, settings } = context;
  const { inputEl } = useShellLayout(context);
  const canvasEl = ref<HTMLDivElement | null>(null);
  const bindCanvasEl = (el: unknown) => {
    canvasEl.value = el instanceof HTMLDivElement ? el : null;
  };

  let extentObserver: ResizeObserver | null = null;
  let observedEl: HTMLDivElement | null = null;
  const resizeListeners = new Set<() => void>();

  /** Runs after the canvas re-measured itself on a window resize. */
  function onWindowResize(listener: () => void) {
    resizeListeners.add(listener);
    return () => resizeListeners.delete(listener);
  }

  function syncCanvasTermMetrics() {
    const canvas = canvasEl.value;
    if (!canvas) return;
    const { width, height } = getTerminalWindowSize();
    canvas.style.setProperty('--term-font-family', TERM_FONT_FAMILY);
    canvas.style.setProperty('--term-font-size', `${TERM_FONT_SIZE_PX}px`);
    canvas.style.setProperty('--term-line-height', String(TERM_LINE_HEIGHT));
    canvas.style.setProperty('--term-width', `${width}px`);
    canvas.style.setProperty('--term-height', `${height}px`);
  }

  function syncFloatingExtent() {
    const canvas = canvasEl.value;
    if (!canvas) return;
    if (settings.fullScreenFloating.value) {
      // Full viewport mode: remove constraints so the canvas covers the entire screen
      canvas.style.removeProperty('--canvas-top');
      canvas.style.removeProperty('--canvas-height');
      // Raise above header (z-index: 30), input area (z-index: 30), and resizer (z-index: 40)
      canvas.style.setProperty('z-index', '50');
      fw.setExtent(window.innerWidth, window.innerHeight);
      return;
    }
    canvas.style.removeProperty('z-index');
    const header = document.querySelector('.app-header') as HTMLElement | null;
    const input = inputEl.value;
    if (!header || !input) return;
    const headerBottom = header.getBoundingClientRect().bottom;
    const inputTop = input.getBoundingClientRect().top;
    canvas.style.setProperty('--canvas-top', `${Math.max(0, headerBottom)}px`);
    canvas.style.setProperty('--canvas-height', `${Math.max(0, inputTop - headerBottom)}px`);
    const rect = canvas.getBoundingClientRect();
    fw.setExtent(rect.width, rect.height);
  }

  function updateFloatingExtentObserver() {
    if (typeof ResizeObserver === 'undefined') return;
    if (!extentObserver) {
      extentObserver = new ResizeObserver(() => {
        syncFloatingExtent();
      });
    }
    const nextEl = canvasEl.value;
    if (observedEl && observedEl !== nextEl) extentObserver.unobserve(observedEl);
    if (nextEl && nextEl !== observedEl) extentObserver.observe(nextEl);
    observedEl = nextEl ?? null;
    if (nextEl) syncFloatingExtent();
  }

  function handleWindowResize() {
    syncCanvasTermMetrics();
    syncFloatingExtent();
    resizeListeners.forEach((listener) => listener());
  }

  function getCanvasMetrics() {
    const canvas = canvasEl.value;
    if (!canvas) return null;
    const canvasRect = canvas.getBoundingClientRect();
    const styles = getComputedStyle(canvas);
    const toolTop = Number.parseFloat(styles.getPropertyValue('--tool-top-offset')) || 0;
    const toolAreaValue = styles.getPropertyValue('--tool-area-height').trim();
    const parsedToolArea = Number.parseFloat(toolAreaValue);
    const toolAreaHeight =
      toolAreaValue.endsWith('px') && Number.isFinite(parsedToolArea) && parsedToolArea > 0
        ? parsedToolArea
        : canvasRect.height - toolTop;
    const parsedWidth = Number.parseFloat(styles.getPropertyValue('--term-width'));
    const parsedHeight = Number.parseFloat(styles.getPropertyValue('--term-height'));
    const termWidth = Number.isFinite(parsedWidth) && parsedWidth > 0 ? parsedWidth : 640;
    const termHeight = Number.isFinite(parsedHeight) && parsedHeight > 0 ? parsedHeight : 350;
    return { canvasRect, toolTop, toolAreaHeight, termWidth, termHeight };
  }

  function getRandomWindowPosition(size?: { width?: number; height?: number }) {
    const metrics = getCanvasMetrics();
    if (!metrics) return { x: 0, y: 0 };
    const { canvasRect, toolAreaHeight, termWidth, termHeight } = metrics;
    const targetWidth = size?.width ?? termWidth;
    const targetHeight = size?.height ?? termHeight;
    return {
      x: Math.round(Math.random() * Math.max(0, canvasRect.width - targetWidth)),
      y: Math.round(Math.random() * Math.max(0, toolAreaHeight - targetHeight)),
    };
  }

  function getFileViewerPosition(factorX = 0.16, factorY = 0.1) {
    const metrics = getCanvasMetrics();
    const x = metrics
      ? clamp(
          metrics.canvasRect.width * factorX,
          16,
          Math.max(16, metrics.canvasRect.width - FILE_VIEWER_WINDOW_WIDTH - 16),
        )
      : 24;
    const y = metrics
      ? clamp(
          metrics.toolAreaHeight * factorY,
          16,
          Math.max(16, metrics.toolAreaHeight - FILE_VIEWER_WINDOW_HEIGHT - 16),
        )
      : 24;
    return { x, y };
  }

  watch(canvasEl, () => {
    syncCanvasTermMetrics();
    updateFloatingExtentObserver();
  });
  watch(settings.fullScreenFloating, () => {
    syncFloatingExtent();
  });

  if (typeof window !== 'undefined') {
    window.addEventListener('resize', handleWindowResize);
    if ('fonts' in document) {
      void document.fonts.ready.then(() => {
        handleWindowResize();
      });
    }
    onScopeDispose(() => {
      window.removeEventListener('resize', handleWindowResize);
      extentObserver?.disconnect();
      extentObserver = null;
      observedEl = null;
    });
  }

  return {
    canvasEl,
    bindCanvasEl,
    onWindowResize,
    handleWindowResize,
    syncCanvasTermMetrics,
    syncFloatingExtent,
    updateFloatingExtentObserver,
    getCanvasMetrics,
    getRandomWindowPosition,
    getFileViewerPosition,
  };
});
