import type { GenerationTaskDto } from "../../../app/appConfig";
import type { ActionFissionRow } from "../action-fission/actionFissionTypes";
import { storedImageDownloadTarget } from "../assetNaming";

export function generationTaskImageAt(task: Pick<GenerationTaskDto, "result"> | undefined, imageIndex: number) {
  const safeIndex = Math.max(0, Math.trunc(Number(imageIndex || 0)));
  return task?.result?.images[safeIndex] || null;
}

/**
 * 动作裂变每一行的结果图。终态任务结果优先于节点回写：写回还在路上时，
 * 预览、下载、派生素材节点都必须看到同一张图。
 */
export function actionFissionResultImage(
  row: Pick<ActionFissionRow, "resultUrl" | "resultThumbUrl" | "resultFileName" | "resultWidth" | "resultHeight">,
  task: Pick<GenerationTaskDto, "result"> | undefined,
) {
  const taskImage = generationTaskImageAt(task, 0);
  return {
    url: String(taskImage?.assetUrl || row.resultUrl || ""),
    thumbUrl: String(taskImage?.thumbUrl || row.resultThumbUrl || ""),
    fileName: String(taskImage?.fileName || row.resultFileName || ""),
    width: Number(taskImage?.width || row.resultWidth || 0) || undefined,
    height: Number(taskImage?.height || row.resultHeight || 0) || undefined,
  };
}

export function actionFissionDownloadTarget(
  row: Pick<ActionFissionRow, "resultUrl" | "resultThumbUrl" | "resultFileName" | "resultWidth" | "resultHeight">,
  task: Pick<GenerationTaskDto, "result"> | undefined,
) {
  // The terminal task result is authoritative while the canvas row writeback
  // is catching up. A stale row.resultUrl must not mask a newly generated
  // image that is already visible in the task center.
  const image = actionFissionResultImage(row, task);
  return storedImageDownloadTarget({
    localUrl: image.url,
    fileName: image.fileName,
  });
}
