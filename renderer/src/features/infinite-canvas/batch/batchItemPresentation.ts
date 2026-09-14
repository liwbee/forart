import type { GenerationTaskDto } from "../../../app/appConfig";
import type { BatchNodeItemBase } from "./batchNodeTypes";

export function isBatchItemActive(item: BatchNodeItemBase | undefined, task?: GenerationTaskDto) {
  return Boolean(
    task && ["queued", "preparing", "submitting", "running", "result_processing"].includes(task.status)
  ) || item?.status === "queued" || item?.status === "running";
}

export function resolveBatchItemResult(item: BatchNodeItemBase | undefined, task?: GenerationTaskDto) {
  const image = task?.result?.images?.[0];
  const legacy = item as (BatchNodeItemBase & { resultUrl?: string; resultThumbUrl?: string; resultFileName?: string; resultWidth?: number; resultHeight?: number }) | undefined;
  return {
    url: image?.assetUrl || legacy?.resultUrl || item?.result?.url || "",
    thumbUrl: image?.thumbUrl || legacy?.resultThumbUrl || item?.result?.thumbUrl || "",
    fileName: image?.fileName || legacy?.resultFileName || item?.result?.fileName || "",
    width: image?.width || legacy?.resultWidth || item?.result?.width,
    height: image?.height || legacy?.resultHeight || item?.result?.height,
  };
}

export interface BatchItemAggregate {
  total: number;
  completed: number;
  active: number;
  failed: number;
  tone: "idle" | "ready" | "queued" | "running" | "completed" | "error";
}

export function aggregateBatchItems<T extends BatchNodeItemBase>(items: T[], tasksById: Partial<Record<string, GenerationTaskDto>>): BatchItemAggregate {
  const completed = items.filter((item) => Boolean(resolveBatchItemResult(item, item.latestGenerationTaskId ? tasksById[item.latestGenerationTaskId] : undefined).url)).length;
  const active = items.filter((item) => isBatchItemActive(item, item.latestGenerationTaskId ? tasksById[item.latestGenerationTaskId] : undefined)).length;
  const failed = items.filter((item) => item.status === "failed" || (item.latestGenerationTaskId && tasksById[item.latestGenerationTaskId]?.status === "failed")).length;
  const tone = failed ? "error" : active && items.some((item) => item.status === "running" || (item.latestGenerationTaskId && ["running", "result_processing"].includes(tasksById[item.latestGenerationTaskId]?.status || ""))) ? "running" : active ? "queued" : completed === items.length && items.length > 0 ? "completed" : completed > 0 ? "ready" : "idle";
  return { total: items.length, completed, active, failed, tone };
}

export function isBatchGenerationReady(items: readonly BatchNodeItemBase[], prompt: string, connectedPrompts: readonly string[] = []) {
  const hasSource = items.some((item) => Boolean((item as BatchNodeItemBase & { sourceUrl?: string }).sourceUrl));
  const hasPrompt = Boolean([prompt, ...connectedPrompts].some((value) => String(value || "").trim()));
  return hasSource && hasPrompt;
}

export async function downloadBatchItemsSequentially<T>(items: T[], download: (item: T, index: number) => Promise<void>) {
  for (const [index, item] of items.entries()) {
    try { await download(item, index); } catch { /* individual download action reports its own error */ }
  }
}
