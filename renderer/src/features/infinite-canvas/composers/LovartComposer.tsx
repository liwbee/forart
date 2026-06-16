import { Play, RefreshCw, Square, X } from "lucide-react";
import type { CSSProperties } from "react";
import type { useTranslation } from "react-i18next";
import { Select } from "../../../components/Select";
import { clamp, WORLD_CENTER } from "../canvasGeometry";
import type { CanvasNode, Viewport } from "../types";
import type { ImageGeneratorInputPreview } from "./composerTypes";

interface LovartComposerProps {
  node: CanvasNode | null;
  viewport: Viewport;
  configured: boolean;
  modelOptions: Array<{ value: string; label: string; hint?: string }>;
  selectedModel: string;
  mode: "fast" | "unlimited";
  inputPreviews: ImageGeneratorInputPreview[];
  openSelectId: string;
  draggedInputConnectionId: string;
  inputInsertIndex: number | null;
  onOpenSelectChange: (updater: string | ((current: string) => string)) => void;
  onPatchNode: (nodeId: string, patch: Partial<CanvasNode>) => void;
  onCheckStatus: (nodeId: string) => void | Promise<void>;
  onRun: (nodeId: string) => void | Promise<void>;
  onStop: (nodeId: string) => void;
  onRemoveInput: (connectionId: string) => void;
  onReorderInput: (nodeId: string, connectionId: string, imageInsertIndex: number) => void;
  onDraggedInputConnectionIdChange: (connectionId: string) => void;
  onInputInsertIndexChange: (index: number | null) => void;
  getInputInsertIndex: (container: HTMLDivElement, clientX: number) => number;
  t: ReturnType<typeof useTranslation>["t"];
}

export function LovartComposer({
  node,
  viewport,
  configured,
  modelOptions,
  selectedModel,
  mode,
  inputPreviews,
  openSelectId,
  draggedInputConnectionId,
  inputInsertIndex,
  onOpenSelectChange,
  onPatchNode,
  onCheckStatus,
  onRun,
  onStop,
  onRemoveInput,
  onReorderInput,
  onDraggedInputConnectionIdChange,
  onInputInsertIndexChange,
  getInputInsertIndex,
  t,
}: LovartComposerProps) {
  if (!node || node.type !== "lovart") return null;

  const promptInputCount = inputPreviews.filter((item) => item.kind === "prompt").length;
  const width = clamp(Math.round(node.w + 260), 520, 720);
  const composerGap = 14 / viewport.scale;
  const composerLeft = WORLD_CENTER + node.x + node.w / 2 - width / 2 / viewport.scale;
  const patchNode = (patch: Partial<CanvasNode>) => onPatchNode(node.id, patch);
  const selectId = (name: string) => `${node.id}:lovart-${name}`;

  const renderLovartSelect = (
    name: string,
    label: string,
    value: string,
    options: Array<{ value: string; label: string; hint?: string }>,
    onChange: (value: string) => void,
  ) => {
    const id = selectId(name);
    return (
      <Select
        value={value}
        options={options}
        ariaLabel={label}
        open={openSelectId === id}
        onOpenChange={(nextOpen) => onOpenSelectChange((current) => (nextOpen ? id : current === id ? "" : current))}
        onChange={onChange}
      />
    );
  };

  return (
    <div
      className="ic-image-composer ic-lovart-composer nodrag nopan nowheel"
      style={{ left: composerLeft, top: WORLD_CENTER + node.y + node.h + composerGap, width }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        if (!(event.target as HTMLElement).closest(".ic-composer-select")) onOpenSelectChange("");
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
        placeholder={t("infiniteCanvas.lovartPromptPlaceholder")}
        onChange={(event) => patchNode({ text: event.target.value, generationError: "" })}
      />
      <div className="ic-image-composer__bottom">
        <div className="ic-image-composer__params ic-lovart-composer__params" aria-label={t("infiniteCanvas.imageComposerParams")}>
          {renderLovartSelect(
            "model",
            t("infiniteCanvas.model"),
            selectedModel,
            modelOptions,
            (value) => patchNode({ lovartModel: value, generationError: "" }),
          )}
          {renderLovartSelect(
            "mode",
            t("infiniteCanvas.lovartMode"),
            mode,
            [
              { value: "fast", label: t("infiniteCanvas.lovartFast") },
              { value: "unlimited", label: t("infiniteCanvas.lovartUnlimited") },
            ],
            (value) => patchNode({ lovartMode: value === "unlimited" ? "unlimited" : "fast", generationError: "" }),
          )}
        </div>
        <button
          type="button"
          className="ic-image-composer__run ic-lovart-composer__status"
          aria-label={t("infiniteCanvas.lovartCheckStatus")}
          title={t("infiniteCanvas.lovartCheckStatus")}
          disabled={!configured || !node.lovartThreadId}
          onClick={() => void onCheckStatus(node.id)}
        >
          <RefreshCw size={17} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`ic-image-composer__run${node.running ? " is-stop" : ""}`}
          aria-label={node.running ? t("infiniteCanvas.stopRun") : t("infiniteCanvas.run")}
          title={node.running ? t("infiniteCanvas.stopRun") : t("infiniteCanvas.run")}
          disabled={!node.running && !configured}
          onClick={() => (node.running ? onStop(node.id) : void onRun(node.id))}
        >
          {node.running ? <Square size={15} aria-hidden="true" fill="currentColor" /> : <Play size={18} aria-hidden="true" fill="currentColor" />}
        </button>
      </div>
      {node.generationError ? <div className="ic-image-composer__error">{node.generationError}</div> : null}
    </div>
  );
}
