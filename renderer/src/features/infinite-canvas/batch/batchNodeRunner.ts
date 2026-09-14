import type { GenerationTaskDto } from "../../../app/appConfig";
import { watchBatchGenerationTask } from "./batchNodeTaskLifecycle";

export interface BatchTaskTarget {
  id: string;
}

export interface BatchTaskRuntime {
  watch: (
    taskId: string,
    onTerminal: (task: GenerationTaskDto) => void,
  ) => Promise<void>;
  abort: (taskId: string) => void;
  has: (taskId: string) => boolean;
  dispose: () => void;
}

/**
 * Shared renderer-side task lifecycle for item-based generation nodes.
 *
 * The task cache remains the source of truth for task status. This runtime
 * only owns the local watcher/controller lease and exposes a single seam for
 * both batch-image and action-fission adapters.
 */
export function createBatchTaskRuntime(): BatchTaskRuntime {
  const controllers = new Map<string, AbortController>();

  const watch = async (
    taskId: string,
    onTerminal: (task: GenerationTaskDto) => void,
  ) => {
    if (!taskId || !window.forartGenerationTasks?.get || controllers.has(taskId)) return;
    const controller = new AbortController();
    controllers.set(taskId, controller);
    try {
      await watchBatchGenerationTask(taskId, controller.signal, onTerminal);
    } finally {
      if (controllers.get(taskId) === controller) controllers.delete(taskId);
    }
  };

  return {
    watch,
    abort: (taskId) => controllers.get(taskId)?.abort(),
    has: (taskId) => controllers.has(taskId),
    dispose: () => {
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
    },
  };
}

export async function submitBatchTasks<TItem extends BatchTaskTarget>(options: {
  items: TItem[];
  start: () => Promise<GenerationTaskDto[]>;
  onTaskIds: (items: TItem[], tasks: GenerationTaskDto[]) => void;
  watch: (task: GenerationTaskDto, item: TItem) => Promise<void>;
  onCountMismatch?: () => Error;
}) {
  const tasks = await options.start();
  if (tasks.length !== options.items.length) {
    throw options.onCountMismatch?.() || new Error("Batch task count mismatch");
  }
  options.onTaskIds(options.items, tasks);
  await Promise.allSettled(tasks.map((task, index) => options.watch(task, options.items[index])));
  return tasks;
}

export async function stopBatchTasks<TItem extends BatchTaskTarget>(options: {
  items: TItem[];
  taskId: (item: TItem) => string;
  isActive: (taskId: string) => boolean;
  abort?: (taskId: string) => void;
  stop: (taskId: string) => Promise<unknown>;
  onStopped?: (item: TItem, taskId: string) => void;
}) {
  await Promise.allSettled(options.items.map(async (item) => {
    const taskId = options.taskId(item);
    if (!taskId || !options.isActive(taskId)) return;
    options.abort?.(taskId);
    await options.stop(taskId);
    options.onStopped?.(item, taskId);
  }));
}
