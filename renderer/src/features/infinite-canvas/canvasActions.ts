import { createContext, useContext } from "react";
import { i18n } from "../../i18n";
import type { ImageGenerationRunOptions, NativeCanvasAssetType, NativeCanvasNodeData } from "./nativeCanvas";
import type {
  ImageGeneratorPromptInput,
  ImageGeneratorReferenceInput,
} from "./generation/imageGenerationInputs";

export interface NativeCanvasActions {
  readOnly: boolean;
  beginHistoryGesture: () => void;
  endHistoryGesture: () => void;
  undoCanvasHistory: () => void;
  redoCanvasHistory: () => void;
  addImageReferenceFiles: (nodeId: string, files: File[]) => Promise<void>;
  cropNodeImage: (nodeId: string, crop: CanvasImageCropRect) => Promise<void>;
  createDerivedAssetNode: (sourceNodeId: string, asset: CanvasStoredAsset, label: string, assetType?: NativeCanvasAssetType) => void;
  downloadActionFissionResult: (nodeId: string, rowId: string) => Promise<void>;
  downloadNodeImage: (nodeId: string, imageIndex: number) => Promise<void>;
  discardActionFissionRow: (nodeId: string, rowId: string) => Promise<void>;
  getImageGeneratorPrompts: (nodeId: string) => ImageGeneratorPromptInput[];
  getImageGeneratorReferences: (nodeId: string) => ImageGeneratorReferenceInput[];
  openLibraryForNode: (nodeId: string) => void;
  openLibraryForReference: (nodeId: string) => void;
  openActionFissionRowSettings: (nodeId: string, rowId: string) => void;
  patchNodeData: (nodeId: string, patch: Partial<NativeCanvasNodeData>) => void;
  patchNodeDataSilently: (nodeId: string, patch: Partial<NativeCanvasNodeData>) => void;
  patchActionFissionSelectionSilently: (nodeId: string, actionFission: NonNullable<NativeCanvasNodeData["actionFission"]>) => void;
  runImageGeneration: (nodeId: string, options?: ImageGenerationRunOptions) => Promise<void>;
  runActionFission: (nodeId: string, rowId?: string) => Promise<void>;
  removeCanvasEdge: (edgeId: string) => void;
  reorderImageGeneratorReferences: (nodeId: string, orderedEdgeIds: string[]) => void;
  setNodeAsset: (nodeId: string, assetUrl: string, fileName: string, assetType?: NativeCanvasAssetType, assetMimeType?: string, metadata?: { width?: number; height?: number; durationMs?: number; sizeBytes?: number; thumbUrl?: string }) => void;
  setNodeText: (nodeId: string, text: string) => void;
  stopImageGeneration: (nodeId: string) => Promise<void>;
  stopActionFission: (nodeId: string, rowId?: string) => Promise<void>;
}

export interface CanvasStoredAsset {
  url: string;
  thumbUrl?: string;
  fileName: string;
  filePath?: string;
  thumbFilePath?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  sizeBytes?: number;
}

export interface CanvasImageCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const NativeCanvasActionsContext = createContext<NativeCanvasActions | null>(null);

export function useNativeCanvasActions() {
  const actions = useContext(NativeCanvasActionsContext);
  if (!actions) throw new Error("NativeCanvasActionsContext is missing.");
  return actions;
}

export function readImageFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error(i18n.t("infiniteCanvas:imageReadFailed")));
    reader.onerror = () => reject(reader.error || new Error(i18n.t("infiniteCanvas:imageReadFailed")));
    reader.readAsDataURL(file);
  });
}

export function readImageDimensions(imageUrl: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error(i18n.t("infiniteCanvas:imageDimensionsReadFailed")));
    image.src = imageUrl;
  });
}

/**
 * Read dimensions directly from a File without first converting the whole
 * image to a data URL. This is used to size an upload placeholder before the
 * expensive asset/thumbnail work starts.
 */
export function readImageFileDimensions(file: File) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
      image.onload = null;
      image.onerror = null;
    };
    image.onload = () => {
      const dimensions = { width: image.naturalWidth, height: image.naturalHeight };
      cleanup();
      if (dimensions.width > 0 && dimensions.height > 0) resolve(dimensions);
      else reject(new Error(i18n.t("infiniteCanvas:imageDimensionsReadFailed")));
    };
    image.onerror = () => {
      cleanup();
      reject(new Error(i18n.t("infiniteCanvas:imageDimensionsReadFailed")));
    };
    image.src = objectUrl;
  });
}

export function isCanvasAssetFile(file: File) {
  return file.type.startsWith("image/") || file.type.startsWith("video/")
    || /\.(mp4|m4v|mov|webm)$/i.test(file.name);
}

export function readMediaFileDimensions(file: File) {
  if (file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|avif|bmp|svg)$/i.test(file.name)) {
    return readImageFileDimensions(file);
  }
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement("video");
    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute("src");
      video.load();
    };
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const dimensions = { width: video.videoWidth, height: video.videoHeight };
      cleanup();
      dimensions.width > 0 && dimensions.height > 0
        ? resolve(dimensions)
        : reject(new Error(i18n.t("infiniteCanvas:imageDimensionsReadFailed")));
    };
    video.onerror = () => {
      cleanup();
      reject(new Error(i18n.t("infiniteCanvas:imageDimensionsReadFailed")));
    };
    video.src = objectUrl;
  });
}
