<template>
  <div class="app-loading-view" role="status" aria-live="polite">
    <div class="app-loading-card">
      <ShellBrandLogo />
      <div v-if="uiInitState === 'login'" class="app-login-form">
        <p class="app-loading-title">Connect to OpenCode Server</p>
        <div class="app-login-fields">
          <input
            v-model="loginUsername"
            type="text"
            class="app-login-input"
            placeholder="Username"
            name="username"
            :disabled="!loginRequiresAuth"
            @keydown.enter="handleLogin"
          />
          <input
            v-model="loginPassword"
            type="password"
            class="app-login-input"
            placeholder="Password"
            :disabled="!loginRequiresAuth"
            @keydown.enter="handleLogin"
          />
          <label class="app-login-checkbox">
            <input v-model="loginRequiresAuth" type="checkbox" />
            The server requires authentication
          </label>
          <input
            v-model="loginUrl"
            type="text"
            class="app-login-input"
            placeholder="http://localhost:4096"
            name="url"
            @keydown.enter="handleLogin"
          />
        </div>
        <p v-if="initErrorMessage" class="app-loading-message app-error-message">
          {{ initErrorMessage }}
        </p>
        <button type="button" class="app-loading-retry bg-indigo-500!" @click="handleLogin">
          Connect
        </button>

        <Welcome :theme="shikiTheme" class="mt-8" />
      </div>
      <div v-else>
        <div class="app-loading-spinner" aria-hidden="true"></div>
        <p class="app-loading-title">Loading session data...</p>
        <p class="app-loading-message">
          {{ uiInitState === 'error' ? initErrorMessage : initLoadingMessage }}
        </p>
        <div class="app-loading-actions">
          <button
            v-if="uiInitState === 'error'"
            type="button"
            class="app-loading-retry"
            @click="startInitialization"
          >
            Retry
          </button>
          <button
            v-if="uiInitState === 'loading' && connectionState === 'connecting'"
            type="button"
            class="app-loading-retry app-loading-abort"
            @click="handleAbortInit"
          >
            Abort
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
/** Shown until the app is connected: the login form, or progress and errors. */
import Welcome from '~/components/Welcome.vue';
import { useAppBootstrap } from '~/composables/useAppBootstrap';
import { useFileViewers } from '~/composables/useFileViewers';

const {
  uiInitState,
  connectionState,
  initLoadingMessage,
  initErrorMessage,
  loginUrl,
  loginUsername,
  loginPassword,
  loginRequiresAuth,
  startInitialization,
  handleLogin,
  handleAbortInit,
} = useAppBootstrap();
const { shikiTheme } = useFileViewers();
</script>
