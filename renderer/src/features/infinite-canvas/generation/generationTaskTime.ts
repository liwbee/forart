import type { CanvasGenerationTask } from "../types";

export function formatGenerationDuration(totalMs: number) {
  const totalSeconds = Math.max(0, Math.floor(totalMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function getGenerationElapsedMs(task: CanvasGenerationTask | undefined, now = Date.now()) {
  if (!task) return 0;
  if (task.durationMs !== undefined) return Math.max(0, Number(task.durationMs) || 0);
  const startedAt = Number(task.startedAt || 0);
  if (!startedAt) return 0;
  if (task.completedAt) return Math.max(0, Number(task.completedAt) - startedAt);
  return Math.max(0, now - startedAt);
}
