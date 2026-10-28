import { ref, watch, effectScope } from 'vue';
import { StorageKeys, storageGetJSON, storageSetJSON } from '../utils/storageKeys';

export type AgentModelEntry = { model: string; variant?: string };
type AgentModelMap = Record<string, AgentModelEntry>;

const memory = ref<AgentModelMap>(
  storageGetJSON<AgentModelMap>(StorageKeys.state.agentModelMemory) ?? {},
);

const scope = effectScope(true);
scope.run(() => {
  watch(
    memory,
    (value) => {
      storageSetJSON(StorageKeys.state.agentModelMemory, value);
    },
    { deep: true },
  );
});

function remember(agent: string, model: string, variant?: string) {
  memory.value = {
    ...memory.value,
    [agent]: { model, variant },
  };
}

function recall(agent: string): AgentModelEntry | undefined {
  return memory.value[agent];
}

function agentForModel(modelId: string): string[] {
  return Object.entries(memory.value)
    .filter(([, entry]) => entry.model === modelId)
    .map(([agent]) => agent);
}

export function useAgentModelMemory() {
  return { memory, remember, recall, agentForModel };
}
