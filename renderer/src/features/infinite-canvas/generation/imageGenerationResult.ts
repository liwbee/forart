import { fitImageNodeSize, readImageDimensions } from "../imageCrop";
import type { ApiProvider } from "../../settings/apiProviders";
import type { CanvasGenerationTask, CanvasNode } from "../types";
import type { ImageGenerationResult } from "../core/apiImageGeneration";

interface SavedCanvasAsset {
  url: string;
  fileName?: string;
  filePath?: string;
}

export interface ApplyImageGenerationResultOptions {
  canvasId: string;
  nodeId: string;
  provider: ApiProvider;
  model: string;
  resolution?: CanvasNode["imageResolution"];
  aspectRatio?: CanvasNode["imageAspectRatio"];
  result: ImageGenerationResult;
  task?: CanvasGenerationTask;
  signal?: AbortSignal;
  saveCanvasImageAsset: (source: { url?: string; dataUrl?: string; defaultName?: string; kind: "input" | "output" }) => Promise<SavedCanvasAsset>;
  patchGenerationNode: (canvasId: string, nodeId: string, resolvePatch: (node: CanvasNode) => Partial<CanvasNode>) => Promise<void>;
}

export async function applyImageGenerationResult({
  canvasId,
  nodeId,
  provider,
  model,
  resolution,
  aspectRatio,
  result,
  task,
  signal,
  saveCanvasImageAsset,
  patchGenerationNode,
}: ApplyImageGenerationResultOptions) {
  const saved = await saveCanvasImageAsset({ url: result.url, defaultName: result.fileName, kind: "output" });
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const dimensions = await readImageDimensions(saved.url);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const nextSize = dimensions ? fitImageNodeSize(dimensions.width, dimensions.height) : fitImageNodeSize(result.width || 1024, result.height || 1024);
  await patchGenerationNode(canvasId, nodeId, (currentNode) => ({
    url: saved.url,
    fileName: saved.fileName || result.fileName,
    imageProviderId: provider.id,
    imageModel: model,
    imageResolution: resolution,
    imageAspectRatio: aspectRatio,
    imageMode: "imageGenerator",
    imageSource: "generated",
    outputDownloadState: "pending",
    outputDownloadedAt: undefined,
    imageNaturalWidth: dimensions?.width || result.width || 1024,
    imageNaturalHeight: dimensions?.height || result.height || 1024,
    running: false,
    generationError: "",
    generationStatus: "",
    generationTask: {
      ...(currentNode.generationTask || task),
      id: (currentNode.generationTask || task)?.id || `${canvasId}:${nodeId}:recovered`,
      canvasId,
      nodeId,
      providerId: provider.id,
      model,
      status: "succeeded",
      startedAt: (currentNode.generationTask || task)?.startedAt || Date.now(),
      updatedAt: Date.now(),
    },
    ...nextSize,
  }));
}
