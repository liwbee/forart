import { Check, Crop, Download, Eye, Images, Play, Ratio, RefreshCw, Square, Trash2, Upload, X } from "lucide-react";
import { memo } from "react";
import type { useTranslation } from "react-i18next";
import type { ActionEntry, ActionTag } from "../../action-library/types";
import type { ApiProvider } from "../../settings/apiProviders";
import { resolveActionFissionBulkActions } from "../action-fission/actionFissionBulkActions";
import { normalizeActionFissionState } from "../action-fission/actionFissionState";
import type { ActionFissionRow } from "../action-fission/actionFissionTypes";
import { useActionFissionLibraryData } from "../action-fission/useActionFissionLibraryData";
import { CROP_ASPECT_OPTIONS } from "../constants";
import { isImageLikeNode } from "../nodePredicates";
import type { CanvasGenerationTarget, CanvasNode, CropAspectKey, CropRect, Viewport } from "../types";

interface NodeToolbarCropState {
  nodeId: string;
  rect: CropRect;
  aspect: CropAspectKey;
}

interface NodeToolbarDownloadStatus {
  nodeId: string;
  tone: "busy" | "ready" | "error";
}

interface NodeToolbarProps {
  node: CanvasNode | null;
  imageCrop: NodeToolbarCropState | null;
  selectedCount: number;
  stageSize: { width: number; height: number };
  viewport: Viewport;
  cropAspectMenuOpen: boolean;
  downloadStatus: NodeToolbarDownloadStatus | null;
  onCropAspectMenuOpenChange: (open: boolean) => void;
  onLoadImage: (nodeId: string) => void;
  onImportLibraryImage: (nodeId: string) => void;
  onOpenCrop: (nodeId: string) => void;
  onChangeCropAspect: (nodeId: string, aspect: CropAspectKey) => void;
  onApplyCrop: (nodeId: string) => void;
  onCancelCrop: () => void;
  onPreviewImage: (nodeId: string) => void;
  onDownloadImage: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  imageProviders: ApiProvider[];
  defaultImageProvider: ApiProvider | null;
  isGenerationTargetActive: (target: CanvasGenerationTarget) => boolean;
  onRunAllActionFissionRows: (nodeId: string, rowsData: Array<{ rowId: string; actions: ActionEntry[]; tags: ActionTag[] }>) => void;
  onSwitchAllActionFissionRows: (nodeId: string, rowsData: Array<{ rowId: string; actions: ActionEntry[]; tags: ActionTag[] }>) => void;
  onDownloadAllActionFissionRows: (nodeId: string, rowsData: Array<{ rowId: string }>) => void;
  onStopAllActionFissionRows: (nodeId: string) => void;
  t: ReturnType<typeof useTranslation>["t"];
}

function selectedProviderFor(stateProviderId: string | undefined, defaultImageProvider: ApiProvider | null, imageProviders: ApiProvider[]) {
  return imageProviders.find((provider) => provider.id === stateProviderId)
    || defaultImageProvider
    || null;
}

interface ActionFissionToolbarGroupProps {
  node: CanvasNode;
  imageProviders: ApiProvider[];
  defaultImageProvider: ApiProvider | null;
  isGenerationTargetActive: (target: CanvasGenerationTarget) => boolean;
  onRunAllRows: (nodeId: string, rowsData: Array<{ rowId: string; actions: ActionEntry[]; tags: ActionTag[] }>) => void;
  onSwitchAllRows: (nodeId: string, rowsData: Array<{ rowId: string; actions: ActionEntry[]; tags: ActionTag[] }>) => void;
  onDownloadAllRows: (nodeId: string, rowsData: Array<{ rowId: string }>) => void;
  onStopAllRows: (nodeId: string) => void;
  t: ReturnType<typeof useTranslation>["t"];
}

