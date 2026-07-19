import { create } from "zustand";
import type {
  GenerationTaskDto,
  GenerationTaskStatus,
} from "../../../app/appConfig";

const TERMINAL_STATUSES = new Set<GenerationTaskStatus>([
  "succeeded",
  "failed",
  "canceled",
  "interrupted",
  "superseded",
]);

const ACTIVE_STATUSES = new Set<GenerationTaskStatus>([
  "queued",
  "preparing",
  "submitting",
  "running",
  "result_processing",
]);

interface GenerationTaskCacheState {
  tasksById: Record<string, GenerationTaskDto>;
  mergeTask: (task: GenerationTaskDto) => void;
  mergeTasks: (tasks: GenerationTaskDto[]) => void;
}

function mergeTaskRecord(
  current: Record<string, GenerationTaskDto>,
  task: GenerationTaskDto,
) {
  const existing = current[task.id];
  if (existing && existing.version >= task.version) return current;
  return { ...current, [task.id]: task };
}

export const useGenerationTaskCache = create<GenerationTaskCacheState>((set) => ({
  tasksById: {},
  mergeTask: (task) => set((state) => ({ tasksById: mergeTaskRecord(state.tasksById, task) })),
  mergeTasks: (tasks) => set((state) => ({
    tasksById: tasks.reduce(mergeTaskRecord, state.tasksById),
  })),
}));

let eventSubscribers = 0;
let disconnectEvents: (() => void) | null = null;

export function connectGenerationTaskEvents() {
  eventSubscribers += 1;
  if (!disconnectEvents && window.forartGenerationTasks?.onChanged) {
    disconnectEvents = window.forartGenerationTasks.onChanged((task) => {
      useGenerationTaskCache.getState().mergeTask(task);
    });
  }
  return () => {
    eventSubscribers = Math.max(0, eventSubscribers - 1);
    if (!eventSubscribers && disconnectEvents) {
      disconnectEvents();
      disconnectEvents = null;
    }
  };
}

export async function hydrateGenerationTasks(canvasId: string) {
  if (!canvasId || !window.forartGenerationTasks?.listForCanvas) return [];
  const tasks = await window.forartGenerationTasks.listForCanvas(canvasId);
  useGenerationTaskCache.getState().mergeTasks(tasks);
  return tasks;
}

export async function hydrateRecentGenerationTasks(limit = 100) {
  if (!window.forartGenerationTasks?.listRecent) return [];
  const tasks = await window.forartGenerationTasks.listRecent(limit);
  useGenerationTaskCache.getState().mergeTasks(tasks);
  return tasks;
}

export function isGenerationTaskTerminal(status: GenerationTaskStatus) {
  return TERMINAL_STATUSES.has(status);
}

export function isGenerationTaskActive(task: GenerationTaskDto | undefined) {
  return Boolean(task && ACTIVE_STATUSES.has(task.status));
}

export async function watchGenerationTask(
  taskId: string,
  signal: AbortSignal,
  onTask: (task: GenerationTaskDto) => void,
) {
  const taskApi = window.forartGenerationTasks;
  if (!taskApi?.get) throw new Error("Generation task service is unavailable.");
  return new Promise<GenerationTaskDto | null>((resolve, reject) => {
    let lastVersion = -1;
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      signal.removeEventListener("abort", abort);
      callback();
    };
    const applyTask = (task: GenerationTaskDto | undefined) => {
      if (!task || task.id !== taskId || task.version <= lastVersion || settled) return;
      lastVersion = task.version;
      try {
        onTask(task);
      } catch (error) {
        finish(() => reject(error));
        return;
      }
      if (isGenerationTaskTerminal(task.status)) finish(() => resolve(task));
    };
    const unsubscribe = useGenerationTaskCache.subscribe((state, previous) => {
      const task = state.tasksById[taskId];
      if (task !== previous.tasksById[taskId]) applyTask(task);
    });
    const abort = () => finish(() => reject(new DOMException("Aborted", "AbortError")));
    signal.addEventListener("abort", abort, { once: true });

    applyTask(useGenerationTaskCache.getState().tasksById[taskId]);
    if (settled) return;
    void taskApi.get(taskId)
      .then((task) => {
        if (!task) {
          finish(() => resolve(null));
          return;
        }
        useGenerationTaskCache.getState().mergeTask(task);
        applyTask(useGenerationTaskCache.getState().tasksById[taskId]);
      })
      .catch((error) => finish(() => reject(error)));
  });
}
