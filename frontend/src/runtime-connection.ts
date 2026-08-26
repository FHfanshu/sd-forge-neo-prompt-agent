import { PromptAgentController } from "./agent/controller";
import { useUiStore } from "./stores/ui";

export function createPromptAgentController(): PromptAgentController {
  return new PromptAgentController(undefined, { allowGeneration: () => useUiStore.getState().agentGeneration });
}

export async function connectPromptAgentController(signal?: AbortSignal): Promise<PromptAgentController> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  return createPromptAgentController();
}