function ActionFissionToolbarGroup({
  node,
  imageProviders,
  defaultImageProvider,
  isGenerationTargetActive,
  onRunAllRows,
  onSwitchAllRows,
  onDownloadAllRows,
  onStopAllRows,
  t,
}: ActionFissionToolbarGroupProps) {
  const state = normalizeActionFissionState(node.actionFission);
  const { rowData } = useActionFissionLibraryData(state);
  const selectedProvider = selectedProviderFor(state.providerId, defaultImageProvider, imageProviders);
  const selectedModel = state.model && selectedProvider?.imageModels.includes(state.model) ? state.model : selectedProvider?.imageModels[0] || "";
  const isRowActive = (row: ActionFissionRow) => isGenerationTargetActive({ type: "actionFissionRow", nodeId: node.id, rowId: row.id });
  const bulkActions = resolveActionFissionBulkActions({ state, rowData, selectedProvider, selectedModel, isRowActive });
  const runLabel = bulkActions.isRunning ? t("infiniteCanvas:actionFissionStopAll") : t("infiniteCanvas:actionFissionRunAll");
  const runTooltip = bulkActions.isRunning ? `${runLabel} ${bulkActions.completedRows} / ${bulkActions.totalRows}` : runLabel;

  return (
    <>
      <span className="ic-node-toolbar-group">
        <button
          type="button"
          data-tooltip={t("infiniteCanvas:actionFissionDownloadAll")}
          aria-label={t("infiniteCanvas:actionFissionDownloadAll")}
          disabled={bulkActions.isRunning || !bulkActions.downloadableRowsData.length}
          onClick={() => onDownloadAllRows(node.id, bulkActions.downloadableRowsData)}
        >
          <Download size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          data-tooltip={t("infiniteCanvas:actionFissionSwitchAllActions")}
          aria-label={t("infiniteCanvas:actionFissionSwitchAllActions")}
          disabled={bulkActions.isRunning || !bulkActions.canSwitchAll}
          onClick={() => onSwitchAllRows(node.id, bulkActions.switchableRowsData)}
        >
          <RefreshCw size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`ic-node-toolbar-action-fission-run${bulkActions.isRunning ? " is-stop" : ""}`}
          data-tooltip={runTooltip}
          aria-label={runTooltip}
          disabled={!bulkActions.isRunning && !bulkActions.canRunAll}
          onClick={() => {
            if (bulkActions.isRunning) {
              onStopAllRows(node.id);
              return;
            }
            onRunAllRows(node.id, bulkActions.runnableRowsData);
          }}
        >
          {bulkActions.isRunning ? <Square size={13} fill="currentColor" aria-hidden="true" /> : <Play size={15} fill="currentColor" aria-hidden="true" />}
          {bulkActions.isRunning ? <span>{`${bulkActions.completedRows}/${bulkActions.totalRows}`}</span> : null}
        </button>
      </span>
      <span className="ic-node-toolbar-separator" aria-hidden="true" />
    </>
  );
}

