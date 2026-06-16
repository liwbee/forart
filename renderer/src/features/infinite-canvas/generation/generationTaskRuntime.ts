import type { CanvasGenerationTask } from "../types";

export function generationTaskRuntimeKey(task: CanvasGenerationTask) {
  return task.upstreamTaskId ? `${task.canvasId}:${task.nodeId}:${task.upstreamTaskId}` : task.id;
}

export function isRecoverableImageGenerationTask(task: CanvasGenerationTask | undefined): task is CanvasGenerationTask & { upstreamTaskId: string } {
  return Boolean(task?.upstreamTaskId && task.canvasId && task.nodeId && (task.status === "submitting" || task.status === "running"));
}
