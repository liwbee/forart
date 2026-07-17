import { createContext, useContext } from "react";
import { i18n } from "../../i18n";
import type { NativeCanvasNodeData } from "./nativeCanvas";
import type {
  ImageGeneratorPromptInput,
  ImageGeneratorReferenceInput,
} from "./generation/imageGenerationInputs";

export interface NativeCanvasActions {
  addImageReferenceFiles: (nodeId: string, files: File[]) => Promise<void>;
  cropNodeImage: (nodeId: string, crop: CanvasImageCropRect) => Promise<void>;
  downloadActionFissionResult: (nodeId: string, rowId: string) => Promise<void>;
  downloadGeneratedImage: (nodeId: string, imageIndex: number) => Promise<void>;
  getImageGeneratorPrompts: (nodeId: string) => ImageGeneratorPromptInput[];
  getImageGeneratorReferences: (nodeId: string) => ImageGeneratorReferenceInput[];
  openLibraryForNode: (nodeId: string) => void;
  openLibraryForReference: (nodeId: string) => void;
  openActionFissionRowSettings: (nodeId: string, rowId: string) => void;
  patchNodeData: (nodeId: string, patch: Partial<NativeCanvasNodeData>) => void;
  runImageGeneration: (nodeId: string, options?: { promptOverride?: string }) => Promise<void>;
  runActionFission: (nodeId: string, rowId?: string) => Promise<void>;
  removeCanvasEdge: (edgeId: string) => void;
  reorderImageGeneratorReferences: (nodeId: string, orderedEdgeIds: string[]) => void;
  setNodeImage: (nodeId: string, imageUrl: string, label: string) => void;
  setNodeText: (nodeId: string, text: string) => void;
  stopImageGeneration: (nodeId: string) => Promise<void>;
  stopActionFission: (nodeId: string, rowId?: string) => Promise<void>;
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
