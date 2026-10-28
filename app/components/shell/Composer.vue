<template>
  <footer
    :ref="bindInputEl"
    class="app-input"
    :class="{ 'is-disabled': !hasSession }"
    :style="inputHeight !== null ? { height: `${inputHeight}px` } : undefined"
  >
    <div class="input-resizer" @pointerdown="startInputResize"></div>
    <InputPanel
      ref="inputPanelRef"
      :disabled="connectionState !== 'ready'"
      :can-send="canSend"
      :agent-options="agentOptions"
      :has-agent-options="hasAgentOptions"
      :agent-color="currentAgentColor"
      :resolve-agent-color="resolveAgentColorForName"
      :model-options="modelOptions"
      :all-model-options="allModelOptions"
      :thinking-options="thinkingOptions"
      :has-model-options="hasModelOptions"
      :has-thinking-options="hasThinkingOptions"
      :can-attach="canAttach"
      :is-thinking="isThinking"
      :can-abort="canAbort"
      :commands="commandOptions"
      :attachments="attachments"
      :message-input="messageInput"
      :is-claude-session="isClaudeSession"
      :selected-mode="selectedMode"
      :selected-model="selectedModel"
      :selected-thinking="selectedThinking"
      :pending-permission-count="pendingPermissionCount"
      :models-error="providersError"
      :agents-error="agentsError"
      @update:message-input="handleMessageInputUpdate"
      @update:selected-mode="handleSelectedModeUpdate"
      @update:selected-model="handleSelectedModelUpdate"
      @update:selected-thinking="handleSelectedThinkingUpdate"
      @apply-history-entry="handleApplyHistoryEntry"
      @send="sendMessage"
      @abort="abortSession"
      @add-attachments="handleAddAttachments"
      @remove-attachment="removeAttachment"
      @open-image="openImage"
      @open-manage-models="isHiddenModelsOpen = true"
      @open-permissions="openToolPermissions"
      @reload-models="fetchProviders(true)"
      @reload-agents="fetchAgents()"
    />
  </footer>
</template>

<script lang="ts" setup>
/** The message composer, its resize handle, and the agent/model pickers. */
import { onMounted, ref } from 'vue';
import InputPanel from '~/components/InputPanel.vue';
import { useAppContext } from '~/composables/useAppContext';
import { useAttachments } from '~/composables/useAttachments';
import { useClaudeIntegration } from '~/composables/useClaudeIntegration';
import { useComposer } from '~/composables/useComposer';
import { useConnectionState } from '~/composables/useConnectionState';
import { useFileViewers } from '~/composables/useFileViewers';
import { useModals } from '~/composables/useModals';
import { usePermissionRouting } from '~/composables/usePermissionRouting';
import { useProviderCatalog } from '~/composables/useProviderCatalog';
import { useSessionCatalog } from '~/composables/useSessionCatalog';
import { useShellLayout } from '~/composables/useShellLayout';

const ctx = useAppContext();
const { bindInputEl, inputHeight, startInputResize } = useShellLayout();
const { connectionState } = useConnectionState();
const { hasSession } = useSessionCatalog();
const { attachments } = useAttachments();
const { isClaudeSession } = useClaudeIntegration();
const { openImage } = useFileViewers();
const { isHiddenModelsOpen } = useModals();
const { pendingPermissionCount, openToolPermissions } = usePermissionRouting();
const {
  agentOptions,
  modelOptions,
  allModelOptions,
  thinkingOptions,
  hasAgentOptions,
  hasModelOptions,
  hasThinkingOptions,
  canAttach,
  commandOptions,
  currentAgentColor,
  selectedMode,
  selectedModel,
  selectedThinking,
  providersError,
  agentsError,
  resolveAgentColorForName,
  fetchProviders,
  fetchAgents,
} = useProviderCatalog();
const {
  messageInput,
  canSend,
  canAbort,
  isThinking,
  handleMessageInputUpdate,
  handleSelectedModeUpdate,
  handleSelectedModelUpdate,
  handleSelectedThinkingUpdate,
  handleApplyHistoryEntry,
  handleAddAttachments,
  removeAttachment,
  sendMessage,
  abortSession,
} = useComposer();

const inputPanelRef = ref<{ focus: () => void; reset: () => void } | null>(null);

// Focus and reset are driven from features (shortcuts, session switch), which
// cannot reach a template ref in a component they do not own.
onMounted(() => {
  ctx.uiHooks.focusComposer = () => inputPanelRef.value?.focus();
  ctx.uiHooks.resetComposer = () => inputPanelRef.value?.reset();
});
</script>
