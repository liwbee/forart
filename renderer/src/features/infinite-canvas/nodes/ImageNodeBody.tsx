import { Sparkles, UploadCloud } from "lucide-react";
import { useEffect, useState, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import type { CanvasNode, CropRect } from "../types";

function formatElapsedTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

interface ImageNodeBodyProps {
  node: CanvasNode;
  cropRect: CropRect | null;
  setFileInputRef: (input: HTMLInputElement | null) => void;
  onFiles: (files: FileList | File[]) => void;
  onPreview: () => void;
  onStartCropInteraction: (event: PointerEvent<HTMLDivElement | HTMLButtonElement>, mode: "move" | "resize") => void;
  onCropPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onStopCropInteraction: (event: PointerEvent<HTMLElement>) => void;
}

export function ImageNodeBody({
  node,
  cropRect,
  setFileInputRef,
  onFiles,
  onPreview,
  onStartCropInteraction,
  onCropPointerMove,
  onStopCropInteraction,
}: ImageNodeBodyProps) {
  const { t } = useTranslation();
  const hasImage = Boolean(node.url);
  const isGenerator = node.type === "generator";
  const isGenerating = isGenerator && Boolean(node.running);
  const [loadedSize, setLoadedSize] = useState<{ width: number; height: number } | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const imageWidth = Math.round(node.imageNaturalWidth || loadedSize?.width || 0);
  const imageHeight = Math.round(node.imageNaturalHeight || loadedSize?.height || 0);
  const imageResolution = imageWidth > 0 && imageHeight > 0 ? `${imageWidth} x ${imageHeight}` : "";

  useEffect(() => {
    setLoadedSize(null);
  }, [node.url]);

  useEffect(() => {
    if (!isGenerating) {
      setElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    setElapsedSeconds(0);
    const interval = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
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
        aria-label={hasImage ? t("infiniteCanvas.viewLargeImage") : isGenerator ? t("infiniteCanvas.generatorNode") : t("infiniteCanvas.uploadNodeTitle")}
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
              src={node.url}
              alt={node.fileName || "canvas input"}
              draggable={false}
              onLoad={(event) => {
                const image = event.currentTarget;
                if (!image.naturalWidth || !image.naturalHeight) return;
                setLoadedSize({ width: image.naturalWidth, height: image.naturalHeight });
              }}
            />
            {imageResolution && !isGenerating ? <span className="ic-image-resolution-badge">{imageResolution}</span> : null}
          </>
        ) : (
          <div className="ic-upload-node-card">
            <span className="ic-upload-node-main" aria-hidden="true">
              {isGenerator ? <Sparkles size={24} /> : <UploadCloud size={24} />}
            </span>
            <span className="ic-upload-node-title">{isGenerator ? t("infiniteCanvas.generatorNode") : t("infiniteCanvas.imageNode")}</span>
            <span className="ic-upload-node-sub">{isGenerator ? t("infiniteCanvas.generatorNodeEmptyAction") : t("infiniteCanvas.imageNodeEmptyAction")}</span>
          </div>
        )}
        {isGenerating ? (
          <>
            <span className="ic-generator-timer" aria-label={`Generation elapsed ${formatElapsedTime(elapsedSeconds)}`}>
              {formatElapsedTime(elapsedSeconds)}
            </span>
            <div className="ic-generator-running" role="status" aria-live="polite">
              <span>{node.generationStatus || t("infiniteCanvas.running")}</span>
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
                aria-label={t("infiniteCanvas.resizeCropBox")}
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
