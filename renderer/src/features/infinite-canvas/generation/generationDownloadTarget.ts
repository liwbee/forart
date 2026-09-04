import type { GenerationTaskDto } from "../../../app/appConfig";
import type { ActionFissionRow } from "../action-fission/actionFissionTypes";

export function generationTaskImageAt(task: Pick<GenerationTaskDto, "result"> | undefined, imageIndex: number) {
  const safeIndex = Math.max(0, Math.trunc(Number(imageIndex || 0)));
  return task?.result?.images[safeIndex] || null;
}

export function actionFissionDownloadTarget(
  row: Pick<ActionFissionRow, "resultUrl" | "resultFileName">,
  task: Pick<GenerationTaskDto, "result"> | undefined,
) {
  const taskImage = generationTaskImageAt(task, 0);
  // The terminal task result is authoritative while the canvas row writeback
  // is catching up. A stale row.resultUrl must not mask a newly generated
  // image that is already visible in the task center.
  const imageUrl = String(taskImage?.assetUrl || row.resultUrl || "").trim();
  if (!imageUrl) return null;
  return {
    imageUrl,
    fileName: String(taskImage?.fileName || row.resultFileName || "").trim(),
  };
}
