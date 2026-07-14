import { NodeToolbar, Position, useEdges, useNodes, useStore } from "@xyflow/react";
import { CircleAlert, Images, Play, Square, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { LibtvImageModelRecord } from "../../../app/appConfig";
import { AppSelect } from "../../../components/AppSelect";
import { SizePresetPicker } from "../../../components/SizePresetPicker";
import { Alert, AlertDescription } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { Card, CardContent } from "../../../components/ui/card";
import { Field, FieldGroup } from "../../../components/ui/field";
import { ScrollArea } from "../../../components/ui/scroll-area";
import { Textarea } from "../../../components/ui/textarea";
import {
  API_PROVIDER_CHANGED_EVENT,
  getModelDisplayName,
  isImageProviderConfigured,
  loadApiSettings,
  orderedApiProviderItems,
  orderedApiProviders,
  readApiSettings,
  type ApiSettings,
} from "../../settings/apiProviders";
import {
  detectImageModelRuleId,
  getImageModelRule,
  imageModelImageCountOptions,
  normalizeImageModelGenerationSelection,
  normalizeImageModelSizeSelection,
} from "../../settings/imageModelRules";
import { useNativeCanvasActions } from "../canvasActions";
import type { NativeCanvasEdge, NativeCanvasNode, NativeCanvasNodeData } from "../nativeCanvas";
import { collectImageGeneratorPrompts, collectImageGeneratorReferences } from "../generation/imageGenerationInputs";
import { isNativeGenerationTaskActive } from "../generation/useNativeImageGeneration";
import { isNodeGenerationLaunching, useGenerationRuntimeStore } from "../generation/generationRuntimeStore";
import { useGenerationPreferenceStore } from "../generation/generationPreferenceStore";
import {
  DEFAULT_LIBTV_CAPABILITIES,
  deriveLibtvModelCapabilities,
  normalizeLibtvModels,
} from "../libtv-generation/libtvModelSchema";
import { isNativeLibtvTaskActive } from "../libtv-generation/useNativeLibtvGeneration";
import { ImageReferenceStrip } from "./ImageReferenceStrip";


interface ImageGeneratorParamPanelProps {
  nodeId: string;
  data: NativeCanvasNodeData;
  visible: boolean;
  showPrompt?: boolean;
  showImageCount?: boolean;
  runDisabled?: boolean;
  beforeRunControl?: ReactNode;
  taskRunningOverride?: boolean;
  onRun?: () => void | Promise<void>;
  onStop?: () => void | Promise<void>;
}

export function ImageGeneratorParamPanel({
  nodeId,
  data,
  visible,
  showPrompt = true,
  showImageCount = true,
  runDisabled = false,
  beforeRunControl,
  taskRunningOverride,
  onRun,
  onStop,
}: ImageGeneratorParamPanelProps) {
  const toolbarOffset = useStore((state) => state.transform[2]) * 20;
  const { t } = useTranslation();
  const actions = useNativeCanvasActions();
  const canvasNodes = useNodes<NativeCanvasNode>();
  const canvasEdges = useEdges<NativeCanvasEdge>();
  const { patchNodeData } = actions;
  const [apiSettings, setApiSettings] = useState<ApiSettings>(() => readApiSettings());
  const [libtvModels, setLibtvModels] = useState<LibtvImageModelRecord[]>([]);
  const [libtvSchema, setLibtvSchema] = useState<unknown>(null);
  const [libtvLoadError, setLibtvLoadError] = useState("");
  const [sizePickerOpen, setSizePickerOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState(() => String(data.text || ""));
  const referenceInputRef = useRef<HTMLInputElement | null>(null);
  const promptDraftRef = useRef(promptDraft);
  const promptFocusedRef = useRef(false);
  const promptComposingRef = useRef(false);
  const pendingPromptCommitRef = useRef<string | null>(null);
  const committedPromptRef = useRef(String(data.text || ""));
  const wasVisibleRef = useRef(visible);

  const commitPrompt = useCallback((prompt = promptDraftRef.current) => {
    if (prompt === committedPromptRef.current) return;
    committedPromptRef.current = prompt;
    pendingPromptCommitRef.current = prompt;
    patchNodeData(nodeId, { text: prompt });
  }, [nodeId, patchNodeData]);

  useEffect(() => {
    const externalPrompt = String(data.text || "");
    const pendingPrompt = pendingPromptCommitRef.current;
    if (pendingPrompt !== null) {
      if (externalPrompt === pendingPrompt) pendingPromptCommitRef.current = null;
      else return;
    }
    committedPromptRef.current = externalPrompt;
    if (promptFocusedRef.current || promptComposingRef.current || promptDraftRef.current === externalPrompt) return;
    promptDraftRef.current = externalPrompt;
    setPromptDraft(externalPrompt);
  }, [data.text]);

  useEffect(() => {
    if (wasVisibleRef.current && !visible) commitPrompt();
    wasVisibleRef.current = visible;
  }, [commitPrompt, visible]);

  useEffect(() => () => {
    const prompt = promptDraftRef.current;
    if (prompt !== committedPromptRef.current) patchNodeData(nodeId, { text: prompt });
  }, [nodeId, patchNodeData]);

  useEffect(() => {
    if (!visible) {
      setSizePickerOpen(false);
      return;
    }

    const syncSettings = () => setApiSettings(readApiSettings());
    syncSettings();
    window.addEventListener(API_PROVIDER_CHANGED_EVENT, syncSettings);
    void loadApiSettings().then(setApiSettings).catch(() => undefined);
    return () => window.removeEventListener(API_PROVIDER_CHANGED_EVENT, syncSettings);
  }, [visible]);

  const providers = useMemo(() => (
    orderedApiProviders(apiSettings.providers, apiSettings.providerOrder)
      .filter(isImageProviderConfigured)
  ), [apiSettings]);
  const platformItems = useMemo(() => (
    orderedApiProviderItems(providers, apiSettings.providerOrder)
  ), [apiSettings.providerOrder, providers]);
  const isLibtv = data.imageGenerationBackend === "libtv" || providers.length === 0;
  const provider = providers.find((item) => item.id === data.imageProviderId)
    || providers.find((item) => item.id === apiSettings.defaultImageProviderId)
    || providers[0]
    || null;
  const model = provider?.imageModels.includes(data.imageModel || "")
    ? data.imageModel || ""
    : provider?.imageModels[0] || "";
  const ruleId = provider?.modelRules.image[model] || detectImageModelRuleId(model);
  const rule = getImageModelRule(ruleId);
  const sizeSelection = normalizeImageModelSizeSelection(
    rule,
    data.imageResolution,
    data.imageAspectRatio,
  );
  const libtvState = useMemo(() => data.libtvImageGeneration || {}, [data.libtvImageGeneration]);
  const normalizedLibtvModels = useMemo(() => normalizeLibtvModels(libtvModels), [libtvModels]);
  const libtvModel = normalizedLibtvModels.find((item) => item.modelName === libtvState.modelName)
    || normalizedLibtvModels[0]
    || null;
  const libtvCapabilities = libtvSchema
    ? deriveLibtvModelCapabilities(libtvSchema)
    : DEFAULT_LIBTV_CAPABILITIES;
  const storedLibtvResolution = libtvCapabilities.resolutionField === "resolution"
    ? String(libtvState.resolution || "")
    : String(libtvState.quality || "");
  const libtvResolution = libtvCapabilities.resolutions.includes(storedLibtvResolution)
    ? storedLibtvResolution
    : libtvCapabilities.defaultResolution;
  const libtvQuality = libtvCapabilities.qualities.includes(String(libtvState.quality || ""))
    ? String(libtvState.quality)
    : libtvCapabilities.defaultQuality;
  const libtvAspectRatio = libtvCapabilities.aspectRatios.includes(String(libtvState.aspectRatio || ""))
    ? String(libtvState.aspectRatio)
    : libtvCapabilities.defaultAspectRatio;
  const storedLibtvImageCount = String(libtvState.count || "");
  const libtvImageCount = !showImageCount
    ? "1"
    : libtvCapabilities.imageCounts.includes(storedLibtvImageCount)
      ? storedLibtvImageCount
      : libtvCapabilities.defaultImageCount;
  const referenceSupported = isLibtv ? libtvCapabilities.supportsReferenceImages : rule.supportsReferenceImages;
  const maxReferences = isLibtv ? libtvCapabilities.maxReferenceImages : rule.maxReferenceImages;
  const detectedTaskRunning = isLibtv
    ? isNativeLibtvTaskActive(libtvState.task)
    : isNativeGenerationTaskActive(data.generationTask) || Boolean(data.generationRemoteTaskId);
  const taskRunning = taskRunningOverride ?? detectedTaskRunning;
  const taskLaunching = useGenerationRuntimeStore((state) => isNodeGenerationLaunching(state.launchingKeys, nodeId));
  const taskBusy = taskRunning || taskLaunching;
  const promptInputs = showPrompt
    ? collectImageGeneratorPrompts(nodeId, canvasNodes, canvasEdges, t("infiniteCanvas:prompt"))
    : [];
  const referenceImages = collectImageGeneratorReferences(nodeId, canvasNodes, canvasEdges, t("infiniteCanvas:referenceImage"));
  const normalizedApiGenerationSelection = normalizeImageModelGenerationSelection(
    rule,
    data.imageQuality,
    data.imageCount,
    referenceImages.length,
  );
  const apiGenerationSelection = !showImageCount || provider?.protocol === "gemini"
    ? { ...normalizedApiGenerationSelection, imageCount: 1 }
    : normalizedApiGenerationSelection;
  const apiImageCountOptions = !showImageCount || provider?.protocol === "gemini"
    ? [1]
    : imageModelImageCountOptions(rule, referenceImages.length);
  const apiQualityOptions = (rule.qualityRule?.options || []).map((value) => ({
    value,
    label: value === "auto"
      ? t("infiniteCanvas:auto")
      : t(`infiniteCanvas:quality${value[0].toUpperCase()}${value.slice(1)}`),
  }));

  useEffect(() => {
    if (visible && providers.length === 0 && data.imageGenerationBackend !== "libtv") {
      patchNodeData(nodeId, { imageGenerationBackend: "libtv" });
    }
  }, [data.imageGenerationBackend, nodeId, patchNodeData, providers.length, visible]);

  useEffect(() => {
    if (!visible || !isLibtv || !window.libtv) return;
    let canceled = false;
    setLibtvLoadError("");
    void Promise.all([window.libtv.status(), window.libtv.account(), window.libtv.imageModels()])
      .then(([status, account, modelResult]) => {
        if (canceled) return;
        if (!status.available) throw new Error(status.error || t("infiniteCanvas:libtvUnavailable"));
        if (!account.loggedIn) throw new Error(account.error || t("infiniteCanvas:libtvNotLoggedIn"));
        setLibtvModels(modelResult.models || []);
      })
      .catch((error) => {
        if (!canceled) setLibtvLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      canceled = true;
    };
  }, [isLibtv, t, visible]);

  useEffect(() => {
    if (!visible || !isLibtv || !libtvModel || !window.libtv?.imageModelSchema) {
      setLibtvSchema(null);
      return;
    }
    let canceled = false;
    setLibtvSchema(null);
    void window.libtv.imageModelSchema({ model: libtvModel.modelName || libtvModel.modelKey })
      .then((schema) => {
        if (!canceled) setLibtvSchema(schema);
      })
      .catch((error) => {
        if (!canceled) setLibtvLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      canceled = true;
    };
  }, [isLibtv, libtvModel, visible]);

  useEffect(() => {
    if (!visible || isLibtv || !provider || !model) return;
    if (
      data.imageProviderId === provider.id
      && data.imageModel === model
      && data.imageResolution === sizeSelection.resolution
      && data.imageAspectRatio === sizeSelection.aspectRatio
      && data.imageQuality === (apiGenerationSelection.quality || undefined)
      && data.imageCount === apiGenerationSelection.imageCount
    ) return;

    patchNodeData(nodeId, {
      imageProviderId: provider.id,
      imageModel: model,
      imageResolution: sizeSelection.resolution,
      imageAspectRatio: sizeSelection.aspectRatio,
      imageQuality: apiGenerationSelection.quality || undefined,
      imageCount: apiGenerationSelection.imageCount,
    });
  }, [
    data.imageAspectRatio,
    data.imageModel,
    data.imageProviderId,
    data.imageQuality,
    data.imageCount,
    apiGenerationSelection.imageCount,
    apiGenerationSelection.quality,
    data.imageResolution,
    isLibtv,
    model,
    nodeId,
    patchNodeData,
    provider,
    sizeSelection.aspectRatio,
    sizeSelection.resolution,
    visible,
  ]);

  useEffect(() => {
    if (!visible || !isLibtv || !libtvModel) return;
    const modelName = libtvModel.modelName || libtvModel.modelKey;
    const resolution = libtvCapabilities.resolutionField === "resolution" ? libtvResolution : undefined;
    const quality = libtvCapabilities.resolutionField === "quality" ? libtvResolution : libtvQuality || undefined;
    if (
      libtvState.modelName === modelName
      && libtvState.modelKey === libtvModel.modelKey
      && libtvState.quality === quality
      && libtvState.resolution === resolution
      && libtvState.aspectRatio === libtvAspectRatio
      && libtvState.count === Number(libtvImageCount)
    ) return;
    patchNodeData(nodeId, {
      libtvImageGeneration: {
        ...libtvState,
        modelName,
        modelKey: libtvModel.modelKey,
        quality,
        resolution,
        aspectRatio: libtvAspectRatio,
        count: Number(libtvImageCount),
      },
    });
  }, [
    isLibtv,
    libtvAspectRatio,
    libtvImageCount,
    libtvModel,
    libtvQuality,
    libtvResolution,
    libtvCapabilities.resolutionField,
    libtvState,
    nodeId,
    patchNodeData,
    visible,
  ]);

  const updatePlatform = (platformId: string) => {
    if (platformId === "libtv") {
      useGenerationPreferenceStore.getState().rememberLibtv({
        modelName: libtvModel?.modelName || libtvModel?.modelKey,
        modelKey: libtvModel?.modelKey,
        resolution: libtvCapabilities.resolutionField === "resolution" ? libtvResolution : undefined,
        quality: libtvCapabilities.resolutionField === "quality" ? libtvResolution : libtvQuality || undefined,
        aspectRatio: libtvAspectRatio,
      });
      patchNodeData(nodeId, { imageGenerationBackend: "libtv", generationError: "" });
      return;
    }
    const providerId = platformId;
    const nextProvider = providers.find((item) => item.id === providerId);
    const nextModel = nextProvider?.imageModels[0];
    if (!nextProvider || !nextModel) return;
    const nextRule = getImageModelRule(nextProvider.modelRules.image[nextModel] || detectImageModelRuleId(nextModel));
    const nextSize = normalizeImageModelSizeSelection(nextRule, undefined, undefined);
    const nextGeneration = normalizeImageModelGenerationSelection(nextRule, undefined, undefined, referenceImages.length);
    useGenerationPreferenceStore.getState().rememberApi({
      providerId: nextProvider.id,
      model: nextModel,
      resolution: nextSize.resolution,
      aspectRatio: nextSize.aspectRatio,
      quality: nextGeneration.quality || undefined,
    });
    patchNodeData(nodeId, {
      imageGenerationBackend: "api",
      imageProviderId: nextProvider.id,
      imageModel: nextModel,
      imageResolution: nextSize.resolution,
      imageAspectRatio: nextSize.aspectRatio,
      imageQuality: nextGeneration.quality || undefined,
      imageCount: nextGeneration.imageCount,
    });
  };

  const updateModel = (nextModel: string) => {
    if (isLibtv) {
      const next = normalizedLibtvModels.find((item) => (item.modelName || item.modelKey) === nextModel);
      if (!next) return;
      useGenerationPreferenceStore.getState().rememberLibtv({
        modelName: next.modelName || next.modelKey,
        modelKey: next.modelKey,
        resolution: libtvCapabilities.resolutionField === "resolution" ? libtvResolution : undefined,
        quality: libtvCapabilities.resolutionField === "quality" ? libtvResolution : libtvQuality || undefined,
        aspectRatio: libtvAspectRatio,
      });
      patchNodeData(nodeId, {
        libtvImageGeneration: {
          ...libtvState,
          modelName: next.modelName || next.modelKey,
          modelKey: next.modelKey,
          error: "",
        },
      });
      return;
    }
    if (!provider) return;
    const nextRule = getImageModelRule(provider.modelRules.image[nextModel] || detectImageModelRuleId(nextModel));
    const nextSize = normalizeImageModelSizeSelection(nextRule, undefined, undefined);
    const nextGeneration = normalizeImageModelGenerationSelection(nextRule, undefined, undefined, referenceImages.length);
    useGenerationPreferenceStore.getState().rememberApi({
      providerId: provider.id,
      model: nextModel,
      resolution: nextSize.resolution,
      aspectRatio: nextSize.aspectRatio,
      quality: nextGeneration.quality || undefined,
    });
    patchNodeData(nodeId, {
      imageModel: nextModel,
      imageResolution: nextSize.resolution,
      imageAspectRatio: nextSize.aspectRatio,
      imageQuality: nextGeneration.quality || undefined,
      imageCount: nextGeneration.imageCount,
    });
  };

  const runOrStopGeneration = () => {
    if (taskLaunching) return;
    if (taskRunning) {
      void (onStop?.() ?? actions.stopImageGeneration(nodeId));
      return;
    }
    const prompt = showPrompt ? promptDraftRef.current : undefined;
    if (prompt !== undefined) commitPrompt(prompt);
    void (onRun?.() ?? actions.runImageGeneration(nodeId, { promptOverride: prompt }));
  };

  return (
    <NodeToolbar nodeId={nodeId} isVisible={visible} position={Position.Bottom} offset={toolbarOffset}>
      <Card className="nodrag nopan nowheel w-[min(40rem,calc(100vw-2rem))] gap-0 rounded-md border-border/40 py-0 shadow-sm">
        <ScrollArea className="max-h-[min(32rem,calc(100vh-4rem))]">
          <CardContent className="p-4">
            {!isLibtv && !provider ? (
              <Alert>
                <CircleAlert aria-hidden="true" />
                <AlertDescription>{t("infiniteCanvas:noImageApiConfigured")}</AlertDescription>
              </Alert>
            ) : (
              <FieldGroup className="gap-4">
                {isLibtv && libtvLoadError ? (
                  <Alert variant="destructive">
                    <CircleAlert aria-hidden="true" />
                    <AlertDescription>{libtvLoadError}</AlertDescription>
                  </Alert>
                ) : null}
                <FieldGroup className="gap-2">
                  <ImageReferenceStrip
                  actions={(
                    <>
                      <input
                        ref={referenceInputRef}
                        className="rf-native-image-input"
                        type="file"
                        accept="image/*"
                        multiple
                        tabIndex={-1}
                        onChange={(event) => {
                          const files = Array.from(event.currentTarget.files || []);
                          event.currentTarget.value = "";
                          if (files.length) void actions.addImageReferenceFiles(nodeId, files);
                        }}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        disabled={!referenceSupported || referenceImages.length >= maxReferences}
                        aria-label={t("infiniteCanvas:uploadReferenceImage")}
                        title={t("infiniteCanvas:uploadReferenceImage")}
                        onClick={() => referenceInputRef.current?.click()}
                      >
                        <Upload aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        disabled={!referenceSupported || referenceImages.length >= maxReferences}
                        aria-label={t("infiniteCanvas:referenceFromLibrary")}
                        title={t("infiniteCanvas:referenceFromLibrary")}
                        onClick={() => actions.openLibraryForReference(nodeId)}
                      >
                        <Images aria-hidden="true" />
                      </Button>
                    </>
                  )}
                  prompts={promptInputs}
                  items={referenceImages}
                  maxReferences={maxReferences}
                  supported={referenceSupported}
                  onRemove={actions.removeCanvasEdge}
                  onReorder={(edgeIds) => actions.reorderImageGeneratorReferences(nodeId, edgeIds)}
                  />

                  {showPrompt ? (
                    <Field>
                      <Textarea
                        id={`image-generator-prompt-${nodeId}`}
                        className="rf-image-generator-prompt"
                        value={promptDraft}
                        placeholder={t("infiniteCanvas:imageComposerPlaceholder")}
                        aria-label={t("infiniteCanvas:prompt")}
                        onFocus={() => {
                          promptFocusedRef.current = true;
                        }}
                        onBlur={() => {
                          promptFocusedRef.current = false;
                          commitPrompt();
                        }}
                        onCompositionStart={() => {
                          promptComposingRef.current = true;
                        }}
                        onCompositionEnd={(event) => {
                          promptComposingRef.current = false;
                          const prompt = event.currentTarget.value;
                          promptDraftRef.current = prompt;
                          setPromptDraft(prompt);
                          commitPrompt(prompt);
                        }}
                        onChange={(event) => {
                          const prompt = event.currentTarget.value;
                          promptDraftRef.current = prompt;
                          setPromptDraft(prompt);
                          if (!promptComposingRef.current) commitPrompt(prompt);
                        }}
                      />
                    </Field>
                  ) : null}
                </FieldGroup>

                <div className={beforeRunControl
                  ? "grid grid-cols-[minmax(0,0.5fr)_auto_minmax(0,1fr)_auto_minmax(9rem,0.72fr)_auto_2rem] items-center gap-2"
                  : "grid grid-cols-[minmax(0,0.5fr)_auto_minmax(0,1fr)_auto_minmax(9rem,0.72fr)_2rem] items-center gap-2"}
                >
                  <AppSelect
                    className="min-w-0"
                    size="sm"
                    value={isLibtv ? "libtv" : provider?.id || ""}
                    options={platformItems.map((item) => item.type === "libtv"
                      ? { value: "libtv", label: "LibTV" }
                      : { value: item.id, label: item.provider.name })}
                    onChange={updatePlatform}
                    ariaLabel={t("infiniteCanvas:platform")}
                    menuPlacement="top"
                    disabled={taskBusy}
                    variant="ghost"
                  />
                  <span className="text-xs text-border" aria-hidden="true">|</span>
                  <AppSelect
                    className="min-w-0"
                    size="sm"
                    value={isLibtv ? libtvModel?.modelName || libtvModel?.modelKey || "" : model}
                    options={isLibtv
                      ? normalizedLibtvModels.map((item) => ({
                        value: item.modelName || item.modelKey,
                        label: item.modelName || item.modelKey,
                      }))
                      : (provider?.imageModels || []).map((item) => ({
                        value: item,
                        label: getModelDisplayName(provider, "image", item),
                      }))}
                    onChange={updateModel}
                    ariaLabel={t("infiniteCanvas:model")}
                    menuPlacement="top"
                    disabled={taskBusy}
                    variant="ghost"
                  />
                  <span className="text-xs text-border" aria-hidden="true">|</span>
                  <SizePresetPicker
                    open={sizePickerOpen}
                    resolution={isLibtv ? libtvResolution : sizeSelection.resolution}
                    aspectRatio={isLibtv ? libtvAspectRatio : sizeSelection.aspectRatio}
                    resolutionOptions={isLibtv
                      ? libtvCapabilities.resolutionOptions
                      : rule.sizeRule.resolutions.map((item) => ({ value: item, label: item }))}
                    quality={isLibtv
                      ? libtvCapabilities.qualityOptions.length ? libtvQuality : undefined
                      : apiQualityOptions.length ? apiGenerationSelection.quality : undefined}
                    qualityOptions={isLibtv ? libtvCapabilities.qualityOptions : apiQualityOptions}
                    imageCount={showImageCount
                      ? isLibtv
                        ? libtvCapabilities.imageCountOptions.length ? libtvImageCount : undefined
                        : apiImageCountOptions.length > 1 ? String(apiGenerationSelection.imageCount) : undefined
                      : undefined}
                    imageCountOptions={showImageCount
                      ? isLibtv
                        ? libtvCapabilities.imageCountOptions.map((option) => ({
                            ...option,
                            label: t("infiniteCanvas:imageCountValue", { count: option.label }),
                          }))
                        : apiImageCountOptions.length > 1
                          ? apiImageCountOptions.map((count) => ({
                              value: String(count),
                              label: t("infiniteCanvas:imageCountValue", { count }),
                            }))
                          : undefined
                      : undefined}
                    aspectRatioOptions={isLibtv
                      ? libtvCapabilities.aspectRatioOptions
                      : rule.sizeRule.aspectRatios.map((item) => ({ value: item, label: item }))}
                    labels={{
                      trigger: `${t("infiniteCanvas:resolution")} / ${t("infiniteCanvas:ratio")}`,
                      resolution: t("infiniteCanvas:resolution"),
                      quality: t("infiniteCanvas:quality"),
                      aspectRatio: t("infiniteCanvas:ratio"),
                      imageCount: t("infiniteCanvas:imageCountOption"),
                    }}
                    formatTrigger={isLibtv ? (() => {
                      const resolutionLabel = libtvCapabilities.resolutionOptions
                        .find((option) => option.value === libtvResolution)?.label || libtvResolution;
                      const qualityLabel = libtvCapabilities.qualityOptions
                        .find((option) => option.value === libtvQuality)?.label || libtvQuality;
                      return [resolutionLabel, qualityLabel, libtvAspectRatio].filter(Boolean).join(" • ");
                    }) : undefined}
                    panelSide="top"
                    triggerSize="sm"
                    triggerVariant="ghost"
                    disabled={taskBusy}
                    onOpenChange={setSizePickerOpen}
                    onResolutionChange={(imageResolution) => {
                      if (isLibtv) {
                        useGenerationPreferenceStore.getState().rememberLibtv({
                          modelName: libtvModel?.modelName || libtvModel?.modelKey,
                          modelKey: libtvModel?.modelKey,
                          resolution: libtvCapabilities.resolutionField === "resolution" ? imageResolution : undefined,
                          quality: libtvCapabilities.resolutionField === "quality" ? imageResolution : libtvQuality || undefined,
                          aspectRatio: libtvAspectRatio,
                        });
                      } else {
                        useGenerationPreferenceStore.getState().rememberApi({
                          providerId: provider?.id,
                          model,
                          resolution: imageResolution,
                          aspectRatio: sizeSelection.aspectRatio,
                          quality: apiGenerationSelection.quality || undefined,
                        });
                      }
                      patchNodeData(nodeId, isLibtv ? {
                          libtvImageGeneration: {
                            ...libtvState,
                            [libtvCapabilities.resolutionField === "resolution" ? "resolution" : "quality"]: imageResolution,
                            error: "",
                          },
                        }
                        : { imageResolution });
                    }}
                    onQualityChange={(quality) => {
                      if (isLibtv) {
                        useGenerationPreferenceStore.getState().rememberLibtv({
                          modelName: libtvModel?.modelName || libtvModel?.modelKey,
                          modelKey: libtvModel?.modelKey,
                          resolution: libtvCapabilities.resolutionField === "resolution" ? libtvResolution : undefined,
                          quality,
                          aspectRatio: libtvAspectRatio,
                        });
                      } else {
                        useGenerationPreferenceStore.getState().rememberApi({
                          providerId: provider?.id,
                          model,
                          resolution: sizeSelection.resolution,
                          aspectRatio: sizeSelection.aspectRatio,
                          quality,
                        });
                      }
                      patchNodeData(nodeId, isLibtv
                        ? { libtvImageGeneration: { ...libtvState, quality, error: "" } }
                        : { imageQuality: quality });
                    }}
                    onImageCountChange={(count) => patchNodeData(nodeId, isLibtv
                      ? { libtvImageGeneration: { ...libtvState, count: Number(count), error: "" } }
                      : { imageCount: Number(count) })}
                    onAspectRatioChange={(imageAspectRatio) => {
                      if (isLibtv) {
                        useGenerationPreferenceStore.getState().rememberLibtv({
                          modelName: libtvModel?.modelName || libtvModel?.modelKey,
                          modelKey: libtvModel?.modelKey,
                          resolution: libtvCapabilities.resolutionField === "resolution" ? libtvResolution : undefined,
                          quality: libtvCapabilities.resolutionField === "quality" ? libtvResolution : libtvQuality || undefined,
                          aspectRatio: imageAspectRatio,
                        });
                      } else {
                        useGenerationPreferenceStore.getState().rememberApi({
                          providerId: provider?.id,
                          model,
                          resolution: sizeSelection.resolution,
                          aspectRatio: imageAspectRatio,
                          quality: apiGenerationSelection.quality || undefined,
                        });
                      }
                      patchNodeData(nodeId, isLibtv
                        ? { libtvImageGeneration: { ...libtvState, aspectRatio: imageAspectRatio, error: "" } }
                        : { imageAspectRatio });
                    }}
                  />
                  {beforeRunControl}
                  <Button
                    type="button"
                    variant="default"
                    size="icon-sm"
                    disabled={runDisabled || taskLaunching}
                    aria-label={t(taskRunning ? "infiniteCanvas:stopRun" : "infiniteCanvas:run")}
                    title={t(taskRunning ? "infiniteCanvas:stopRun" : "infiniteCanvas:run")}
                    onClick={runOrStopGeneration}
                  >
                    {taskRunning
                      ? <Square aria-hidden="true" fill="currentColor" />
                      : <Play aria-hidden="true" fill="currentColor" />}
                  </Button>
                </div>
              </FieldGroup>
            )}
          </CardContent>
        </ScrollArea>
      </Card>
    </NodeToolbar>
  );
}
