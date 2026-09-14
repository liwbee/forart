import type { GenerationTaskDto } from "../../../app/appConfig";
import { isGenerationTaskTerminal, watchGenerationTask } from "../generation/generationTaskCache";

/** Shared terminal-task watcher used by item-based canvas nodes. */
export async function watchBatchGenerationTask(
  taskId: string,
  signal: AbortSignal,
  onTerminal: (task: GenerationTaskDto) => void,
) {
  await watchGenerationTask(taskId, signal, (task) => {
    if (isGenerationTaskTerminal(task.status)) onTerminal(task);
  });
}
