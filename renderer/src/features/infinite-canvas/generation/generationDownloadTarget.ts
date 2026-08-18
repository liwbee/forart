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
  const imageUrl = String(row.resultUrl || taskImage?.assetUrl || "").trim();
  if (!imageUrl) return null;
  return {
    imageUrl,
    fileName: String(row.resultFileName || taskImage?.fileName || "").trim(),
  };
}