export const NodeToolbar = memo(function NodeToolbar({
  node,
  imageCrop,
  selectedCount,
  stageSize,
  viewport,
  cropAspectMenuOpen,
  downloadStatus,
  onCropAspectMenuOpenChange,
  onLoadImage,
  onImportLibraryImage,
  onOpenCrop,
  onChangeCropAspect,
  onApplyCrop,
  onCancelCrop,
  onPreviewImage,
  onDownloadImage,
  onDeleteNode,
  imageProviders,
  defaultImageProvider,
  isGenerationTargetActive,
  onRunAllActionFissionRows,
  onSwitchAllActionFissionRows,
  onDownloadAllActionFissionRows,
  onStopAllActionFissionRows,
  t,
}: NodeToolbarProps) {
  if (!node) return null;
  const isCropping = imageCrop?.nodeId === node.id;
  if (selectedCount > 1 && !isCropping) return null;
  const left = stageSize.width / 2 + (node.x + node.w / 2) * viewport.scale + viewport.x;
  const top = stageSize.height / 2 + node.y * viewport.scale + viewport.y - 14;

  return (
    <div
      className={`ic-node-hover-toolbar ic-node-floating-toolbar nodrag${isCropping ? " ic-node-hover-toolbar--crop" : ""}`}
      style={{ left, top }}
    >
      {isCropping && imageCrop ? (
        <>
          <div className={`ic-crop-aspect-menu${cropAspectMenuOpen ? " open" : ""}`} onPointerEnter={() => onCropAspectMenuOpenChange(true)} onPointerLeave={() => onCropAspectMenuOpenChange(false)}>
            <button type="button" className="ic-crop-aspect-trigger" data-tooltip={t("infiniteCanvas:cropAspect")} aria-label={t("infiniteCanvas:cropAspect")} onClick={() => onCropAspectMenuOpenChange(true)}>
              <Ratio size={14} aria-hidden="true" />
              <span>{imageCrop.aspect === "original" ? t("infiniteCanvas:originalAspect") : imageCrop.aspect === "free" ? t("infiniteCanvas:freeAspect") : imageCrop.aspect}</span>
            </button>
            <div className="ic-crop-aspect-list popover-surface popover-menu" role="menu" aria-label={t("infiniteCanvas:cropAspect")}>
              {CROP_ASPECT_OPTIONS.map((option) => (
                <button key={option.key} type="button" role="menuitemradio" aria-checked={option.key === imageCrop.aspect} onClick={() => onChangeCropAspect(node.id, option.key)}>
                  <Ratio size={13} aria-hidden="true" />
                  <span>{option.key === "original" ? t("infiniteCanvas:originalAspect") : option.key === "free" ? t("infiniteCanvas:freeAspect") : option.label}</span>
                </button>
              ))}
            </div>
          </div>
          <button type="button" className="ic-node-toolbar-icon" data-tooltip={t("infiniteCanvas:applyCrop")} aria-label={t("infiniteCanvas:applyCrop")} onClick={() => onApplyCrop(node.id)}>
            <Check size={15} aria-hidden="true" />
          </button>
          <button type="button" className="ic-node-toolbar-icon ic-node-toolbar-icon--danger" data-tooltip={t("infiniteCanvas:cancelCrop")} aria-label={t("infiniteCanvas:cancelCrop")} onClick={onCancelCrop}>
            <X size={15} aria-hidden="true" />
          </button>
        </>
      ) : (
        <>
          {node.type === "imageLoader" ? (
            <>
              <span className="ic-node-toolbar-group">
                <button type="button" data-tooltip={t("infiniteCanvas:importFromLibrary")} aria-label={t("infiniteCanvas:importFromLibrary")} onClick={() => onImportLibraryImage(node.id)}>
                  <Images size={14} aria-hidden="true" />
                </button>
                <button type="button" data-tooltip={t("common:actions.uploadImage")} aria-label={t("common:actions.uploadImage")} onClick={() => onLoadImage(node.id)}>
                  <Upload size={14} aria-hidden="true" />
                </button>
              </span>
              <span className="ic-node-toolbar-separator" aria-hidden="true" />
            </>
          ) : null}
          {isImageLikeNode(node) && node.url ? (
            <>
              <button type="button" data-tooltip={t("infiniteCanvas:cropImage")} aria-label={t("infiniteCanvas:cropImage")} onClick={() => onOpenCrop(node.id)}>
                <Crop size={14} aria-hidden="true" />
              </button>
              <button type="button" data-tooltip={t("infiniteCanvas:viewLargeImage")} aria-label={t("infiniteCanvas:viewLargeImage")} onClick={() => onPreviewImage(node.id)}>
                <Eye size={14} aria-hidden="true" />
              </button>
              <button type="button" data-tooltip={t("infiniteCanvas:downloadImage")} aria-label={t("infiniteCanvas:downloadImage")} disabled={downloadStatus?.nodeId === node.id && downloadStatus.tone === "busy"} onClick={() => onDownloadImage(node.id)}>
                <Download size={14} aria-hidden="true" />
              </button>
            </>
          ) : null}
          {node.type === "actionFission" ? (
            <ActionFissionToolbarGroup
              node={node}
              imageProviders={imageProviders}
              defaultImageProvider={defaultImageProvider}
              isGenerationTargetActive={isGenerationTargetActive}
              onRunAllRows={onRunAllActionFissionRows}
              onSwitchAllRows={onSwitchAllActionFissionRows}
              onDownloadAllRows={onDownloadAllActionFissionRows}
              onStopAllRows={onStopAllActionFissionRows}
              t={t}
            />
          ) : null}
          <button type="button" className="ic-node-toolbar-icon--danger" data-tooltip={t("infiniteCanvas:deleteNode")} aria-label={t("infiniteCanvas:deleteNode")} onClick={() => onDeleteNode(node.id)}>
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </>
      )}
    </div>
  );
});
