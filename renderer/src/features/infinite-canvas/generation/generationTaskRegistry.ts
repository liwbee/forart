import type { CanvasGenerationTarget, CanvasGenerationTask } from "../types";

function normalizeTarget(input: unknown, fallbackNodeId = ""): CanvasGenerationTarget {
  const value = input && typeof input === "object" ? input as Partial<CanvasGenerationTarget> : {};
  if (value.type === "actionFissionRow") {
    return {
      type: "actionFissionRow",
      nodeId: String(value.nodeId || fallbackNodeId),
      rowId: String(value.rowId || ""),
    };
  }
  return {
    type: "imageGenerator",
    nodeId: String(value.nodeId || fallbackNodeId),
  };
}

export function normalizeGenerationTask(input: unknown): CanvasGenerationTask | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Partial<CanvasGenerationTask>;
  const nodeId = String(value.nodeId || value.target?.nodeId || "");
  const id = String(value.id || "");
  const canvasId = String(value.canvasId || "");
  if (!id || !canvasId || !nodeId) return null;
  const result = value.result && typeof value.result === "object" ? value.result : undefined;
  return {
    id,
    canvasId,
    nodeId,
    target: normalizeTarget(value.target, nodeId),
    kind: "image",
    providerId: String(value.providerId || ""),
    model: String(value.model || ""),
    upstreamTaskId: value.upstreamTaskId ? String(value.upstreamTaskId) : undefined,
    status: value.status || "queued",
    startedAt: Number(value.startedAt || Date.now()),
    updatedAt: Number(value.updatedAt || Date.now()),
    completedAt: value.completedAt ? Number(value.completedAt) : undefined,
    durationMs: value.durationMs ? Number(value.durationMs) : undefined,
    prompt: value.prompt,
    referenceImages: Array.isArray(value.referenceImages) ? value.referenceImages.map(String).filter(Boolean) : [],
    resolution: value.resolution,
    aspectRatio: value.aspectRatio,
    message: value.message,
    error: value.error,
    interruptReason: value.interruptReason === "user_stop" || value.interruptReason === "app_restart" || value.interruptReason === "provider_lost" || value.interruptReason === "superseded"
      ? value.interruptReason
      : undefined,
    result: result ? {
      url: result.url,
      localUrl: result.localUrl,
      fileName: result.fileName,
      width: result.width,
      height: result.height,
    } : undefined,
  };
}

export async function createLocalGenerationTask(task: CanvasGenerationTask): Promise<CanvasGenerationTask> {
  const created = await window.easyTool?.createGenerationTask?.(task);
  return normalizeGenerationTask(created) || task;
}

export async function updateLocalGenerationTask(taskId: string, patch: Partial<CanvasGenerationTask>): Promise<CanvasGenerationTask | null> {
  if (!taskId || !window.easyTool?.updateGenerationTask) return null;
  try {
    return normalizeGenerationTask(await window.easyTool.updateGenerationTask(taskId, patch));
  } catch {
    return null;
  }
}

export async function getLocalGenerationTask(taskId: string): Promise<CanvasGenerationTask | null> {
  if (!taskId || !window.easyTool?.getGenerationTask) return null;
  return normalizeGenerationTask(await window.easyTool.getGenerationTask(taskId));
}

export async function resumeLocalGenerationTask(taskId: string, payload?: unknown): Promise<CanvasGenerationTask | null> {
  if (!taskId || !window.easyTool?.resumeGenerationTask) return null;
  return normalizeGenerationTask(await window.easyTool.resumeGenerationTask(taskId, payload));
}

export async function stopLocalGenerationTask(taskId: string): Promise<CanvasGenerationTask | null> {
  if (!taskId || !window.easyTool?.stopGenerationTask) return null;
  return normalizeGenerationTask(await window.easyTool.stopGenerationTask(taskId));
}

export async function stopLocalGenerationTasksForTarget(canvasId: string, target: CanvasGenerationTarget): Promise<CanvasGenerationTask[]> {
  if (!canvasId || !window.easyTool?.stopGenerationTasksForTarget) return [];
  const result = await window.easyTool.stopGenerationTasksForTarget(canvasId, target);
  return Array.isArray(result.tasks) ? result.tasks.map(normalizeGenerationTask).filter(Boolean) as CanvasGenerationTask[] : [];
}

export async function stopLocalGenerationTasksForNode(canvasId: string, nodeId: string): Promise<CanvasGenerationTask[]> {
  if (!canvasId || !nodeId || !window.easyTool?.stopGenerationTasksForNode) return [];
  const result = await window.easyTool.stopGenerationTasksForNode(canvasId, nodeId);
  return Array.isArray(result.tasks) ? result.tasks.map(normalizeGenerationTask).filter(Boolean) as CanvasGenerationTask[] : [];
}

export async function stopLocalGenerationTasksForCanvas(canvasId: string): Promise<CanvasGenerationTask[]> {
  if (!canvasId || !window.easyTool?.stopGenerationTasksForCanvas) return [];
  const result = await window.easyTool.stopGenerationTasksForCanvas(canvasId);
  return Array.isArray(result.tasks) ? result.tasks.map(normalizeGenerationTask).filter(Boolean) as CanvasGenerationTask[] : [];
}

export async function waitForLocalGenerationTask(
  taskId: string,
  onTask?: (task: CanvasGenerationTask) => void,
  signal?: AbortSignal,
): Promise<CanvasGenerationTask> {
  let lastTask: CanvasGenerationTask | null = null;
  while (true) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const task = await getLocalGenerationTask(taskId);
    if (!task) {
      if (lastTask && (
        lastTask.status === "succeeded"
        || lastTask.status === "failed"
        || lastTask.status === "interrupted"
        || lastTask.status === "superseded"
      )) return lastTask;
      throw new Error("Generation task not found.");
    }
    lastTask = task;
    onTask?.(task);
    if (task.status === "succeeded" || task.status === "failed" || task.status === "interrupted" || task.status === "superseded") return task;
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(resolve, 1000);
      const abort = () => {
        window.clearTimeout(timeout);
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal?.addEventListener("abort", abort, { once: true });
    });
  }
}
