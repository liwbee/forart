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
const MAX_CACHED_TERMINAL_TASKS = 120;

interface GenerationTaskCacheState {
  tasksById: Record<string, GenerationTaskDto>;
  hydratedCanvasId: string;
  pinnedTaskIds: Set<string>;
  revision: number;
  mergeTask: (task: GenerationTaskDto) => void;
  mergeTasks: (tasks: GenerationTaskDto[]) => void;
  replaceHydratedTasks: (canvasId: string, tasks: GenerationTaskDto[]) => void;
  clearHydratedTasks: () => void;
}

function mergeTaskRecord(
  current: Record<string, GenerationTaskDto>,
  task: GenerationTaskDto,
  pinnedTaskIds: ReadonlySet<string>,
) {
  const existing = current[task.id];
  if (existing && existing.version >= task.version) return current;
  return pruneTerminalTasks({ ...current, [task.id]: task }, pinnedTaskIds);
}

function mergeTaskRecords(
  current: Record<string, GenerationTaskDto>,
  tasks: GenerationTaskDto[],
  pinnedTaskIds: ReadonlySet<string>,
) {
  let next: Record<string, GenerationTaskDto> | null = null;
  for (const task of tasks) {
    const existing = (next || current)[task.id];
    if (existing && existing.version >= task.version) continue;
    if (!next) next = { ...current };
    next[task.id] = task;
  }
  return next ? pruneTerminalTasks(next, pinnedTaskIds) : current;
}

function pruneTerminalTasks(
  tasksById: Record<string, GenerationTaskDto>,
  pinnedTaskIds: ReadonlySet<string>,
) {
  const terminalTasks = Object.values(tasksById)
    .filter((task) => TERMINAL_STATUSES.has(task.status) && !pinnedTaskIds.has(task.id))
    .sort((left, right) => right.updatedAt - left.updatedAt);
  if (terminalTasks.length <= MAX_CACHED_TERMINAL_TASKS) return tasksById;
  const next = { ...tasksById };
  for (const task of terminalTasks.slice(MAX_CACHED_TERMINAL_TASKS)) delete next[task.id];
  return next;
}

export const useGenerationTaskCache = create<GenerationTaskCacheState>((set) => ({
  tasksById: {},
  hydratedCanvasId: "",
  pinnedTaskIds: new Set(),
  revision: 0,
  mergeTask: (task) => set((state) => {
    const tasksById = mergeTaskRecord(state.tasksById, task, state.pinnedTaskIds);
    return tasksById === state.tasksById ? state : { tasksById, revision: state.revision + 1 };
  }),
  mergeTasks: (tasks) => set((state) => {
    const tasksById = mergeTaskRecords(state.tasksById, tasks, state.pinnedTaskIds);
    return tasksById === state.tasksById ? state : { tasksById, revision: state.revision + 1 };
  }),
  replaceHydratedTasks: (canvasId, tasks) => set((state) => {
    const pinnedTaskIds = new Set(tasks.map((task) => task.id));
    const tasksById = mergeTaskRecords(state.tasksById, tasks, pinnedTaskIds);
    return {
      hydratedCanvasId: canvasId,
      pinnedTaskIds,
      tasksById: pruneTerminalTasks(tasksById, pinnedTaskIds),
      revision: state.revision + 1,
    };
  }),
  clearHydratedTasks: () => set((state) => ({
    hydratedCanvasId: "",
    pinnedTaskIds: new Set(),
    tasksById: pruneTerminalTasks(state.tasksById, new Set()),
    revision: state.revision + 1,
  })),
}));

let eventSubscribers = 0;
let disconnectEvents: (() => void) | null = null;
let pendingChangedTasks = new Map<string, GenerationTaskDto>();
let cancelPendingTaskFlush: (() => void) | null = null;

function flushPendingChangedTasks() {
  const cancelScheduledFlush = cancelPendingTaskFlush;
  cancelPendingTaskFlush = null;
  cancelScheduledFlush?.();
  if (!pendingChangedTasks.size) return;
  const tasks = [...pendingChangedTasks.values()];
  pendingChangedTasks = new Map();
  useGenerationTaskCache.getState().mergeTasks(tasks);
}

