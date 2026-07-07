import { Download, Image as ImageIcon, Images, Upload } from "lucide-react";
import { useEffect, useState, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { formatGenerationDuration, getGenerationElapsedMs } from "../generation/generationTaskTime";
import { isGenerationTaskActive } from "../generation/generationTaskRuntime";
import type { CanvasGenerationTask, CanvasNode, CropRect } from "../types";

interface ImageNodeBodyProps {
  node: CanvasNode;
  cropRect: CropRect | null;
  setFileInputRef: (input: HTMLInputElement | null) => void;
  onFiles: (files: FileList | File[]) => void;
  onLoadClick: () => void;
  onLibraryClick: () => void;
  onPreview: () => void;
  onDownload: () => void;
  isDownloadBusy: boolean;
  generationTask: CanvasGenerationTask | null;
  onStartCropInteraction: (event: PointerEvent<HTMLDivElement | HTMLButtonElement>, mode: "move" | "resize") => void;
  onCropPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onStopCropInteraction: (event: PointerEvent<HTMLElement>) => void;
}

export function ImageNodeBody({
  node,
  cropRect,
  setFileInputRef,
  onFiles,
  onLoadClick,
  onLibraryClick,
  onPreview,
  onDownload,
  isDownloadBusy,
  generationTask,
  onStartCropInteraction,
  onCropPointerMove,
  onStopCropInteraction,
}: ImageNodeBodyProps) {
  const { t } = useTranslation();
  const hasImage = Boolean(node.url);
  const isImageGenerator = node.type === "imageGenerator";
  const isLibtvImageGenerator = node.type === "libtvImageGenerator";
  const isGeneratorLike = isImageGenerator || isLibtvImageGenerator;
  const activeTask = generationTask || undefined;
  const isLibtvGenerating = Boolean(node.libtvImageGeneration?.running);
  const isGenerating = Boolean(isGenerationTaskActive(activeTask) || isLibtvGenerating);
  const showGeneratorDownload = hasImage && isGeneratorLike && !isGenerating;
  const isPendingDownload = showGeneratorDownload && node.outputDownloadState === "pending";
  const [loadedSize, setLoadedSize] = useState<{ width: number; height: number } | null>(null);
  const [timerNow, setTimerNow] = useState(Date.now());
  const imageWidth = Math.round(node.imageNaturalWidth || loadedSize?.width || 0);
  const imageHeight = Math.round(node.imageNaturalHeight || loadedSize?.height || 0);
  const imageResolution = imageWidth > 0 && imageHeight > 0 ? `${imageWidth} x ${imageHeight}` : "";
  const libtvStartedAt = Number(node.libtvImageGeneration?.startedAt || 0);
  const elapsedText = formatGenerationDuration(
    isLibtvGenerating && !activeTask
      ? (libtvStartedAt ? Math.max(0, timerNow - libtvStartedAt) : 0)
      : getGenerationElapsedMs(activeTask, timerNow),
  );
  const generationStatusText = node.libtvImageGeneration?.status || activeTask?.message || t("infiniteCanvas:running");
  const displayUrl = node.thumbUrl || node.url || "";

  useEffect(() => {
    setLoadedSize(null);
  }, [node.url]);

  useEffect(() => {
    if (!isGenerating) {
      return;
    }
    setTimerNow(Date.now());
    const interval = window.setInterval(() => {
      setTimerNow(Date.now());
    }, 1000);
    return () => window.clearInterval(interval);
  }, [isGenerating]);

  return (
    <div className="ic-node-body nowheel">
      <input
        ref={setFileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files?.length) onFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <div
        className={`ic-image-drop${hasImage ? " has-image" : ""}${isGenerating ? " is-generating" : ""}`}
        role={hasImage ? "button" : undefined}
        tabIndex={hasImage ? 0 : undefined}
        aria-label={hasImage ? t("infiniteCanvas:viewLargeImage") : isGeneratorLike ? t("infiniteCanvas:imageGeneratorNode") : t("infiniteCanvas:loadNodeTitle")}
        onClick={(event) => {
          if (hasImage) return;
          event.preventDefault();
          event.stopPropagation();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          if (hasImage) onPreview();
        }}
        onDoubleClick={() => {
          if (hasImage) onPreview();
        }}
      >
        {node.url ? (
          <>
            <img
              src={displayUrl}
              alt={node.fileName || "canvas input"}
              draggable={false}
              onLoad={(event) => {
                const image = event.currentTarget;
                if (!image.naturalWidth || !image.naturalHeight) return;
                setLoadedSize({ width: image.naturalWidth, height: image.naturalHeight });
              }}
            />
            {!isGeneratorLike ? (
              <div className="ic-image-source-actions nodrag nopan">
                <button
                  className="ic-image-library-button"
                  type="button"
                  aria-label={t("infiniteCanvas:importFromLibrary")}
                  title={t("infiniteCanvas:importFromLibrary")}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onLibraryClick();
                  }}
                >
                  <Images size={14} aria-hidden="true" />
                </button>
                <button
                  className="ic-image-replace-button"
                  type="button"
                  aria-label={t("infiniteCanvas:loadImage")}
                  title={t("infiniteCanvas:loadImage")}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onLoadClick();
                  }}
                >
                  <Upload size={14} aria-hidden="true" />
                </button>
              </div>
            ) : null}
            {showGeneratorDownload ? (
              <button
                className={`ic-image-download-button nodrag nopan${isPendingDownload ? " is-pending-download" : ""}`}
                type="button"
                aria-label={t("infiniteCanvas:downloadImage")}
                title={t("infiniteCanvas:downloadImage")}
                disabled={isDownloadBusy}
                onPointerDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onDownload();
                }}
              >
                <Download size={14} aria-hidden="true" />
              </button>
            ) : null}
            {imageResolution && !isGenerating ? <span className="ic-image-resolution-badge">{imageResolution}</span> : null}
          </>
        ) : (
          <div className={`ic-load-node-card${isGeneratorLike ? " is-generator" : " is-loader"}`}>
            {isGeneratorLike ? (
              <ImageIcon size={32} strokeWidth={1.8} aria-hidden="true" />
            ) : null}
            {!isGeneratorLike ? (
              <span className="ic-load-node-actions nodrag nopan">
                <button
                  className="ic-load-node-button"
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onLoadClick();
                }}
              >
                  <Upload size={14} aria-hidden="true" />
                  <span>{t("common:actions.uploadImage")}</span>
                </button>
                <button
                  className="ic-load-node-button"
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  onLibraryClick();
                }}
              >
                <Images size={14} aria-hidden="true" />
                  <span>{t("infiniteCanvas:importFromLibrary")}</span>
                </button>
              </span>
            ) : null}
          </div>
        )}
        {isGenerating ? (
          <>
            <span className="ic-generator-timer" aria-label={`Generation elapsed ${elapsedText}`}>
              {elapsedText}
            </span>
            <div className="ic-generator-running" role="status" aria-live="polite">
              <span>{generationStatusText}</span>
            </div>
          </>
        ) : null}
        {node.url && cropRect ? (
          <div
            className="ic-inline-crop nodrag nopan"
            onPointerDown={(event) => event.stopPropagation()}
            onPointerMove={onCropPointerMove}
            onPointerUp={onStopCropInteraction}
            onPointerCancel={onStopCropInteraction}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div
              className="ic-inline-crop__box"
              style={{ left: cropRect.x, top: cropRect.y, width: cropRect.w, height: cropRect.h }}
              onPointerDown={(event) => onStartCropInteraction(event, "move")}
              onPointerMove={onCropPointerMove}
              onPointerUp={onStopCropInteraction}
              onPointerCancel={onStopCropInteraction}
            >
              <button
                className="ic-inline-crop__handle nodrag nopan"
                type="button"
                aria-label={t("infiniteCanvas:resizeCropBox")}
                onPointerDown={(event) => onStartCropInteraction(event, "resize")}
                onPointerMove={onCropPointerMove}
                onPointerUp={onStopCropInteraction}
                onPointerCancel={onStopCropInteraction}
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
