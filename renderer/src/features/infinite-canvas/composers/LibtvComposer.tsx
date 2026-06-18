import { ChevronDown, Download, Play, RefreshCw, Square, X } from "lucide-react";
import type { CSSProperties } from "react";
import type { useTranslation } from "react-i18next";
import { Select } from "../../../components/Select";
import { clamp, WORLD_CENTER } from "../canvasGeometry";
import { IMAGE_ASPECT_RATIO_OPTIONS, IMAGE_RESOLUTION_OPTIONS } from "../constants";
import type { CanvasNode, Viewport } from "../types";
import type { ImageGeneratorInputPreview } from "./composerTypes";

interface LibtvModelOption {
  key: string;
  name: string;
  label: string;
}

interface QueueNodePatchOptions {
  debounceMs?: number | null;
  flush?: boolean;
}

interface LibtvComposerProps {
  node: CanvasNode | null;
  viewport: Viewport;
  models: LibtvModelOption[];
  modelsLoading: boolean;
  inputPreviews: ImageGeneratorInputPreview[];
  openSelectId: string;
  draggedInputConnectionId: string;
  inputInsertIndex: number | null;
  onOpenSelectChange: (updater: string | ((current: string) => string)) => void;
  onPatchNode: (nodeId: string, patch: Partial<CanvasNode>) => void;
  onQueueNodePatch: (nodeId: string, patch: Partial<CanvasNode>, options?: QueueNodePatchOptions) => void;
  onRefreshModels: () => void | Promise<void>;
  onSyncNode: (nodeId: string) => void | Promise<void>;
  onRun: (nodeId: string) => void | Promise<void>;
  onStop: (nodeId: string) => void;
  onRemoveInput: (connectionId: string) => void;
  t: ReturnType<typeof useTranslation>["t"];
}

