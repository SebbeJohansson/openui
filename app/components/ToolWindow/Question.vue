<template>
  <div class="question-window">
    <div class="question-header">
      <div class="question-title">Question request</div>
      <div class="question-type">{{ request.questions.length }} item(s)</div>
    </div>

    <div class="question-summary">
      <div class="question-row">
        <div class="question-label">Session</div>
        <div class="question-value">{{ request.sessionID }}</div>
      </div>
      <div v-if="request.tool" class="question-row">
        <div class="question-label">Tool</div>
        <div class="question-value">
          message {{ request.tool.messageID }}
          <span class="divider">/</span>
          call {{ request.tool.callID }}
        </div>
      </div>
    </div>

    <div class="question-body">
      <div v-if="contextText" class="context-text-area">
        <MessageViewer :code="contextText" lang="markdown" theme="github-dark" />
      </div>

      <div
        v-for="(item, index) in request.questions"
        :key="`${request.id}-${index}-${item.header}`"
        class="question-section"
        :class="{ unanswered: !isAnswered(index) }"
      >
        <div class="section-head">
          <div class="section-title">{{ item.header }}</div>
          <div class="section-mode">{{ item.multiple ? 'Multiple' : 'Single' }}</div>
        </div>
        <div class="section-question">{{ item.question }}</div>

        <div class="option-list">
          <button
            v-for="option in item.options"
            :key="option.label"
            type="button"
            class="option-item"
            :class="{ selected: isSelected(index, option.label) }"
            :disabled="isSubmitting"
            @click="toggleOption(index, option.label, !!item.multiple)"
          >
            <span class="option-label">{{ option.label }}</span>
            <span class="option-description">{{ option.description }}</span>
          </button>
        </div>

        <div v-if="item.custom !== false" class="custom-answer">
          <div class="custom-answer-label">Or type a custom answer</div>
          <textarea
            class="custom-input"
            :class="{ active: isCustomActive(index) }"
            rows="3"
            :value="customAnswers[index] ?? ''"
            :disabled="isSubmitting"
            placeholder="Type your own answer"
            @input="updateCustom(index, $event)"
          ></textarea>
        </div>
      </div>

      <div v-if="error" class="question-error">{{ error }}</div>
    </div>

    <div class="question-actions">
      <div v-if="unansweredCount > 0" class="question-hint">
        Answer all questions before replying ({{ unansweredCount }} remaining)
      </div>
      <button
        type="button"
        class="question-button is-reject"
        :disabled="isSubmitting"
        @click="emitReject"
      >
        Reject
      </button>
      <button
        type="button"
        class="question-button is-reply"
        :disabled="isSubmitting || !canReply"
        @click="emitReply"
      >
        Reply
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import MessageViewer from '../MessageViewer.vue';
import { StorageKeys, storageGetJSON, storageSetJSON } from '../../utils/storageKeys';

type QuestionOption = {
  label: string;
  description: string;
};

type QuestionInfo = {
  question: string;
  header: string;
  options: QuestionOption[];
  multiple?: boolean;
  custom?: boolean;
};

type QuestionRequest = {
  id: string;
  sessionID: string;
  questions: QuestionInfo[];
  tool?: {
    messageID: string;
    callID: string;
  };
};

type QuestionDraft = {
  selectedAnswers: string[][];
  customAnswers: string[];
};

const props = defineProps<{
  request: QuestionRequest;
  contextText?: string;
  isSubmitting?: boolean;
  error?: string;
}>();

const emit = defineEmits<{
  (event: 'reply', payload: { requestId: string; answers: string[][] }): void;
  (event: 'reject', requestId: string): void;
}>();

const selectedAnswers = ref<string[][]>([]);
const customAnswers = ref<string[]>([]);

// --- Draft save / restore ---

function draftStorageKey(): string {
  return StorageKeys.drafts.question;
}

function loadAllDrafts(): Record<string, QuestionDraft> {
  return storageGetJSON<Record<string, QuestionDraft>>(draftStorageKey()) ?? {};
}

function saveDraft() {
  const all = loadAllDrafts();
  all[props.request.id] = {
    selectedAnswers: selectedAnswers.value,
    customAnswers: customAnswers.value,
  };
  storageSetJSON(draftStorageKey(), all);
}

