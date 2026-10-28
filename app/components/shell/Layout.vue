<template>
  <ShellHeader />
  <div
    :ref="bindAppBodyEl"
    class="app-body"
    :class="{ 'todo-collapsed': sidePanelCollapsed, 'mobile-drawer-open': mobileDrawerOpen }"
    :style="sidePanelWidth !== null ? sidePanelWidthStyle : undefined"
  >
    <Transition name="mobile-backdrop">
      <div
        v-if="isMobile && mobileDrawerOpen"
        class="mobile-drawer-backdrop"
        @click="closeMobileDrawer"
      />
    </Transition>
    <ShellSidePanelHost />
    <ShellWorkspace>
      <ShellComposer />
    </ShellWorkspace>
    <ShellToolWindowCanvas />
    <ShellMobileBottomBar v-if="isMobile" />
  </div>
</template>

<script lang="ts" setup>
/** The connected app: header, side panel, session view, composer, windows. */
import { computed, type CSSProperties } from 'vue';
import { useAppContext } from '~/composables/useAppContext';
import { useShellLayout } from '~/composables/useShellLayout';

const { isMobile } = useAppContext();
const { bindAppBodyEl, sidePanelCollapsed, sidePanelWidth, mobileDrawerOpen, closeMobileDrawer } =
  useShellLayout();

const sidePanelWidthStyle = computed(
  () => ({ '--todo-panel-width': `${sidePanelWidth.value}px` }) as CSSProperties,
);
</script>
