import { memo, type PointerEvent } from "react";
import type { ApiProvider } from "../../settings/apiProviders";
import type { ActionEntry, ActionTag } from "../../action-library/types";
import type { ActionFissionRow } from "../action-fission/actionFissionTypes";
import { isImageLikeNode } from "../nodePredicates";
import type { CanvasGenerationTask, CanvasNode, CropRect } from "../types";
import { ActionFissionNodeBody } from "./ActionFissionNodeBody";
import { ImageNodeBody } from "./ImageNodeBody";
import { LlmNodeBody } from "./LlmNodeBody";
import { PromptNodeBody } from "./PromptNodeBody";

export interface CanvasNodeBodyActions {
  openSelectChange: (selectId: string) => void;
  setFileInputRef: (nodeId: string, input: HTMLInputElement | null) => void;
  loadFiles: (nodeId: string, files: FileList | File[]) => void;
  loadClick: (nodeId: string) => void;
  libraryClick: (nodeId: string) => void;
  previewImage: (nodeId: string) => void;
  downloadImage: (nodeId: string) => void;
  patchNode: (nodeId: string, patch: Partial<CanvasNode>) => void;
  startCropInteraction: (event: PointerEvent<HTMLDivElement | HTMLButtonElement>, nodeId: string, mode: "move" | "resize") => void;
  cropPointerMove: (event: PointerEvent<HTMLElement>) => void;
  stopCropInteraction: (event: PointerEvent<HTMLElement>) => void;
  runLlm: (nodeId: string) => void;
  stopLlm: (nodeId: string) => void;
  runLibtvImageGenerator: (nodeId: string) => void;
  stopLibtvImageGenerator: (nodeId: string) => void;
  editingPromptChange: (nodeId: string, editing: boolean) => void;
  commitPrompt: (nodeId: string, text: string) => void;
  patchPrompt: (nodeId: string, patch: Partial<CanvasNode>) => void;
  imageProviders: ApiProvider[];
  defaultImageProvider: ApiProvider | null;
  draggedInputConnectionId: string;
  removeInput: (connectionId: string) => void;
  reorderInput: (nodeId: string, connectionId: string, imageInsertIndex: number) => void;
  createImageReference: (nodeId: string, files: FileList | File[]) => void;
  draggedInputConnectionIdChange: (connectionId: string) => void;
  refreshActionFissionRow: (nodeId: string, rowId: string, actions: ActionEntry[], tags: ActionTag[]) => void;
  runActionFissionRow: (nodeId: string, rowId: string, actions: ActionEntry[], tags: ActionTag[]) => void;
  stopActionFissionRow: (nodeId: string, rowId: string) => void;
  beforeRemoveActionFissionRow?: (nodeId: string, rowId: string) => void | Promise<void>;
  runAllActionFissionRows: (nodeId: string, rowsData: Array<{ rowId: string; actions: ActionEntry[]; tags: ActionTag[] }>) => void;
  switchAllActionFissionRows: (nodeId: string, rowsData: Array<{ rowId: string; actions: ActionEntry[]; tags: ActionTag[] }>) => void;
  downloadAllActionFissionRows: (nodeId: string, rowsData: Array<{ rowId: string }>) => void;
  stopAllActionFissionRows: (nodeId: string) => void;
  previewActionFissionResult: (nodeId: string, row: ActionFissionRow) => void;
  previewActionFissionAction: (nodeId: string, row: ActionFissionRow) => void;
  downloadActionFissionResult: (nodeId: string, row: ActionFissionRow) => void;
  actionFissionDownloadStatusKey: string;
  showMediaStatus: (status: { nodeId: string; tone: "busy" | "ready" | "error"; text: string }) => void;
  getGenerationTaskForTarget?: (target: { type: "imageGenerator"; nodeId: string } | { type: "actionFissionRow"; nodeId: string; rowId: string }) => CanvasGenerationTask | null;
  isGenerationTargetActive?: (target: { type: "imageGenerator"; nodeId: string } | { type: "actionFissionRow"; nodeId: string; rowId: string }) => boolean;
  saveCanvasImageAsset: (source: { url?: string; dataUrl?: string; defaultName?: string; kind: "input" | "output" }) => Promise<{ url: string; fileName?: string; filePath?: string }>;
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

  if (node.type === "actionFission") {
    return (
      <ActionFissionNodeBody
        node={node}
        imageProviders={actions.imageProviders}
        defaultImageProvider={actions.defaultImageProvider}
        openSelectId={openSelectId}
        draggedInputConnectionId={actions.draggedInputConnectionId}
        onOpenSelectChange={actions.openSelectChange}
        onPatchNode={actions.patchNode}
        onRemoveInput={actions.removeInput}
        onReorderInput={actions.reorderInput}
        onCreateImageReference={actions.createImageReference}
        onDraggedInputConnectionIdChange={actions.draggedInputConnectionIdChange}
        onRefreshRow={actions.refreshActionFissionRow}
        onRunRow={actions.runActionFissionRow}
        onStopRow={actions.stopActionFissionRow}
        onBeforeRemoveRow={actions.beforeRemoveActionFissionRow}
        onRunAllRows={actions.runAllActionFissionRows}
        onSwitchAllRows={actions.switchAllActionFissionRows}
        onDownloadAllRows={actions.downloadAllActionFissionRows}
        onStopAllRows={actions.stopAllActionFissionRows}
        onPreviewResult={actions.previewActionFissionResult}
        onPreviewAction={actions.previewActionFissionAction}
        onDownloadResult={actions.downloadActionFissionResult}
        onMediaStatus={actions.showMediaStatus}
        downloadStatusKey={actions.actionFissionDownloadStatusKey}
        getGenerationTaskForTarget={actions.getGenerationTaskForTarget}
        isGenerationTargetActive={actions.isGenerationTargetActive}
        saveCanvasImageAsset={actions.saveCanvasImageAsset}
      />
    );
  }

  if (isImageLikeNode(node)) {
    return (
      <ImageNodeBody
        node={node}
        cropRect={cropRect}
        setFileInputRef={(input) => actions.setFileInputRef(node.id, input)}
        onFiles={(files) => {
          if (node.type === "imageLoader") actions.loadFiles(node.id, files);
        }}
        onLoadClick={() => {
          if (node.type === "imageLoader") actions.loadClick(node.id);
        }}
        onLibraryClick={() => {
          if (node.type === "imageLoader") actions.libraryClick(node.id);
        }}
        onPreview={() => actions.previewImage(node.id)}
        onDownload={() => actions.downloadImage(node.id)}
        isDownloadBusy={isDownloadBusy}
        generationTask={node.type === "imageGenerator" ? node.generationTask || null : null}
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

  if (node.type === "prompt") {
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
