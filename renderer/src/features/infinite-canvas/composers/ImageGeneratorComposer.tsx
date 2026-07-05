import { Play, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { useTranslation } from "react-i18next";
import { Select } from "../../../components/Select";
import { SizePresetPicker } from "../../../components/SizePresetPicker";
import { getModelDisplayName, type ApiProvider, type ApiProviderOrderItem } from "../../settings/apiProviders";
import { clamp, WORLD_CENTER } from "../canvasGeometry";
import type { ImageGenerationReadiness } from "../core/imageGenerationReadiness";
import { isGenerationTaskActive } from "../generation/generationTaskRuntime";
import type { CanvasGenerationTask, CanvasNode, Viewport } from "../types";
import { ReferenceImageStrip, ReferenceImageUploadButton } from "../components/ReferenceImageStrip";
import { listLibtvImageModels, listLibtvWorkspaces } from "../libtv-generation/libtvGenerationApi";
import type { LibtvImageModelRecord, LibtvWorkspaceRecord } from "../libtv-generation/libtvGenerationTypes";
import type { ImageGeneratorInputPreview } from "./composerTypes";
import { detectImageModelRuleId, getImageModelRule, normalizeImageModelSizeSelection } from "../../settings/imageModelRules";

const AUTO_SIZE_VALUE = "auto";

interface ImageGeneratorComposerProps {
  node: CanvasNode | null;
  viewport: Viewport;
  selectedProvider: ApiProvider | null;
  selectedModel: string;
  imageProviders: ApiProvider[];
  imageProviderOrderItems: ApiProviderOrderItem[];
  defaultImageApiType: "third-party-api" | "libtv-api";
  libtvReady: boolean;
  libtvUnavailableMessage: string;
  inputPreviews: ImageGeneratorInputPreview[];
  generationReadiness: ImageGenerationReadiness;
  generationTask?: CanvasGenerationTask | null;
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

export function ImageGeneratorComposer({
  node,
  viewport,
  selectedProvider,
  selectedModel,
  imageProviders,
  imageProviderOrderItems,
  defaultImageApiType,
  libtvReady,
  libtvUnavailableMessage,
  inputPreviews,
  generationReadiness,
  generationTask,
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
}: ImageGeneratorComposerProps) {
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [libtvWorkspaces, setLibtvWorkspaces] = useState<LibtvWorkspaceRecord[]>([]);
  const [libtvModels, setLibtvModels] = useState<LibtvImageModelRecord[]>([]);
  const [libtvLoadError, setLibtvLoadError] = useState("");

  useEffect(() => {
    if (!node || node.type !== "imageGenerator") return;
    const effectiveApiType = node.imageProviderId || node.imageModel || node.imageGenerationApiType === "libtv-api"
      ? node.imageGenerationApiType || "third-party-api"
      : defaultImageApiType;
    if (effectiveApiType !== "libtv-api") return;
    let canceled = false;
    setLibtvLoadError("");
    void Promise.all([listLibtvWorkspaces(), listLibtvImageModels()])
      .then(([workspaceResult, modelResult]) => {
        if (canceled) return;
        setLibtvWorkspaces(workspaceResult.workspaces || []);
        setLibtvModels(modelResult.models || []);
      })
      .catch((error) => {
        if (!canceled) setLibtvLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      canceled = true;
    };
  }, [defaultImageApiType, node?.id, node?.type, node?.imageGenerationApiType, node?.imageModel, node?.imageProviderId]);

  if (!node || node.type !== "imageGenerator") return null;

  const apiType = node.imageProviderId || node.imageModel || node.imageGenerationApiType === "libtv-api"
    ? node.imageGenerationApiType || "third-party-api"
    : defaultImageApiType;
  const isLibtvApi = apiType === "libtv-api";
  const libtvState = node.libtvImageGeneration || {};
  const selectedRule = selectedProvider && selectedModel
    ? getImageModelRule(selectedProvider.modelRules.image[selectedModel] || detectImageModelRuleId(selectedModel))
    : getImageModelRule("generic-image");
  const selectedSize = isLibtvApi
    ? {
      resolution: node.imageResolution || "1k",
      aspectRatio: node.imageAspectRatio || "1:1",
    }
    : normalizeImageModelSizeSelection(selectedRule, node.imageResolution, node.imageAspectRatio);
  const selectedResolution = selectedSize.resolution || AUTO_SIZE_VALUE;
  const selectedAspectRatio = selectedSize.aspectRatio;
  const resolutionValues = isLibtvApi
    ? ["1k", "2k", "4k"]
    : selectedRule.sizeRule.resolutions.length ? selectedRule.sizeRule.resolutions : [AUTO_SIZE_VALUE];
  const aspectRatioValues = isLibtvApi
    ? ["1:1", "2:3", "3:2", "4:3", "3:4", "16:9", "9:16"]
    : selectedRule.sizeRule.aspectRatios;
  const formatSizeValueLabel = (value: string) => value === AUTO_SIZE_VALUE ? t("infiniteCanvas:auto") : value.toUpperCase();
  const promptInputs = inputPreviews.filter((item): item is Extract<ImageGeneratorInputPreview, { kind: "prompt" }> => item.kind === "prompt");
  const imageInputs = inputPreviews.filter((item): item is Extract<ImageGeneratorInputPreview, { kind: "image" }> => item.kind === "image");
  const width = clamp(Math.round(node.w + 260), 520, 720);
  const composerGap = 14 / viewport.scale;
  const composerLeft = WORLD_CENTER + node.x + node.w / 2 - width / 2 / viewport.scale;
  const selectId = (name: string) => `${node.id}:${name}`;
  const sizePanelId = selectId("size");
  const patchNode = (patch: Partial<CanvasNode>) => onPatchNode(node.id, patch);
  const canRun = isLibtvApi
    ? Boolean(libtvState.workspaceId && libtvState.modelName && ((node.text || "").trim() || promptInputs.length))
    : Boolean(selectedProvider && selectedModel && generationReadiness.canRun);
  const isRunning = isLibtvApi ? Boolean(libtvState.running) : isGenerationTaskActive(generationTask || undefined);
  const generationReadinessMessage = generationReadiness.message || (
    generationReadiness.reason === "missing_prompt"
      ? t("infiniteCanvas:imageGenerationMissingPrompt")
      : generationReadiness.reason === "missing_reference_image"
        ? t("infiniteCanvas:imageGenerationMissingReferenceImage")
        : generationReadiness.reason === "reference_not_supported"
          ? t("infiniteCanvas:imageGenerationReferenceNotSupported")
          : generationReadiness.reason === "too_many_reference_images"
            ? t("infiniteCanvas:imageGenerationTooManyReferenceImages", { count: generationReadiness.maxReferenceImages || 0 })
            : ""
  );
  const apiOptions = imageProviderOrderItems.flatMap((item) => {
    if (item.type === "libtv") return libtvReady ? [{ value: "libtv-api", label: "LibTV" }] : [];
    return item.provider.imageModels.length ? [{ value: item.provider.id, label: item.provider.name || item.provider.id }] : [];
  });
  const selectedApiValue = isLibtvApi ? "libtv-api" : selectedProvider?.id || "";
  const libtvWorkspaceOptions = (
    libtvWorkspaces.length
      ? libtvWorkspaces.map((item) => ({ value: item.id, label: item.name || item.id }))
      : [{ value: "", label: t("infiniteCanvas:libtvNoWorkspaces") }]
  );
  const modelOptions = isLibtvApi
    ? (
      libtvModels.length
        ? libtvModels.map((item) => ({ value: item.modelName || item.modelKey, label: item.modelName || item.modelKey }))
        : [{ value: "", label: t("infiniteCanvas:libtvNoModels") }]
    )
    : (
      selectedProvider?.imageModels.length
        ? selectedProvider.imageModels.map((model) => ({ value: model, label: getModelDisplayName(selectedProvider, "image", model) }))
        : [{ value: "", label: t("settings:noImageModels") }]
    );

  const renderComposerSelect = (
    name: string,
    label: string,
    value: string,
    options: Array<{ value: string; label: string; hint?: string }>,
    onChange: (value: string) => void,
    disabled = false,
    placeholder?: string,
  ) => {
    const id = selectId(name);
    return (
      <Select
        value={value}
        options={options}
        ariaLabel={label}
        disabled={disabled}
        placeholder={placeholder}
        open={openSelectId === id && !disabled}
        onOpenChange={(nextOpen) => onOpenSelectChange((current) => (nextOpen ? id : current === id ? "" : current))}
        onChange={onChange}
      />
    );
  };

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
      <div className={`ic-image-composer__top${isLibtvApi ? " is-libtv" : ""}`}>
        {renderComposerSelect(
          "api",
          t("infiniteCanvas:platform"),
          selectedApiValue,
          apiOptions,
          (value) => {
            if (value === "libtv-api") {
              patchNode({
                imageGenerationApiType: "libtv-api",
                generationError: "",
                libtvImageGeneration: {
                  ...libtvState,
                  aspectRatio: selectedAspectRatio,
                  quality: selectedResolution.toUpperCase() as NonNullable<CanvasNode["libtvImageGeneration"]>["quality"],
                },
              });
              return;
            }
            const provider = imageProviders.find((item) => item.id === value) || null;
            const nextModel = provider?.imageModels.includes(node.imageModel || "") ? node.imageModel || "" : provider?.imageModels[0] || "";
            const nextRule = provider && nextModel ? getImageModelRule(provider.modelRules.image[nextModel] || detectImageModelRuleId(nextModel)) : getImageModelRule("generic-image");
            const nextSize = normalizeImageModelSizeSelection(nextRule, node.imageResolution, node.imageAspectRatio);
            patchNode({
              imageGenerationApiType: "third-party-api",
              imageProviderId: provider?.id || "",
              imageModel: nextModel,
              imageResolution: nextSize.resolution,
              imageAspectRatio: nextSize.aspectRatio,
              generationError: "",
            });
          },
          false,
          isLibtvApi && !libtvReady ? "LibTV" : undefined,
        )}
        {isLibtvApi ? renderComposerSelect(
          "libtv-workspace",
          t("infiniteCanvas:libtvWorkspace"),
          libtvState.workspaceId || "",
          libtvWorkspaceOptions,
          (value) => {
            const workspace = libtvWorkspaces.find((item) => item.id === value);
            patchNode({
              libtvImageGeneration: {
                ...libtvState,
                workspaceId: value,
                workspaceName: workspace?.name || "",
                projectUuid: "",
                projectName: "",
                error: "",
              },
            });
          },
        ) : null}
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
        value={node.text || ""}
        placeholder={t("infiniteCanvas:imageComposerPlaceholder")}
        onChange={(event) => patchNode({ text: event.target.value })}
      />
      <div className="ic-image-composer__bottom">
        <div className="ic-image-composer__params" aria-label={t("infiniteCanvas:imageComposerParams")}>
          {renderComposerSelect(
            "model",
            isLibtvApi ? t("infiniteCanvas:libtvModel") : t("infiniteCanvas:model"),
            isLibtvApi ? libtvState.modelName || "" : selectedModel,
            modelOptions,
            (value) => {
              if (isLibtvApi) {
                patchNode({
                  libtvImageGeneration: {
                    ...libtvState,
                    modelName: value,
                    error: "",
                  },
                });
                return;
              }
              const nextRule = selectedProvider ? getImageModelRule(selectedProvider.modelRules.image[value] || detectImageModelRuleId(value)) : getImageModelRule("generic-image");
              const nextSize = normalizeImageModelSizeSelection(nextRule, node.imageResolution, node.imageAspectRatio);
              patchNode({
                imageModel: value,
                imageProviderId: selectedProvider?.id || "",
                imageResolution: nextSize.resolution,
                imageAspectRatio: nextSize.aspectRatio,
                generationError: "",
              });
            },
            isLibtvApi ? false : !selectedProvider,
          )}
          <SizePresetPicker
            open={openSelectId === sizePanelId}
            resolution={selectedResolution}
            aspectRatio={selectedAspectRatio}
            resolutionOptions={resolutionValues.map((value) => ({ value, label: formatSizeValueLabel(value) }))}
            aspectRatioOptions={aspectRatioValues.map((value) => ({ value, label: value === "1:1" ? t("infiniteCanvas:ratioSquare") : value === AUTO_SIZE_VALUE ? t("infiniteCanvas:auto") : value }))}
            labels={{
              trigger: `${t("infiniteCanvas:resolution")} / ${t("infiniteCanvas:ratio")}`,
              resolution: t("infiniteCanvas:resolution"),
              aspectRatio: t("infiniteCanvas:ratio"),
            }}
            formatTrigger={(resolution, aspectRatio) => [formatSizeValueLabel(resolution), aspectRatio === AUTO_SIZE_VALUE ? t("infiniteCanvas:auto") : aspectRatio].filter(Boolean).join(" / ")}
            onOpenChange={(open) => onOpenSelectChange((current) => (open ? sizePanelId : current === sizePanelId ? "" : current))}
            onResolutionChange={(value) => patchNode({ imageResolution: value === AUTO_SIZE_VALUE ? "" : value })}
            onAspectRatioChange={(value) => patchNode({ imageAspectRatio: value })}
          />
        </div>
        <button
          type="button"
          className={`ic-image-composer__run${isRunning ? " is-stop" : ""}`}
          aria-label={isRunning ? t("infiniteCanvas:stopRun") : t("infiniteCanvas:run")}
          title={isRunning ? t("infiniteCanvas:stopRun") : t("infiniteCanvas:run")}
          disabled={!isRunning && !canRun}
          onClick={() => (isRunning ? onStop(node.id) : onRun(node.id))}
        >
          {isRunning ? <Square size={15} aria-hidden="true" fill="currentColor" /> : <Play size={18} aria-hidden="true" fill="currentColor" />}
        </button>
      </div>
      {!isRunning && !isLibtvApi && generationReadinessMessage ? <div className="ic-image-composer__hint">{generationReadinessMessage}</div> : null}
      {isLibtvApi && libtvState.status ? <div className="ic-image-composer__status">{libtvState.status}</div> : null}
      {node.generationError || libtvState.error || libtvLoadError || (isLibtvApi && !libtvReady ? libtvUnavailableMessage : "") ? (
        <div className="ic-image-composer__error">{node.generationError || libtvState.error || libtvLoadError || libtvUnavailableMessage}</div>
      ) : null}
    </div>
  );
}
