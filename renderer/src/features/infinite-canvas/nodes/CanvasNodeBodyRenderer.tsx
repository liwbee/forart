import { memo, type PointerEvent } from "react";
import type { ApiProvider } from "../../settings/apiProviders";
import { isImageLikeNode } from "../nodePredicates";
import type { CanvasNode, CropRect } from "../types";
import { ImageNodeBody } from "./ImageNodeBody";
import { LlmNodeBody } from "./LlmNodeBody";
import { PromptNodeBody } from "./PromptNodeBody";

export interface CanvasNodeBodyActions {
  openSelectChange: (selectId: string) => void;
  setFileInputRef: (nodeId: string, input: HTMLInputElement | null) => void;
  uploadFiles: (nodeId: string, files: FileList | File[]) => void;
  uploadClick: (nodeId: string) => void;
  libraryClick: (nodeId: string) => void;
  previewImage: (nodeId: string) => void;
  downloadImage: (nodeId: string) => void;
  patchNode: (nodeId: string, patch: Partial<CanvasNode>) => void;
  startCropInteraction: (event: PointerEvent<HTMLDivElement | HTMLButtonElement>, nodeId: string, mode: "move" | "resize") => void;
  cropPointerMove: (event: PointerEvent<HTMLElement>) => void;
  stopCropInteraction: (event: PointerEvent<HTMLElement>) => void;
  runLlm: (nodeId: string) => void;
  stopLlm: (nodeId: string) => void;
  editingPromptChange: (nodeId: string, editing: boolean) => void;
  commitPrompt: (nodeId: string, text: string) => void;
  patchPrompt: (nodeId: string, patch: Partial<CanvasNode>) => void;
}

interface CanvasNodeBodyRendererProps {
  node: CanvasNode;
  cropRect: CropRect | null;
  isDownloadBusy: boolean;
  chatProviders: ApiProvider[];
  defaultChatProvider: ApiProvider | null;
  openSelectId: string;
  isEditingPrompt: boolean;
  actions: CanvasNodeBodyActions;
}

export const CanvasNodeBodyRenderer = memo(function CanvasNodeBodyRenderer({
  node,
  cropRect,
  isDownloadBusy,
  chatProviders,
  defaultChatProvider,
  openSelectId,
  isEditingPrompt,
  actions,
}: CanvasNodeBodyRendererProps) {
  const onPatch = (patch: Partial<CanvasNode>) => actions.patchNode(node.id, patch);

  if (isImageLikeNode(node)) {
    return (
      <ImageNodeBody
        node={node}
        cropRect={cropRect}
        setFileInputRef={(input) => actions.setFileInputRef(node.id, input)}
        onFiles={(files) => {
          if (node.type === "image" || node.type === "libtvUpload") actions.uploadFiles(node.id, files);
        }}
        onUploadClick={() => {
          if (node.type === "image" || node.type === "libtvUpload") actions.uploadClick(node.id);
        }}
        onLibraryClick={() => {
          if (node.type === "image" || node.type === "libtvUpload") actions.libraryClick(node.id);
        }}
        onPreview={() => actions.previewImage(node.id)}
        onDownload={() => actions.downloadImage(node.id)}
        isDownloadBusy={isDownloadBusy}
        onStartCropInteraction={(event, mode) => actions.startCropInteraction(event, node.id, mode)}
        onCropPointerMove={actions.cropPointerMove}
        onStopCropInteraction={actions.stopCropInteraction}
      />
    );
  }

  if (node.type === "llm") {
    const selectedProvider = chatProviders.find((provider) => provider.id === node.chatProviderId)
      || defaultChatProvider
      || chatProviders[0]
      || null;
    const selectedModel = node.chatModel && selectedProvider?.chatModels.includes(node.chatModel) ? node.chatModel : selectedProvider?.chatModels[0] || "";
    const selectId = `${node.id}:llm-model`;
    return (
      <LlmNodeBody
        node={node}
        providers={chatProviders}
        selectedProvider={selectedProvider}
        selectedModel={selectedModel}
        selectOpen={openSelectId === selectId}
        onSelectOpenChange={(open) => actions.openSelectChange(open ? selectId : "")}
        onPatch={onPatch}
        onRun={() => actions.runLlm(node.id)}
        onStop={() => actions.stopLlm(node.id)}
      />
    );
  }

  if (node.type === "prompt" || node.type === "libtvPrompt") {
    return (
      <PromptNodeBody
        node={node}
        isEditing={isEditingPrompt}
        onEditingChange={(editing) => actions.editingPromptChange(node.id, editing)}
        onCommit={(text) => actions.commitPrompt(node.id, text)}
        onPatch={(patch) => actions.patchPrompt(node.id, patch)}
      />
    );
  }

  return null;
});
