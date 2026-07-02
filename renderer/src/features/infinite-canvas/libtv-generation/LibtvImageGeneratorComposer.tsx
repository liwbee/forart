import { Play, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { useTranslation } from "react-i18next";
import { Select } from "../../../components/Select";
import { SizePresetPicker } from "../../../components/SizePresetPicker";
import { clamp, WORLD_CENTER } from "../canvasGeometry";
import { ReferenceImageStrip, ReferenceImageUploadButton } from "../components/ReferenceImageStrip";
import type { ImageGeneratorInputPreview } from "../composers/composerTypes";
import type { CanvasNode, Viewport } from "../types";
import { listLibtvImageModels, listLibtvWorkspaces } from "./libtvGenerationApi";
import { LIBTV_ASPECT_RATIO_OPTIONS, LIBTV_QUALITY_OPTIONS, type LibtvImageModelRecord, type LibtvWorkspaceRecord } from "./libtvGenerationTypes";

interface LibtvImageGeneratorComposerProps {
  node: CanvasNode | null;
  viewport: Viewport;
  inputPreviews: ImageGeneratorInputPreview[];
  openSelectId: string;
  draggedInputConnectionId: string;
  onOpenSelectChange: (updater: string | ((current: string) => string)) => void;
  onPatchNode: (nodeId: string, patch: Partial<CanvasNode>) => void;
  onRun: (nodeId: string) => void;
  onStop: (nodeId: string) => void;
  onRemoveInput: (connectionId: string) => void;
  onReorderInput: (nodeId: string, connectionId: string, imageInsertIndex: number) => void;
  onCreateImageReference: (nodeId: string, files: FileList | File[]) => void;
  onDraggedInputConnectionIdChange: (connectionId: string) => void;
  t: ReturnType<typeof useTranslation>["t"];
}

export function LibtvImageGeneratorComposer({
  node,
  viewport,
  inputPreviews,
  openSelectId,
  draggedInputConnectionId,
  onOpenSelectChange,
  onPatchNode,
  onRun,
  onStop,
  onRemoveInput,
  onReorderInput,
  onCreateImageReference,
  onDraggedInputConnectionIdChange,
  t,
}: LibtvImageGeneratorComposerProps) {
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [workspaces, setWorkspaces] = useState<LibtvWorkspaceRecord[]>([]);
  const [models, setModels] = useState<LibtvImageModelRecord[]>([]);
  const [loadError, setLoadError] = useState("");

  const state = node?.libtvImageGeneration || {};
  const workspaceId = state.workspaceId || "";
  const modelName = state.modelName || "";
  const isRunning = Boolean(state.running);

  useEffect(() => {
    if (!node || node.type !== "libtvImageGenerator") return;
    let canceled = false;
    setLoadError("");
    void Promise.all([listLibtvWorkspaces(), listLibtvImageModels()])
      .then(([workspaceResult, modelResult]) => {
        if (canceled) return;
        setWorkspaces(workspaceResult.workspaces || []);
        setModels(modelResult.models || []);
      })
      .catch((error) => {
        if (!canceled) setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      canceled = true;
    };
  }, [node?.id, node?.type]);

  if (!node || node.type !== "libtvImageGenerator") return null;

  const promptInputs = inputPreviews.filter((item): item is Extract<ImageGeneratorInputPreview, { kind: "prompt" }> => item.kind === "prompt");
  const imageInputs = inputPreviews.filter((item): item is Extract<ImageGeneratorInputPreview, { kind: "image" }> => item.kind === "image");
  const width = clamp(Math.round(node.w + 300), 560, 760);
  const composerGap = 14 / viewport.scale;
  const composerLeft = WORLD_CENTER + node.x + node.w / 2 - width / 2 / viewport.scale;
  const selectId = (name: string) => `${node.id}:${name}`;
  const sizePanelId = selectId("libtv-size");
  const aspectRatio = (LIBTV_ASPECT_RATIO_OPTIONS as readonly string[]).includes(state.aspectRatio || "1:1") ? state.aspectRatio || "1:1" : "1:1";
  const quality = (LIBTV_QUALITY_OPTIONS as readonly string[]).includes(state.quality || "2K") ? state.quality || "2K" : "2K";
  const canRun = Boolean(workspaceId && modelName && ((state.prompt || "").trim() || promptInputs.length));

  const patchState = (patch: Partial<NonNullable<CanvasNode["libtvImageGeneration"]>>) => {
    onPatchNode(node.id, {
      libtvImageGeneration: {
        ...state,
        ...patch,
        error: patch.error ?? "",
      },
    });
  };

  const renderSelect = (
    name: string,
    label: string,
    value: string,
    options: Array<{ value: string; label: string }>,
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

  const workspaceOptions = useMemo(() => (
    workspaces.length
      ? workspaces.map((item) => ({ value: item.id, label: item.name || item.id }))
      : [{ value: "", label: t("infiniteCanvas:libtvNoWorkspaces") }]
  ), [t, workspaces]);
  const modelOptions = useMemo(() => (
    models.length
      ? models.map((item) => ({ value: item.modelName || item.modelKey, label: item.modelName || item.modelKey }))
      : [{ value: "", label: t("infiniteCanvas:libtvNoModels") }]
  ), [models, t]);

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
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          if (event.target.files?.length) onCreateImageReference(node.id, event.target.files);
          event.target.value = "";
        }}
      />
      <div className="ic-libtv-composer__grid">
        {renderSelect(
          "libtv-workspace",
          t("infiniteCanvas:libtvWorkspace"),
          workspaceId,
          workspaceOptions,
          (value) => {
            const workspace = workspaces.find((item) => item.id === value);
            patchState({
              workspaceId: value,
              workspaceName: workspace?.name || "",
              projectUuid: "",
              projectName: "",
            });
          },
        )}
      </div>
      <ReferenceImageStrip
        targetId={node.id}
        promptItems={promptInputs}
        imageItems={imageInputs}
        draggedConnectionId={draggedInputConnectionId}
        className="ic-image-composer__input-row"
        ariaLabel={t("infiniteCanvas:imageComposerParams")}
        uploadButton={(
          <ReferenceImageUploadButton
            ariaLabel={t("common:actions.uploadImage")}
            title={t("common:actions.uploadImage")}
            onClick={() => uploadInputRef.current?.click()}
          />
        )}
        deleteLabel={t("infiniteCanvas:deleteConnection")}
        onRemove={onRemoveInput}
        onReorder={onReorderInput}
        onDraggedConnectionIdChange={onDraggedInputConnectionIdChange}
      />
      <textarea
        className="ic-image-composer__prompt"
        value={state.prompt || ""}
        placeholder={t("infiniteCanvas:libtvPromptPlaceholder")}
        onChange={(event) => patchState({ prompt: event.target.value })}
      />
      <div className="ic-image-composer__bottom">
        <div className="ic-image-composer__params" aria-label={t("infiniteCanvas:imageComposerParams")}>
          {renderSelect(
            "libtv-model",
            t("infiniteCanvas:libtvModel"),
            modelName,
            modelOptions,
            (value) => patchState({ modelName: value }),
          )}
          <SizePresetPicker
            open={openSelectId === sizePanelId}
            resolution={quality}
            aspectRatio={aspectRatio}
            resolutionOptions={LIBTV_QUALITY_OPTIONS.map((value) => ({ value, label: value }))}
            aspectRatioOptions={LIBTV_ASPECT_RATIO_OPTIONS.map((value) => ({ value, label: value === "1:1" ? t("infiniteCanvas:ratioSquare") : value }))}
            labels={{
              trigger: `${t("infiniteCanvas:libtvQuality")} / ${t("infiniteCanvas:ratio")}`,
              resolution: t("infiniteCanvas:libtvQuality"),
              aspectRatio: t("infiniteCanvas:ratio"),
            }}
            onOpenChange={(open) => onOpenSelectChange((current) => (open ? sizePanelId : current === sizePanelId ? "" : current))}
            onResolutionChange={(value) => patchState({ quality: value as NonNullable<CanvasNode["libtvImageGeneration"]>["quality"] })}
            onAspectRatioChange={(value) => patchState({ aspectRatio: value as NonNullable<CanvasNode["libtvImageGeneration"]>["aspectRatio"] })}
          />
        </div>
        <button
          type="button"
          className={`ic-image-composer__run${isRunning ? " is-stop" : ""}`}
          aria-label={isRunning ? t("infiniteCanvas:stopRun") : t("infiniteCanvas:libtvRun")}
          title={isRunning ? t("infiniteCanvas:stopRun") : t("infiniteCanvas:libtvRun")}
          disabled={!isRunning && !canRun}
          onClick={() => (isRunning ? onStop(node.id) : onRun(node.id))}
        >
          {isRunning ? <Square size={15} aria-hidden="true" fill="currentColor" /> : <Play size={18} aria-hidden="true" fill="currentColor" />}
        </button>
      </div>
      {state.status ? <div className="ic-image-composer__status">{state.status}</div> : null}
      {loadError || state.error ? <div className="ic-image-composer__error">{state.error || loadError}</div> : null}
    </div>
  );
}
