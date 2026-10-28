<template>
  <div :ref="bindCanvasEl" class="tool-window-canvas">
    <TransitionGroup appear name="scale">
      <FloatingWindow
        v-for="entry in fw.entries.value"
        :key="entry.key"
        :entry="entry"
        :manager="fw"
        @focus="fw.bringToFront(entry.key)"
        @close="handleClose(entry.key)"
      />
    </TransitionGroup>
  </div>
</template>

<script lang="ts" setup>
/** Host for the floating tool windows. */
import { watch } from 'vue';
import FloatingWindow from '~/components/FloatingWindow.vue';
import { useAppContext } from '~/composables/useAppContext';
import { useFloatingCanvas } from '~/composables/useFloatingCanvas';
import { useShellLayout } from '~/composables/useShellLayout';
import { useTerminalWindows } from '~/composables/useTerminalWindows';

const { fw, settings } = useAppContext();
const canvas = useFloatingCanvas();
const { bindCanvasEl, syncFloatingExtent } = canvas;
const terminals = useTerminalWindows();
const layout = useShellLayout();

layout.onLayoutChange(() => {
  syncFloatingExtent();
  terminals.scheduleShellFitAll();
});
canvas.onWindowResize(() => terminals.scheduleShellFitAll());

/** Shell windows need their PTY killed; everything else just closes. */
function handleClose(key: string) {
  if (terminals.onWindowClosed(key)) return;
  void fw.close(key);
}

// Close auto-opened windows when the suppress setting is switched on.
// Tool auto windows have closable === false and a finite expiry; reasoning and
// subagent windows are keyed by prefix. Permission and question windows
// (closable false, infinite expiry) are deliberately left open.
watch(settings.suppressAutoWindows, (suppressed) => {
  if (!suppressed) return;
  for (const entry of fw.entries.value) {
    if (
      !entry.closable &&
      (entry.expiresAt < Number.MAX_SAFE_INTEGER ||
        entry.key.startsWith('reasoning:') ||
        entry.key.startsWith('subagent:'))
    ) {
      void fw.close(entry.key);
    }
  }
});
</script>
