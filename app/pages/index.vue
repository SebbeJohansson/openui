<template>
  <div class="app">
    <ShellLayout v-if="uiInitState === 'ready'" />
    <ShellStartupScreen v-else />
    <ShellModalHost />
  </div>
</template>

<script lang="ts" setup>
/**
 * The only route. Creates the shared app context, starts the bootstrap, and
 * shows either the connected shell or the startup screen. Selection lives in
 * `?project=&session=`, kept in sync by useSelectionRouting.
 */
import { provideAppContext } from '~/composables/useAppContext';
import { useAppBootstrap } from '~/composables/useAppBootstrap';

definePageMeta({ key: 'home' });

// inject() cannot see a provide() from the same component, so the context this
// page creates is handed to the feature explicitly; descendants use inject.
const ctx = provideAppContext();
const { uiInitState } = useAppBootstrap(ctx);
</script>
