import { ImagePlus, Play, Upload } from "lucide-react";
import type { PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import type { CanvasNode, CropRect } from "../types";

interface ImageNodeBodyProps {
  node: CanvasNode;
  cropRect: CropRect | null;
  isPromptOpen: boolean;
  setFileInputRef: (input: HTMLInputElement | null) => void;
  onFileChange: (file?: File) => void;
  onPatch: (patch: Partial<CanvasNode>) => void;
  onRun: () => void;
  onUpload: () => void;
  onPreview: () => void;
  onTogglePrompt: () => void;
  onStartCropInteraction: (event: PointerEvent<HTMLDivElement | HTMLButtonElement>, mode: "move" | "resize") => void;
  onCropPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onStopCropInteraction: (event: PointerEvent<HTMLElement>) => void;
}

export function ImageNodeBody({
  node,
  cropRect,
  isPromptOpen,
  setFileInputRef,
  onFileChange,
  onPatch,
  onRun,
  onUpload,
  onPreview,
  onTogglePrompt,
  onStartCropInteraction,
  onCropPointerMove,
  onStopCropInteraction,
}: ImageNodeBodyProps) {
  const { t } = useTranslation();
  const isGenerator = node.imageMode !== "asset";

  function runFromPrompt() {
    onRun();
  }

  function activateImageNode() {
    if (isGenerator) {
      onTogglePrompt();
      return;
    }
    if (node.url) onPreview();
  }

  return (
    <div className="ic-node-body nowheel">
      <input
        ref={setFileInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => onFileChange(event.target.files?.[0])}
      />
      <div
        className={`ic-image-drop${isGenerator ? " ic-image-prompt-trigger" : ""}${node.url ? " has-image" : ""}`}
        role="button"
        tabIndex={0}
        aria-label={isGenerator ? t("infiniteCanvas.openImagePrompt") : t("infiniteCanvas.viewLargeImage")}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          activateImageNode();
        }}
        onClick={() => {
          if (isGenerator) onTogglePrompt();
        }}
        onDoubleClick={() => {
          if (!isGenerator && node.url) onPreview();
        }}
      >
        {node.url ? <img src={node.url} alt={node.fileName || "canvas input"} draggable={false} /> : <ImagePlus size={34} aria-hidden="true" />}
        {node.url ? null : <span>{t("infiniteCanvas.imageNodeEmptyAction")}</span>}
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
      {isGenerator && isPromptOpen ? (
        <div className="ic-image-prompt-popover nodrag nopan nowheel" onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
          <textarea
            className="nodrag nopan nowheel"
            value={node.text || ""}
            placeholder={t("infiniteCanvas.imagePromptPlaceholder")}
            aria-label={t("infiniteCanvas.imagePrompt")}
            onChange={(event) => onPatch({ text: event.target.value })}
          />
          <div className="ic-image-prompt-popover__actions">
            <button className="ic-image-prompt-secondary nodrag nopan" type="button" onClick={onUpload}>
              <Upload size={15} aria-hidden="true" />
              {t("common.actions.uploadImage")}
            </button>
            <button className="ic-run-button nodrag nopan" type="button" onClick={runFromPrompt}>
              <Play size={15} aria-hidden="true" />
              {t("infiniteCanvas.runGenerator")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