function clearDraft() {
  const all = loadAllDrafts();
  delete all[props.request.id];
  storageSetJSON(draftStorageKey(), all);
}

function restoreDraft(): boolean {
  const all = loadAllDrafts();
  const draft = all[props.request.id];
  if (!draft) return false;
  if (
    Array.isArray(draft.selectedAnswers) &&
    draft.selectedAnswers.length === props.request.questions.length
  ) {
    selectedAnswers.value = draft.selectedAnswers;
  }
  if (
    Array.isArray(draft.customAnswers) &&
    draft.customAnswers.length === props.request.questions.length
  ) {
    customAnswers.value = draft.customAnswers;
  }
  return true;
}

let draftTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleDraftSave() {
  if (draftTimer !== null) clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    draftTimer = null;
    saveDraft();
  }, 400);
}

onBeforeUnmount(() => {
  if (draftTimer !== null) {
    clearTimeout(draftTimer);
    saveDraft();
  }
});

// --- Answers ---

function resetAnswers() {
  selectedAnswers.value = props.request.questions.map(() => []);
  customAnswers.value = props.request.questions.map(() => '');
  if (!restoreDraft()) return;
}

watch(
  () => props.request.id,
  () => {
    resetAnswers();
  },
  { immediate: true },
);

function isSelected(index: number, label: string) {
  return selectedAnswers.value[index]?.includes(label) ?? false;
}

function isCustomActive(index: number) {
  const hasText = (customAnswers.value[index] ?? '').trim().length > 0;
  const hasSelectedOption = (selectedAnswers.value[index] ?? []).length > 0;
  const isMultiple = !!props.request.questions[index]?.multiple;
  // In single mode, a selected prefilled option takes precedence — the
  // textarea loses its highlight even if it still has text in it.
  if (!isMultiple && hasSelectedOption) return false;
  return hasText;
}

function toggleOption(index: number, label: string, multiple: boolean) {
  const current = selectedAnswers.value[index] ?? [];
  if (multiple) {
    if (current.includes(label)) {
      selectedAnswers.value[index] = current.filter((value) => value !== label);
      scheduleDraftSave();
      return;
    }
    selectedAnswers.value[index] = [...current, label];
    scheduleDraftSave();
    return;
  }
  if (current.includes(label)) {
    selectedAnswers.value[index] = [];
    scheduleDraftSave();
    return;
  }
  // In single mode, selecting an option clears the free-text field so only
  // one input mode is visually active at a time.
  selectedAnswers.value[index] = [label];
  scheduleDraftSave();
}

function updateCustom(index: number, event: Event) {
  const target = event.target;
  if (!(target instanceof HTMLTextAreaElement)) return;
  customAnswers.value[index] = target.value;
  // In single-select mode, typing deselects any prefilled option so it's
  // always clear which answer will be submitted.
  const question = props.request.questions[index];
  if (!question?.multiple && target.value.length > 0) {
    selectedAnswers.value[index] = [];
  }
  scheduleDraftSave();
}

function buildAnswers() {
  return props.request.questions.map((item, index) => {
    const selected = selectedAnswers.value[index] ?? [];
    const isMultiple = !!item.multiple;
    // In single mode, a selected prefilled option takes precedence — exclude
    // the custom text so only the selected option is submitted.
    const excludeCustom = !isMultiple && selected.length > 0;
    const custom =
      excludeCustom || item.custom === false ? '' : (customAnswers.value[index] ?? '').trim();
    const values = custom ? [...selected, custom] : [...selected];
    return Array.from(new Set(values));
  });
}

function isAnswered(index: number) {
  const answer = buildAnswers()[index];
  return Array.isArray(answer) && answer.length > 0;
}

const unansweredCount = computed(
  () => buildAnswers().filter((answer) => answer.length === 0).length,
);

const canReply = computed(() => unansweredCount.value === 0);

function emitReply() {
  if (!canReply.value) return;
  clearDraft();
  emit('reply', {
    requestId: props.request.id,
    answers: buildAnswers(),
  });
}

function emitReject() {
  clearDraft();
  emit('reject', props.request.id);
}
</script>

<style scoped>
.question-window {
  display: grid;
  grid-template-rows: auto auto 1fr auto;
  gap: 8px;
  height: 100%;
  min-height: 0;
  padding: 8px;
  box-sizing: border-box;
  color: var(--theme-success-text);
  font-size: 12px;
}

