import type { GenerationTaskDto } from "../../../app/appConfig";
import type { NativeGenerationResult } from "../nativeCanvas";

type TaskResultImage = NonNullable<GenerationTaskDto["result"]>["images"][number];

interface DownloadMarker {
  downloadState: "pending" | "downloaded";
  downloadedAt?: number;
}

export function downloadMarkerForTaskResult(
  currentTaskId: string,
  resultTaskId: string,
  currentAssetUrl: string,
  resultAssetUrl: string,
  currentState?: "pending" | "downloaded",
  currentDownloadedAt?: number,
): DownloadMarker {
  const preservesDownloaded = currentTaskId === resultTaskId
    && currentAssetUrl === resultAssetUrl
    && currentState === "downloaded";
  return preservesDownloaded
    ? { downloadState: "downloaded", downloadedAt: currentDownloadedAt }
    : { downloadState: "pending", downloadedAt: undefined };
}

export function nativeResultsFromTask(
  currentTaskId: string,
  resultTaskId: string,
  currentResults: NativeGenerationResult[],
  taskImages: TaskResultImage[],
): NativeGenerationResult[] {
  return taskImages.map((image) => {
    const existing = currentResults.find((result) => (
      String(result.localUrl || result.url || "") === image.assetUrl
    ));
    return {
      url: image.assetUrl,
      localUrl: image.assetUrl,
      thumbUrl: image.thumbUrl,
      fileName: image.fileName,
      width: image.width,
      height: image.height,
      ...downloadMarkerForTaskResult(
        currentTaskId,
        resultTaskId,
        String(existing?.localUrl || existing?.url || ""),
        image.assetUrl,
        existing?.downloadState,
        existing?.downloadedAt,
      ),
    };
  });
}
