import { ChevronDown, Play, Square, X } from "lucide-react";
import type { CSSProperties } from "react";
import type { useTranslation } from "react-i18next";
import { Select } from "../../../components/Select";
import { getModelDisplayName, type ApiProvider } from "../../settings/apiProviders";
import { clamp, WORLD_CENTER } from "../canvasGeometry";
import { IMAGE_ASPECT_RATIO_OPTIONS, IMAGE_RESOLUTION_OPTIONS } from "../constants";
import type { ImageGenerationReadiness } from "../core/imageGenerationReadiness";
import type { CanvasNode, Viewport } from "../types";
import type { ImageGeneratorInputPreview } from "./composerTypes";

interface ImageGeneratorComposerProps {
  node: CanvasNode | null;
  viewport: Viewport;
  selectedProvider: ApiProvider | null;
  selectedModel: string;
  inputPreviews: ImageGeneratorInputPreview[];
  generationReadiness: ImageGenerationReadiness;
  openSelectId: string;
  draggedInputConnectionId: string;
  inputInsertIndex: number | null;
  onOpenSelectChange: (updater: string | ((current: string) => string)) => void;
  onPatchNode: (nodeId: string, patch: Partial<CanvasNode>) => void;
  onRun: (nodeId: string) => void;
  onStop: (nodeId: string) => void;
  onRemoveInput: (connectionId: string) => void;
  onReorderInput: (nodeId: string, connectionId: string, imageInsertIndex: number) => void;
  onDraggedInputConnectionIdChange: (connectionId: string) => void;
  onInputInsertIndexChange: (index: number | null) => void;
  getInputInsertIndex: (container: HTMLDivElement, clientX: number) => number;
  t: ReturnType<typeof useTranslation>["t"];
}