.question-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.question-title {
  font-size: 13px;
  font-weight: 700;
}

.question-type {
  font-size: 11px;
  color: var(--theme-success);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.question-summary {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border: 1px solid color-mix(in srgb, var(--theme-success) 25%, transparent);
  border-radius: 8px;
  padding: 6px 8px;
  background: color-mix(in srgb, var(--theme-success) 8%, var(--theme-bg-base));
}

.question-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
}

.question-label {
  color: var(--theme-success);
  font-size: 11px;
}

.question-value {
  color: var(--theme-success-text);
  font-size: 11px;
  word-break: break-all;
}

.divider {
  margin: 0 4px;
  color: var(--theme-success);
}

.question-body {
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-right: 2px;
}

.context-text-area {
  border: 1px solid var(--theme-success-text);
  border-radius: 8px;
  padding: 8px;
  background: color-mix(in srgb, var(--theme-success) 10%, var(--theme-bg-base));
  font-size: 12px;
  line-height: 1.4;
}

.question-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid color-mix(in srgb, var(--theme-success) 25%, transparent);
  border-radius: 8px;
  padding: 8px;
  background: color-mix(in srgb, var(--theme-success) 12%, var(--theme-bg-base));
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.section-title {
  color: var(--theme-success);
  font-size: 12px;
  font-weight: 700;
}

.section-mode {
  color: var(--theme-success);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.section-question {
  color: var(--theme-success-text);
  font-size: 11px;
  line-height: 1.35;
}

.option-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.option-item {
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--theme-success) 28%, transparent);
  background: color-mix(in srgb, var(--theme-success) 7%, var(--theme-bg-base));
  color: var(--theme-success-text);
  padding: 6px 8px;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 2px;
  cursor: pointer;
}

.option-item.selected {
  border-color: color-mix(in srgb, var(--theme-success) 80%, transparent);
  background: color-mix(in srgb, var(--theme-success) 5%, var(--theme-bg-base));
}

.option-item:disabled {
  opacity: 0.65;
  cursor: wait;
}

.option-label {
  font-size: 11px;
  font-weight: 600;
}

.option-description {
  font-size: 10px;
  color: var(--theme-success);
}

.custom-answer {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.custom-answer-label {
  font-size: 10px;
  color: var(--theme-success);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.custom-input {
  width: 100%;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--theme-success) 35%, transparent);
  background: color-mix(in srgb, var(--theme-success) 12%, var(--theme-bg-base));
  color: var(--theme-success-text);
  font-size: 11px;
  padding: 6px 8px;
  min-height: 3em;
  resize: vertical;
  font-family: inherit;
  line-height: 1.4;
  box-sizing: border-box;
  outline: none;
}

.custom-input:focus {
  border-color: color-mix(in srgb, var(--theme-success) 60%, transparent);
}

.custom-input.active {
  border-color: color-mix(in srgb, var(--theme-success) 80%, transparent);
  background: color-mix(in srgb, var(--theme-success) 5%, var(--theme-bg-base));
}

.question-error {
  color: var(--theme-danger);
  font-size: 11px;
}

.question-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: flex-end;
  border-top: 1px solid color-mix(in srgb, var(--theme-success) 30%, transparent);
  padding-top: 8px;
}

.question-hint {
  margin-right: auto;
  color: var(--theme-warning);
  font-size: 11px;
}

.question-section.unanswered {
  border-color: color-mix(in srgb, var(--theme-warning) 55%, transparent);
}

.question-button {
  border-radius: 8px;
  padding: 6px 10px;
  border: 1px solid color-mix(in srgb, var(--theme-success) 45%, transparent);
  background: color-mix(in srgb, var(--theme-success) 7%, var(--theme-bg-base));
  color: var(--theme-success-text);
  font-size: 11px;
  cursor: pointer;
}

.question-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.question-button.is-reject {
  border-color: color-mix(in srgb, var(--theme-danger) 60%, transparent);
  background: color-mix(in srgb, var(--theme-danger-strong) 35%, transparent);
}

.question-button.is-reply {
  border-color: color-mix(in srgb, var(--theme-success) 70%, transparent);
  background: color-mix(in srgb, var(--theme-success) 6%, var(--theme-bg-base));
}
</style>