function scheduleChangedTask(task: GenerationTaskDto) {
  const pending = pendingChangedTasks.get(task.id);
  if (!pending || pending.version < task.version) pendingChangedTasks.set(task.id, task);
  if (cancelPendingTaskFlush) return;
  if (typeof window.requestAnimationFrame === "function") {
    const frameId = window.requestAnimationFrame(flushPendingChangedTasks);
    const fallbackTimerId = setTimeout(flushPendingChangedTasks, 32);
    cancelPendingTaskFlush = () => {
      window.cancelAnimationFrame(frameId);
      clearTimeout(fallbackTimerId);
    };
    return;
  }
  const timerId = setTimeout(flushPendingChangedTasks, 0);
  cancelPendingTaskFlush = () => clearTimeout(timerId);
}

export function connectGenerationTaskEvents() {
  eventSubscribers += 1;
  if (!disconnectEvents && window.forartGenerationTasks?.onChanged) {
    disconnectEvents = window.forartGenerationTasks.onChanged((task) => {
      scheduleChangedTask(task);
    });
  }
  return () => {
    eventSubscribers = Math.max(0, eventSubscribers - 1);
    if (!eventSubscribers && disconnectEvents) {
      disconnectEvents();
      disconnectEvents = null;
      if (cancelPendingTaskFlush) flushPendingChangedTasks();
    }
  };
}

let hydrationRequestSequence = 0;

export async function hydrateGenerationTasks(canvasId: string, legacyTaskIds: string[] = []) {
  if (!canvasId || !window.forartGenerationTasks?.listForCanvas) return [];
  const requestSequence = ++hydrationRequestSequence;
  const headTasks = await window.forartGenerationTasks.listForCanvas(canvasId);
  const headTaskIds = new Set(headTasks.map((task) => task.id));
  const fallbackIds = [...new Set(legacyTaskIds.filter(Boolean))].filter((taskId) => !headTaskIds.has(taskId));
  const fallbackTasks = fallbackIds.length && window.forartGenerationTasks.getMany
    ? await window.forartGenerationTasks.getMany(fallbackIds)
    : [];
  if (requestSequence !== hydrationRequestSequence) return [];
  const tasks = [...headTasks, ...fallbackTasks];
  useGenerationTaskCache.getState().replaceHydratedTasks(canvasId, tasks);
  return tasks;
}

export function clearHydratedGenerationTasks() {
  hydrationRequestSequence += 1;
  useGenerationTaskCache.getState().clearHydratedTasks();
}

export function isGenerationTaskTerminal(status: GenerationTaskStatus) {
  return TERMINAL_STATUSES.has(status);
}

export function isGenerationTaskActive(task: GenerationTaskDto | undefined) {
  return Boolean(task && ACTIVE_STATUSES.has(task.status));
}

export function requiresGenerationStopConfirmation(task: GenerationTaskDto | undefined) {
  return Boolean(isGenerationTaskActive(task) && Number(task?.remoteExecutionStartedAt || 0));
}

export function partitionGenerationStopTasks(tasks: GenerationTaskDto[]) {
  const activeTasks = tasks.filter((task) => isGenerationTaskActive(task));
  return {
    safeTasks: activeTasks.filter((task) => !requiresGenerationStopConfirmation(task)),
    confirmationTasks: activeTasks.filter(requiresGenerationStopConfirmation),
  };
}

export async function loadGenerationTasks(taskIds: string[]) {
  const ids = [...new Set(taskIds.filter(Boolean))];
  if (!ids.length) return [];
  const taskApi = window.forartGenerationTasks;
  if (taskApi?.getMany) {
    const tasks = await taskApi.getMany(ids);
    useGenerationTaskCache.getState().mergeTasks(tasks);
  } else if (taskApi?.get) {
    const tasks = (await Promise.all(ids.map((taskId) => taskApi.get(taskId)))).filter((task): task is GenerationTaskDto => Boolean(task));
    useGenerationTaskCache.getState().mergeTasks(tasks);
  }
  const tasksById = useGenerationTaskCache.getState().tasksById;
  return ids.map((taskId) => tasksById[taskId]).filter((task): task is GenerationTaskDto => Boolean(task));
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
