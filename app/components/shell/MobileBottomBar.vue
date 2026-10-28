<template>
  <div class="mobile-bottom-bar">
    <button
      type="button"
      class="mobile-bottom-btn"
      :class="{ active: mobileDrawerOpen }"
      :title="mobileDrawerOpen ? 'Close panel' : 'Open panel'"
      @click="mobileDrawerOpen ? closeMobileDrawer() : openMobileDrawer()"
    >
      <Icon
        :name="mobileDrawerOpen ? 'lucide:panel-left-close' : 'lucide:panel-left-open'"
        :size="20"
      />
    </button>
    <div class="mobile-bottom-spacer" />
    <button type="button" class="mobile-bottom-btn" title="Settings" @click="isSettingsOpen = true">
      <Icon name="lucide:settings" :size="20" />
    </button>
  </div>
</template>

<script lang="ts" setup>
/** Narrow-viewport bar: toggles the side drawer and opens settings. */
import { useModals } from '~/composables/useModals';
import { useShellLayout } from '~/composables/useShellLayout';

const { mobileDrawerOpen, openMobileDrawer, closeMobileDrawer } = useShellLayout();
const { isSettingsOpen } = useModals();
</script>
