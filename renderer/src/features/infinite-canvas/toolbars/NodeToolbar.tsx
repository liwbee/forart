import { Check, Crop, Download, Eye, Ratio, Trash2, Upload, X } from "lucide-react";
import { memo } from "react";
import type { useTranslation } from "react-i18next";
import { CROP_ASPECT_OPTIONS } from "../constants";
import { isImageLikeNode } from "../nodePredicates";
import type { CanvasNode, CropAspectKey, CropRect, Viewport } from "../types";

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
  onUploadImage: (nodeId: string) => void;
  onOpenCrop: (nodeId: string) => void;
  onChangeCropAspect: (nodeId: string, aspect: CropAspectKey) => void;
  onApplyCrop: (nodeId: string) => void;
  onCancelCrop: () => void;
  onPreviewImage: (nodeId: string) => void;
  onDownloadImage: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  t: ReturnType<typeof useTranslation>["t"];
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
  onUploadImage,
  onOpenCrop,
  onChangeCropAspect,
  onApplyCrop,
  onCancelCrop,
  onPreviewImage,
  onDownloadImage,
  onDeleteNode,
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
            <button type="button" className="ic-crop-aspect-trigger" aria-label={t("infiniteCanvas.cropAspect")} title={t("infiniteCanvas.cropAspect")} onClick={() => onCropAspectMenuOpenChange(true)}>
              <Ratio size={14} aria-hidden="true" />
              <span>{imageCrop.aspect === "original" ? t("infiniteCanvas.originalAspect") : imageCrop.aspect === "free" ? t("infiniteCanvas.freeAspect") : imageCrop.aspect}</span>
            </button>
            <div className="ic-crop-aspect-list" role="menu" aria-label={t("infiniteCanvas.cropAspect")}>
              {CROP_ASPECT_OPTIONS.map((option) => (
                <button key={option.key} type="button" role="menuitemradio" aria-checked={option.key === imageCrop.aspect} onClick={() => onChangeCropAspect(node.id, option.key)}>
                  <Ratio size={13} aria-hidden="true" />
                  <span>{option.key === "original" ? t("infiniteCanvas.originalAspect") : option.key === "free" ? t("infiniteCanvas.freeAspect") : option.label}</span>
                </button>
              ))}
            </div>
          </div>
          <button type="button" className="ic-node-toolbar-icon" aria-label={t("infiniteCanvas.applyCrop")} title={t("infiniteCanvas.applyCrop")} onClick={() => onApplyCrop(node.id)}>
            <Check size={15} aria-hidden="true" />
          </button>
          <button type="button" className="ic-node-toolbar-icon ic-node-toolbar-icon--danger" aria-label={t("infiniteCanvas.cancelCrop")} title={t("infiniteCanvas.cancelCrop")} onClick={onCancelCrop}>
            <X size={15} aria-hidden="true" />
          </button>
        </>
      ) : (
        <>
          {node.type === "image" || node.type === "libtvUpload" ? (
            <button type="button" aria-label={t("common.actions.uploadImage")} title={t("common.actions.uploadImage")} onClick={() => onUploadImage(node.id)}>
              <Upload size={14} aria-hidden="true" />
            </button>
          ) : null}
          {isImageLikeNode(node) && node.url ? (
            <>
              <button type="button" aria-label={t("infiniteCanvas.cropImage")} title={t("infiniteCanvas.cropImage")} onClick={() => onOpenCrop(node.id)}>
                <Crop size={14} aria-hidden="true" />
              </button>
              <button type="button" aria-label={t("infiniteCanvas.viewLargeImage")} title={t("infiniteCanvas.viewLargeImage")} onClick={() => onPreviewImage(node.id)}>
                <Eye size={14} aria-hidden="true" />
              </button>
              {node.type === "imageGenerator" || node.type === "libtvImage" ? (
                <button type="button" aria-label={t("infiniteCanvas.downloadImage")} title={t("infiniteCanvas.downloadImage")} disabled={downloadStatus?.nodeId === node.id && downloadStatus.tone === "busy"} onClick={() => onDownloadImage(node.id)}>
                  <Download size={14} aria-hidden="true" />
                </button>
              ) : null}
            </>
          ) : null}
          <button type="button" className="ic-node-toolbar-icon--danger" aria-label={t("infiniteCanvas.deleteNode")} title={t("infiniteCanvas.deleteNode")} onClick={() => onDeleteNode(node.id)}>
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </>
      )}
    </div>
  );
});
