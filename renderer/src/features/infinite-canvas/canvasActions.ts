import { createContext, useContext } from "react";
import { i18n } from "../../i18n";
import type { ImageGenerationRunOptions, NativeCanvasAssetType, NativeCanvasNodeData } from "./nativeCanvas";
import type { DerivedAssetKind } from "./assetNaming";
import type { NativeCanvasImageAdjustments } from "./imageAdjustments";
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
  /**
   * 按选区裁剪出一张新图。
   * mode 为 "newNode"（默认）时落成派生素材节点，原图不动；
   * mode 为 "overwrite" 时用裁剪结果替换该节点自己的图。
   */
  cropNodeImage: (
    nodeId: string,
    crop: CanvasImageCropRect,
    options?: { mode?: "newNode" | "overwrite" },
  ) => Promise<void>;
  /**
   * 按调整参数渲染一张新图。
   * mode 为 "newNode"（默认）时落成派生素材节点，原图不动；
   * mode 为 "overwrite" 时用结果替换该节点自己的图。
   */
  adjustNodeImage: (
    nodeId: string,
    adjustments: NativeCanvasImageAdjustments,
    options?: { imageIndex?: number; localSourceUrl?: string; mode?: "newNode" | "overwrite" },
  ) => Promise<void>;
  /** 打开图片调整窗口；窗口由画布页面统一托管，节点只负责发起。 */
  openImageAdjustDialog: (nodeId: string, imageIndex?: number) => void;
  createDerivedAssetNode: (sourceNodeId: string, asset: CanvasStoredAsset, options: {
    kind: DerivedAssetKind;
    label: string;
    assetType?: NativeCanvasAssetType;
  }) => void;
  createAssetNodeFromResult: (request: CanvasResultAssetRequest) => void;
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
  patchBatchImageGeneratorItemSilently: (nodeId: string, itemId: string, patch: Partial<import("./nativeCanvas").BatchImageGeneratorItem>) => void;
  patchActionFissionSelectionSilently: (nodeId: string, actionFission: NonNullable<NativeCanvasNodeData["actionFission"]>) => void;
  runImageGeneration: (nodeId: string, options?: ImageGenerationRunOptions) => Promise<void>;
  runActionFission: (nodeId: string, rowId?: string) => Promise<void>;
  runBatchImageGeneration: (nodeId: string, itemId?: string) => Promise<void>;
  removeCanvasEdge: (edgeId: string) => void;
  reorderImageGeneratorReferences: (nodeId: string, orderedEdgeIds: string[]) => void;
  setNodeAsset: (nodeId: string, assetUrl: string, fileName: string, assetType?: NativeCanvasAssetType, assetMimeType?: string, metadata?: { width?: number; height?: number; durationMs?: number; sizeBytes?: number; thumbUrl?: string }) => void;
  setNodeText: (nodeId: string, text: string) => void;
  stopImageGeneration: (nodeId: string) => Promise<void>;
  stopActionFission: (nodeId: string, rowId?: string) => Promise<void>;
  stopBatchImageGeneration: (nodeId: string, itemId?: string) => Promise<void>;
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

/**
 * 把批量类节点某个卡片的结果图复制成一个独立的素材节点。
 * clientPoint 是按钮点击处的屏幕坐标：新节点落在这个位置向右下偏移一点，
 * 这样它总是出现在用户刚刚操作的那张卡片旁边。
 */
export interface CanvasResultAssetRequest {
  sourceNodeId: string;
  /** 结果所属的卡片标识（动作裂变行 id / 批量项 id），用于连续创建时错开位置。 */
  sourceKey?: string;
  url: string;
  thumbUrl?: string;
  fileName?: string;
  width?: number;
  height?: number;
  clientPoint?: { x: number; y: number };
}

/**
 * 裁剪选区。坐标一律是百分比（0-100），由主进程按源图的**真实**尺寸换算成像素。
 *
 * 之前传的是像素：渲染端得先知道原图尺寸，可节点里可能根本没记（老数据 / 缩略图预览），
 * 于是百分比被换算到缩略图的坐标系里，主进程却拿它去裁原图，结果永远裁到左上角。
 */
export interface CanvasImageCropRect {
  unit: "percent";
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