export function LibtvComposer({
  node,
  viewport,
  models,
  modelsLoading,
  inputPreviews,
  openSelectId,
  draggedInputConnectionId,
  inputInsertIndex,
  onOpenSelectChange,
  onPatchNode,
  onQueueNodePatch,
  onRefreshModels,
  onSyncNode,
  onRun,
  onStop,
  onRemoveInput,
  t,
}: LibtvComposerProps) {
  if (!node || node.type !== "libtvImage") return null;

  const promptInputCount = inputPreviews.filter((item) => item.kind === "prompt").length;
  const width = clamp(Math.round(node.w + 280), 560, 760);
  const composerGap = 14 / viewport.scale;
  const composerLeft = WORLD_CENTER + node.x + node.w / 2 - width / 2 / viewport.scale;
  const selectedResolution = IMAGE_RESOLUTION_OPTIONS.includes(node.libtvResolution || "1k") ? node.libtvResolution || "1k" : "1k";
  const selectedAspectRatio = IMAGE_ASPECT_RATIO_OPTIONS.includes(node.libtvAspectRatio || "1:1") ? node.libtvAspectRatio || "1:1" : "1:1";
  const matchedModel = models.find((model) => model.key === node.libtvModel || model.name === node.libtvModel || model.key === node.libtvModelName || model.name === node.libtvModelName);
  const currentModel = matchedModel?.key || node.libtvModel || node.libtvModelName || "";
  const currentModelLabel = matchedModel?.name || node.libtvModelName || node.libtvModel || "";
  const modelOptions = [
    ...models.map((model) => ({ value: model.key || model.name, label: model.label || model.name || model.key, hint: model.key })),
    ...(currentModel && !models.some((model) => model.name === currentModel || model.key === currentModel) ? [{ value: currentModel, label: currentModel }] : []),
    ...(currentModelLabel && currentModelLabel !== currentModel && !models.some((model) => model.name === currentModelLabel || model.key === currentModelLabel) ? [{ value: currentModelLabel, label: currentModelLabel }] : []),
  ];
  const selectId = (name: string) => `${node.id}:libtv-${name}`;

  const renderLibtvSelect = (
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

  const renderLibtvSizePanel = () => {
    const id = selectId("size");
    const isOpen = openSelectId === id;
    return (
      <div className={`ic-composer-size${isOpen ? " open" : ""}`}>
        <button
          type="button"
          className="ic-composer-select__trigger ic-composer-size__trigger"
          aria-label={`${t("infiniteCanvas.resolution")} / ${t("infiniteCanvas.ratio")}`}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          onClick={() => onOpenSelectChange((current) => (current === id ? "" : id))}
        >
          <span>{`${selectedResolution.toUpperCase()} / ${selectedAspectRatio}`}</span>
          <ChevronDown size={18} aria-hidden="true" />
        </button>
        {isOpen ? (
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
                    onClick={() => {
                      const patch = { libtvResolution: option.value as CanvasNode["libtvResolution"], generationError: "" };
                      onPatchNode(node.id, patch);
                      onQueueNodePatch(node.id, patch, { flush: true });
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="ic-composer-size__section">
              <span>{t("infiniteCanvas.ratio")}</span>
              <div className="ic-composer-size__ratios" role="radiogroup" aria-label={t("infiniteCanvas.ratio")}>
                {IMAGE_ASPECT_RATIO_OPTIONS.map((ratio) => (
                  <button
                    key={ratio}
                    type="button"
                    className={ratio === selectedAspectRatio ? "selected" : ""}
                    role="radio"
                    aria-checked={ratio === selectedAspectRatio}
                    onClick={() => {
                      const patch = { libtvAspectRatio: ratio as CanvasNode["libtvAspectRatio"], generationError: "" };
                      onPatchNode(node.id, patch);
                      onQueueNodePatch(node.id, patch, { flush: true });
                    }}
                  >
                    <span>{ratio === "1:1" ? t("infiniteCanvas.ratioSquare") : ratio}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div
      className="ic-image-composer ic-libtv-composer nodrag nopan nowheel"
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
        >
          {inputPreviews.map((item) => (
            <div key={item.connectionId} className={`ic-image-composer__input ic-image-composer__input--${item.kind}`} title={item.title}>
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
        placeholder={t("infiniteCanvas.libtvPromptPlaceholder")}
        onChange={(event) => {
          onQueueNodePatch(node.id, { text: event.target.value }, { debounceMs: null });
          onPatchNode(node.id, { text: event.target.value, generationError: "" });
        }}
        onBlur={(event) => {
          onQueueNodePatch(node.id, { text: event.target.value }, { flush: true });
        }}
      />
      <div className="ic-image-composer__bottom">
        <div className="ic-image-composer__params ic-libtv-composer__params" aria-label={t("infiniteCanvas.imageComposerParams")}>
          {renderLibtvSelect(
            "model",
            t("infiniteCanvas.model"),
            currentModel,
            modelOptions.length ? modelOptions : [{ value: "", label: modelsLoading ? t("infiniteCanvas.libtvLoadingModels") : t("infiniteCanvas.libtvNoModels") }],
            (value) => {
              const selectedModel = models.find((model) => model.key === value || model.name === value);
              onPatchNode(node.id, {
                libtvModel: selectedModel?.key || value,
                libtvModelName: selectedModel?.name || value,
                generationError: "",
              });
              onQueueNodePatch(node.id, {
                libtvModel: selectedModel?.key || value,
                libtvModelName: selectedModel?.name || value,
              }, { flush: true });
            },
            modelsLoading,
          )}
          {renderLibtvSizePanel()}
        </div>
        <button
          type="button"
          className="ic-image-composer__run ic-libtv-composer__status"
          aria-label={t("infiniteCanvas.libtvRefreshModels")}
          title={t("infiniteCanvas.libtvRefreshModels")}
          disabled={modelsLoading}
          onClick={() => void onRefreshModels()}
        >
          <RefreshCw size={17} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="ic-image-composer__run ic-libtv-composer__status"
          aria-label={t("infiniteCanvas.libtvSyncNode")}
          title={t("infiniteCanvas.libtvSyncNode")}
          disabled={!node.libtvProjectId || !node.libtvNodeId}
          onClick={() => void onSyncNode(node.id)}
        >
          <Download size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`ic-image-composer__run${node.running ? " is-stop" : ""}`}
          aria-label={node.running ? t("infiniteCanvas.stopRun") : t("infiniteCanvas.run")}
          title={node.running ? t("infiniteCanvas.stopRun") : t("infiniteCanvas.run")}
          disabled={!node.running && (!node.libtvProjectId || !node.libtvNodeId)}
          onClick={() => (node.running ? onStop(node.id) : void onRun(node.id))}
        >
          {node.running ? <Square size={15} aria-hidden="true" fill="currentColor" /> : <Play size={18} aria-hidden="true" fill="currentColor" />}
        </button>
      </div>
      {node.generationStatus ? <div className="ic-image-composer__status">{node.generationStatus}</div> : null}
      {node.generationError ? <div className="ic-image-composer__error">{node.generationError}</div> : null}
    </div>
  );
}