export function ImageGeneratorComposer({
  node,
  viewport,
  selectedProvider,
  selectedModel,
  inputPreviews,
  generationReadiness,
  openSelectId,
  draggedInputConnectionId,
  inputInsertIndex,
  onOpenSelectChange,
  onPatchNode,
  onRun,
  onStop,
  onRemoveInput,
  onReorderInput,
  onDraggedInputConnectionIdChange,
  onInputInsertIndexChange,
  getInputInsertIndex,
  t,
}: ImageGeneratorComposerProps) {
  if (!node || node.type !== "imageGenerator") return null;

  const selectedResolution = IMAGE_RESOLUTION_OPTIONS.includes(node.imageResolution || "1k") ? node.imageResolution || "1k" : "1k";
  const selectedAspectRatio = IMAGE_ASPECT_RATIO_OPTIONS.includes(node.imageAspectRatio || "1:1") ? node.imageAspectRatio || "1:1" : "1:1";
  const promptInputCount = inputPreviews.filter((item) => item.kind === "prompt").length;
  const width = clamp(Math.round(node.w + 260), 520, 720);
  const composerGap = 14 / viewport.scale;
  const composerLeft = WORLD_CENTER + node.x + node.w / 2 - width / 2 / viewport.scale;
  const selectId = (name: string) => `${node.id}:${name}`;
  const sizePanelId = selectId("size");
  const isSizePanelOpen = openSelectId === sizePanelId;
  const patchNode = (patch: Partial<CanvasNode>) => onPatchNode(node.id, patch);
  const canRun = Boolean(selectedProvider && selectedModel && generationReadiness.canRun);
  const generationReadinessMessage = generationReadiness.message || (
    generationReadiness.reason === "missing_prompt"
      ? t("infiniteCanvas.imageGenerationMissingPrompt")
      : generationReadiness.reason === "missing_reference_image"
        ? t("infiniteCanvas.imageGenerationMissingReferenceImage")
        : generationReadiness.reason === "reference_not_supported"
          ? t("infiniteCanvas.imageGenerationReferenceNotSupported")
          : generationReadiness.reason === "too_many_reference_images"
            ? t("infiniteCanvas.imageGenerationTooManyReferenceImages", { count: generationReadiness.maxReferenceImages || 0 })
            : ""
  );

  const renderComposerSelect = (
    name: string,
    label: string,
    value: string,
    options: Array<{ value: string; label: string; hint?: string }>,
    onChange: (value: string) => void,
    disabled = false,
  ) => {
    const id = selectId(name);
    return (
      <Select
        value={value}
        options={options}
        ariaLabel={label}
        disabled={disabled}
        open={openSelectId === id && !disabled}
        onOpenChange={(nextOpen) => onOpenSelectChange((current) => (nextOpen ? id : current === id ? "" : current))}
        onChange={onChange}
      />
    );
  };

  const renderSizePanel = () => (
    <div className={`ic-composer-size${isSizePanelOpen ? " open" : ""}`}>
      <button
        type="button"
        className="ic-composer-select__trigger ic-composer-size__trigger"
        aria-label={`${t("infiniteCanvas.resolution")} / ${t("infiniteCanvas.ratio")}`}
        aria-haspopup="dialog"
        aria-expanded={isSizePanelOpen}
        onClick={() => onOpenSelectChange((current) => (current === sizePanelId ? "" : sizePanelId))}
        onKeyDown={(event) => {
          if (event.key === "Escape") onOpenSelectChange("");
        }}
      >
        <span>{`${selectedResolution.toUpperCase()} / ${selectedAspectRatio}`}</span>
        <ChevronDown size={18} aria-hidden="true" />
      </button>
      {isSizePanelOpen ? (
        <div className="ic-composer-size__panel" role="dialog" aria-label={`${t("infiniteCanvas.resolution")} / ${t("infiniteCanvas.ratio")}`}>
          <div className="ic-composer-size__section">
            <span>{t("infiniteCanvas.resolution")}</span>
            <div className="ic-composer-size__resolution" role="radiogroup" aria-label={t("infiniteCanvas.resolution")}>
              {[
                { value: "1k", label: t("infiniteCanvas.resolution1k") },
                { value: "2k", label: t("infiniteCanvas.resolution2k") },
                { value: "4k", label: t("infiniteCanvas.resolution4k") },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={option.value === selectedResolution ? "selected" : ""}
                  role="radio"
                  aria-checked={option.value === selectedResolution}
                  onClick={() => patchNode({ imageResolution: option.value as CanvasNode["imageResolution"] })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="ic-composer-size__section">
            <span>{t("infiniteCanvas.ratio")}</span>
            <div className="ic-composer-size__ratios" role="radiogroup" aria-label={t("infiniteCanvas.ratio")}>
              {IMAGE_ASPECT_RATIO_OPTIONS.map((ratio) => {
                const [rawW, rawH] = ratio.split(":").map(Number);
                const w = rawW || 1;
                const h = rawH || 1;
                const isWide = w >= h;
                return (
                  <button
                    key={ratio}
                    type="button"
                    className={ratio === selectedAspectRatio ? "selected" : ""}
                    role="radio"
                    aria-checked={ratio === selectedAspectRatio}
                    onClick={() => patchNode({ imageAspectRatio: ratio as CanvasNode["imageAspectRatio"] })}
                  >
                    <i
                      aria-hidden="true"
                      style={{
                        width: isWide ? 18 : Math.max(8, Math.round(18 * w / h)),
                        height: isWide ? Math.max(8, Math.round(18 * h / w)) : 18,
                      }}
                    />
                    <span>{ratio === "1:1" ? t("infiniteCanvas.ratioSquare") : ratio}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );

  return (
    <div
      className="ic-image-composer nodrag nopan nowheel"
      style={{ left: composerLeft, top: WORLD_CENTER + node.y + node.h + composerGap, width }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        if (!(event.target as HTMLElement).closest(".ic-composer-select, .ic-composer-size")) onOpenSelectChange("");
      }}
    >
      {inputPreviews.length ? (
        <div
          className={`ic-image-composer__inputs${draggedInputConnectionId ? " sorting" : ""}${inputInsertIndex !== null ? " has-insert" : ""}`}
          aria-label={t("infiniteCanvas.imageComposerParams")}
          style={inputInsertIndex !== null ? {
            "--ic-input-insert-index": inputInsertIndex,
            "--ic-prompt-input-count": promptInputCount,
          } as CSSProperties : undefined}
          onDragOver={(event) => {
            if (!draggedInputConnectionId) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "move";
            onInputInsertIndexChange(getInputInsertIndex(event.currentTarget, event.clientX));
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
            onInputInsertIndexChange(null);
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const connectionId = event.dataTransfer.getData("text/plain");
            onReorderInput(node.id, connectionId, inputInsertIndex ?? getInputInsertIndex(event.currentTarget, event.clientX));
            onDraggedInputConnectionIdChange("");
            onInputInsertIndexChange(null);
          }}
        >
          {inputPreviews.map((item) => (
            <div
              key={item.connectionId}
              className={`ic-image-composer__input ic-image-composer__input--${item.kind}${draggedInputConnectionId === item.connectionId ? " dragging" : ""}`}
              title={item.title}
              draggable={item.kind === "image"}
              onDragStart={(event) => {
                if (item.kind !== "image") return;
                event.stopPropagation();
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", item.connectionId);
                onDraggedInputConnectionIdChange(item.connectionId);
                onInputInsertIndexChange(item.order - 1);
              }}
              onDragEnd={() => {
                onDraggedInputConnectionIdChange("");
                onInputInsertIndexChange(null);
              }}
            >
              {item.kind === "image" ? (
                <>
                  <img src={item.url} alt={item.title} draggable={false} />
                  <span className="ic-image-composer__input-order">{item.order}</span>
                </>
              ) : (
                <>
                  <span>{item.title}</span>
                  <p>{item.text}</p>
                </>
              )}
              <button
                type="button"
                className="ic-image-composer__input-remove"
                aria-label={t("infiniteCanvas.deleteConnection")}
                title={t("infiniteCanvas.deleteConnection")}
                draggable={false}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onRemoveInput(item.connectionId);
                }}
              >
                <X size={11} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <textarea
        className="ic-image-composer__prompt"
        value={node.text || ""}
        placeholder={t("infiniteCanvas.imageComposerPlaceholder")}
        onChange={(event) => patchNode({ text: event.target.value })}
      />
      <div className="ic-image-composer__bottom">
        <div className="ic-image-composer__params" aria-label={t("infiniteCanvas.imageComposerParams")}>
          {renderComposerSelect(
            "model",
            t("infiniteCanvas.model"),
            selectedModel,
            selectedProvider?.imageModels.length
              ? selectedProvider.imageModels.map((model) => ({ value: model, label: getModelDisplayName(selectedProvider, "image", model) }))
              : [{ value: "", label: t("settings.noImageModels") }],
            (value) => patchNode({ imageModel: value, imageProviderId: selectedProvider?.id || "", generationError: "" }),
            !selectedProvider,
          )}
          {renderSizePanel()}
          {renderComposerSelect(
            "auto",
            t("infiniteCanvas.auto"),
            "auto",
            [{ value: "auto", label: t("infiniteCanvas.auto") }],
            () => undefined,
          )}
        </div>
        <button
          type="button"
          className={`ic-image-composer__run${node.running ? " is-stop" : ""}`}
          aria-label={node.running ? t("infiniteCanvas.stopRun") : t("infiniteCanvas.run")}
          title={node.running ? t("infiniteCanvas.stopRun") : t("infiniteCanvas.run")}
          disabled={!node.running && !canRun}
          onClick={() => (node.running ? onStop(node.id) : onRun(node.id))}
        >
          {node.running ? <Square size={15} aria-hidden="true" fill="currentColor" /> : <Play size={18} aria-hidden="true" fill="currentColor" />}
        </button>
      </div>
      {!node.running && generationReadinessMessage ? <div className="ic-image-composer__hint">{generationReadinessMessage}</div> : null}
      {node.generationError ? <div className="ic-image-composer__error">{node.generationError}</div> : null}
    </div>
  );
}
