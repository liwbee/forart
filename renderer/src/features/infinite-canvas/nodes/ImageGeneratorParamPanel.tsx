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
import { Field, FieldGroup, FieldLabel } from "../../../components/ui/field";
import { ScrollArea } from "../../../components/ui/scroll-area";
import { Separator } from "../../../components/ui/separator";
import { Switch } from "../../../components/ui/switch";
import { Textarea } from "../../../components/ui/textarea";
import { cn } from "../../../lib/utils";
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
  normalizeImageModelCustomSize,
  normalizeImageModelGenerationSelection,
  normalizeImageModelSizeSelection,
} from "../../settings/imageModelRules";
import { useNativeCanvasActions } from "../canvasActions";
import {
  nativeCanvasNodeTaskId,
  type NativeCanvasEdge,
  type NativeCanvasNode,
  type NativeCanvasNodeData,
  type NativeImagePromptDocument,
} from "../nativeCanvas";
import {
  collectActionFissionAdditionalPrompts,
  collectActionFissionAdditionalReferences,
  collectImageGeneratorPrompts,
  collectImageGeneratorReferences,
} from "../generation/imageGenerationInputs";
import { clearNodeGenerationRuntimeErrors, isNodeGenerationLaunching, useGenerationRuntimeStore } from "../generation/generationRuntimeStore";
import { isGenerationTaskActive, useGenerationTaskCache } from "../generation/generationTaskCache";
import { useGenerationPreferenceStore } from "../generation/generationPreferenceStore";
import {
  DEFAULT_LIBTV_CAPABILITIES,
  deriveLibtvModelCapabilities,
  normalizeLibtvModelSelection,
  normalizeLibtvModels,
} from "../libtv-generation/libtvModelSchema";
import { ImageReferenceStrip } from "./ImageReferenceStrip";
import { normalizeImagePromptDocument } from "../generation/imagePromptReferences";
import { ImagePromptEditor } from "./ImagePromptEditor";


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

interface PendingLibtvSelection {
  modelId?: string;
  resolution: string;
  quality: string;
  aspectRatio: string;
  imageCount: number;
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
  const {
    beginHistoryGesture,
    endHistoryGesture,
    patchNodeData,
    patchNodeDataSilently,
  } = actions;
  const [apiSettings, setApiSettings] = useState<ApiSettings>(() => readApiSettings());
  const [libtvModels, setLibtvModels] = useState<LibtvImageModelRecord[]>([]);
  const [libtvSchema, setLibtvSchema] = useState<unknown>(null);
  const [libtvSchemaModelId, setLibtvSchemaModelId] = useState("");
  const [libtvLoadError, setLibtvLoadError] = useState("");
  const [sizePickerOpen, setSizePickerOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState(() => String(data.text || ""));
  const [promptDocumentDraft, setPromptDocumentDraft] = useState<NativeImagePromptDocument | undefined>(
    () => normalizeImagePromptDocument(data.imagePromptDocument),
  );
  const [negativePromptDraft, setNegativePromptDraft] = useState(() => String(data.imageNegativePrompt || ""));
  const referenceInputRef = useRef<HTMLInputElement | null>(null);
  const promptDraftRef = useRef(promptDraft);
  const promptDocumentDraftRef = useRef(promptDocumentDraft);
  const negativePromptDraftRef = useRef(negativePromptDraft);
  const promptFocusedRef = useRef(false);
  const promptComposingRef = useRef(false);
  const pendingPromptCommitRef = useRef<string | null>(null);
  const committedPromptRef = useRef(String(data.text || ""));
  const committedPromptDocumentRef = useRef(JSON.stringify(normalizeImagePromptDocument(data.imagePromptDocument) || null));
  const committedNegativePromptRef = useRef(String(data.imageNegativePrompt || ""));
  const wasVisibleRef = useRef(visible);
  const pendingLibtvSelectionRef = useRef<PendingLibtvSelection | null>(null);

  const commitPrompt = useCallback((
    prompt = promptDraftRef.current,
    document = promptDocumentDraftRef.current,
  ) => {
    const documentSignature = JSON.stringify(document || null);
    if (prompt === committedPromptRef.current && documentSignature === committedPromptDocumentRef.current) return;
    committedPromptRef.current = prompt;
    committedPromptDocumentRef.current = documentSignature;
    pendingPromptCommitRef.current = prompt;
    patchNodeData(nodeId, { text: prompt, imagePromptDocument: document });
  }, [nodeId, patchNodeData]);

  const commitNegativePrompt = useCallback((negativePrompt = negativePromptDraftRef.current) => {
    if (negativePrompt === committedNegativePromptRef.current) return;
    committedNegativePromptRef.current = negativePrompt;
    patchNodeData(nodeId, { imageNegativePrompt: negativePrompt || undefined });
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
    const externalDocument = normalizeImagePromptDocument(data.imagePromptDocument);
    const externalSignature = JSON.stringify(externalDocument || null);
    committedPromptDocumentRef.current = externalSignature;
    if (promptFocusedRef.current || JSON.stringify(promptDocumentDraftRef.current || null) === externalSignature) return;
    promptDocumentDraftRef.current = externalDocument;
    setPromptDocumentDraft(externalDocument);
  }, [data.imagePromptDocument]);

  useEffect(() => {
    const externalNegativePrompt = String(data.imageNegativePrompt || "");
    committedNegativePromptRef.current = externalNegativePrompt;
    if (negativePromptDraftRef.current === externalNegativePrompt) return;
    negativePromptDraftRef.current = externalNegativePrompt;
    setNegativePromptDraft(externalNegativePrompt);
  }, [data.imageNegativePrompt]);

  useEffect(() => {
    if (wasVisibleRef.current && !visible) {
      commitPrompt();
      commitNegativePrompt();
    }
    wasVisibleRef.current = visible;
  }, [commitNegativePrompt, commitPrompt, visible]);

  useEffect(() => () => {
    const prompt = promptDraftRef.current;
    const document = promptDocumentDraftRef.current;
    if (
      prompt !== committedPromptRef.current
      || JSON.stringify(document || null) !== committedPromptDocumentRef.current
    ) {
      patchNodeData(nodeId, { text: prompt, imagePromptDocument: document });
    }
    const negativePrompt = negativePromptDraftRef.current;
    if (negativePrompt !== committedNegativePromptRef.current) {
      patchNodeData(nodeId, { imageNegativePrompt: negativePrompt || undefined });
    }
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
  const isLibtv = data.imageGenerationBackend === "libtv";
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
  const libtvModel = normalizedLibtvModels.find((item) => (
    item.modelName === libtvState.modelName || item.modelKey === libtvState.modelKey
  ))
    || normalizedLibtvModels[0]
    || null;
  const libtvModelId = libtvModel?.modelName || libtvModel?.modelKey || "";
  const libtvSchemaReady = Boolean(libtvModelId && libtvSchemaModelId === libtvModelId);
  const libtvCapabilities = libtvSchema && libtvSchemaReady
    ? deriveLibtvModelCapabilities(libtvSchema)
    : DEFAULT_LIBTV_CAPABILITIES;
  const pendingLibtvSelection = pendingLibtvSelectionRef.current;
  const pendingLibtvSelectionApplies = Boolean(
    pendingLibtvSelection
    && (!pendingLibtvSelection.modelId || pendingLibtvSelection.modelId === libtvModelId),
  );
  const storedLibtvResolution = libtvCapabilities.resolutionField === "resolution"
    ? String(libtvState.resolution || "")
    : String(libtvState.quality || "");
  const normalizedLibtvSelection = normalizeLibtvModelSelection(libtvCapabilities, {
    resolution: pendingLibtvSelectionApplies
      ? pendingLibtvSelection?.resolution
      : storedLibtvResolution,
    quality: pendingLibtvSelectionApplies
      ? pendingLibtvSelection?.quality
      : String(libtvState.quality || ""),
    aspectRatio: pendingLibtvSelectionApplies
      ? pendingLibtvSelection?.aspectRatio
      : String(libtvState.aspectRatio || ""),
    imageCount: pendingLibtvSelectionApplies
      ? pendingLibtvSelection?.imageCount
      : libtvState.count,
  }, !showImageCount);
  const libtvResolution = normalizedLibtvSelection.resolution;
  const libtvQuality = normalizedLibtvSelection.quality;
  const libtvAspectRatio = normalizedLibtvSelection.aspectRatio;
  const libtvImageCount = normalizedLibtvSelection.imageCount;
  const referenceSupported = isLibtv ? libtvCapabilities.supportsReferenceImages : rule.supportsReferenceImages;
  const maxReferences = isLibtv ? libtvCapabilities.maxReferenceImages : rule.maxReferenceImages;
  const taskId = nativeCanvasNodeTaskId(data);
  const currentTask = useGenerationTaskCache((state) => taskId ? state.tasksById[taskId] : undefined);
  const detectedTaskRunning = isGenerationTaskActive(currentTask);
  const taskRunning = taskRunningOverride ?? detectedTaskRunning;
  const taskLaunching = useGenerationRuntimeStore((state) => isNodeGenerationLaunching(state.launchingKeys, nodeId));
  const taskBusy = taskRunning || taskLaunching;
  const promptInputs = showPrompt
    ? collectImageGeneratorPrompts(nodeId, canvasNodes, canvasEdges, t("infiniteCanvas:prompt"))
    : [];
  const referenceImages = collectImageGeneratorReferences(nodeId, canvasNodes, canvasEdges, t("infiniteCanvas:referenceImage"));
  const isActionFission = data.kind === "actionFission";
  const additionalReferenceImages = isActionFission
    ? collectActionFissionAdditionalReferences(nodeId, canvasNodes, canvasEdges, t("infiniteCanvas:additionalReference"))
    : [];
  const additionalReferencePrompts = isActionFission
    ? collectActionFissionAdditionalPrompts(nodeId, canvasNodes, canvasEdges, t("infiniteCanvas:additionalReference"))
    : [];
  const advancedRule = isLibtv ? undefined : rule.advancedRule;
  const promptExtendRule = advancedRule?.promptExtend;
  const hasAnyReferenceImage = referenceImages.length + additionalReferenceImages.length > 0;
  const promptExtendModes = (promptExtendRule?.modes || []).filter((mode) => (
    mode !== "agent" || !promptExtendRule?.agentTextToImageOnly || !hasAnyReferenceImage
  ));
  const storedPromptExtendMode = data.imagePromptExtendMode || promptExtendRule?.defaultMode || "direct";
  const promptExtendMode = promptExtendModes.includes(storedPromptExtendMode)
    ? storedPromptExtendMode
    : promptExtendModes[0] || "direct";
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
    if (!visible || !isLibtv || !libtvModelId) {
      setLibtvSchema(null);
      setLibtvSchemaModelId("");
      return;
    }
    if (!window.libtv?.imageModelSchema) {
      setLibtvSchema(null);
      setLibtvSchemaModelId(libtvModelId);
      return;
    }
    let canceled = false;
    setLibtvSchema(null);
    setLibtvSchemaModelId("");
    void window.libtv.imageModelSchema({ model: libtvModelId })
      .then((schema) => {
        if (canceled) return;
        setLibtvSchema(schema);
        setLibtvSchemaModelId(libtvModelId);
      })
      .catch((error) => {
        if (canceled) return;
        setLibtvLoadError(error instanceof Error ? error.message : String(error));
        setLibtvSchema(null);
        setLibtvSchemaModelId(libtvModelId);
      });
    return () => {
      canceled = true;
    };
  }, [isLibtv, libtvModelId, visible]);

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

    patchNodeDataSilently(nodeId, {
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
    patchNodeDataSilently,
    provider,
    sizeSelection.aspectRatio,
    sizeSelection.resolution,
    visible,
  ]);

  useEffect(() => {
    if (!visible || !isLibtv || !libtvModel || !libtvSchemaReady) return;
    const modelName = libtvModel.modelName || libtvModel.modelKey;
    const resolution = libtvCapabilities.resolutionField === "resolution" ? libtvResolution : undefined;
    const quality = libtvCapabilities.resolutionField === "quality" ? libtvResolution : libtvQuality || undefined;
    if (pendingLibtvSelectionApplies) pendingLibtvSelectionRef.current = null;
    useGenerationPreferenceStore.getState().rememberLibtv({
      modelName,
      modelKey: libtvModel.modelKey,
      resolution,
      quality,
      aspectRatio: libtvAspectRatio,
      count: Number(libtvImageCount),
    });
    if (
      libtvState.modelName === modelName
      && libtvState.modelKey === libtvModel.modelKey
      && libtvState.quality === quality
      && libtvState.resolution === resolution
      && libtvState.aspectRatio === libtvAspectRatio
      && libtvState.count === Number(libtvImageCount)
    ) return;
    patchNodeDataSilently(nodeId, {
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
    libtvSchemaReady,
    libtvState,
    nodeId,
    patchNodeDataSilently,
    pendingLibtvSelectionApplies,
    visible,
  ]);

  const updatePlatform = (platformId: string) => {
    clearNodeGenerationRuntimeErrors(nodeId);
    if (taskId) useGenerationRuntimeStore.getState().dismissTask(taskId);
    if (platformId === "libtv") {
      pendingLibtvSelectionRef.current = {
        resolution: sizeSelection.resolution,
        quality: apiGenerationSelection.quality,
        aspectRatio: sizeSelection.aspectRatio,
        imageCount: showImageCount ? apiGenerationSelection.imageCount : 1,
      };
      patchNodeData(nodeId, { imageGenerationBackend: "libtv" });
      return;
    }
    pendingLibtvSelectionRef.current = null;
    const providerId = platformId;
    const nextProvider = providers.find((item) => item.id === providerId);
    const nextModel = nextProvider?.imageModels[0];
    if (!nextProvider || !nextModel) return;
    const nextRule = getImageModelRule(nextProvider.modelRules.image[nextModel] || detectImageModelRuleId(nextModel));
    const nextSize = normalizeImageModelSizeSelection(
      nextRule,
      isLibtv ? libtvResolution : sizeSelection.resolution,
      isLibtv ? libtvAspectRatio : sizeSelection.aspectRatio,
    );
    const nextGeneration = normalizeImageModelGenerationSelection(
      nextRule,
      isLibtv ? libtvQuality : apiGenerationSelection.quality,
      showImageCount
        ? isLibtv ? Number(libtvImageCount) : apiGenerationSelection.imageCount
        : 1,
      referenceImages.length,
    );
    const nextImageCount = showImageCount && nextProvider.protocol !== "gemini"
      ? nextGeneration.imageCount
      : 1;
    useGenerationPreferenceStore.getState().rememberApi({
      providerId: nextProvider.id,
      model: nextModel,
      resolution: nextSize.resolution,
      aspectRatio: nextSize.aspectRatio,
      customSize: normalizeImageModelCustomSize(nextRule, data.imageCustomSize) || undefined,
      quality: nextGeneration.quality || undefined,
      count: nextImageCount,
    });
    patchNodeData(nodeId, {
      imageGenerationBackend: "api",
      imageProviderId: nextProvider.id,
      imageModel: nextModel,
      imageResolution: nextSize.resolution,
      imageAspectRatio: nextSize.aspectRatio,
      imageQuality: nextGeneration.quality || undefined,
      imageCount: nextImageCount,
    });
  };

  const updateModel = (nextModel: string) => {
    clearNodeGenerationRuntimeErrors(nodeId);
    if (taskId) useGenerationRuntimeStore.getState().dismissTask(taskId);
    if (isLibtv) {
      const next = normalizedLibtvModels.find((item) => (item.modelName || item.modelKey) === nextModel);
      if (!next) return;
      pendingLibtvSelectionRef.current = {
        modelId: next.modelName || next.modelKey,
        resolution: libtvResolution,
        quality: libtvQuality,
        aspectRatio: libtvAspectRatio,
        imageCount: showImageCount ? Number(libtvImageCount) : 1,
      };
      setLibtvSchema(null);
      setLibtvSchemaModelId("");
      patchNodeData(nodeId, {
        libtvImageGeneration: {
          ...libtvState,
          modelName: next.modelName || next.modelKey,
          modelKey: next.modelKey,
        },
      });
      return;
    }
    if (!provider) return;
    const nextRule = getImageModelRule(provider.modelRules.image[nextModel] || detectImageModelRuleId(nextModel));
    const nextSize = normalizeImageModelSizeSelection(
      nextRule,
      sizeSelection.resolution,
      sizeSelection.aspectRatio,
    );
    const nextGeneration = normalizeImageModelGenerationSelection(
      nextRule,
      apiGenerationSelection.quality,
      showImageCount ? apiGenerationSelection.imageCount : 1,
      referenceImages.length,
    );
    const nextImageCount = showImageCount && provider.protocol !== "gemini"
      ? nextGeneration.imageCount
      : 1;
    useGenerationPreferenceStore.getState().rememberApi({
      providerId: provider.id,
      model: nextModel,
      resolution: nextSize.resolution,
      aspectRatio: nextSize.aspectRatio,
      customSize: normalizeImageModelCustomSize(nextRule, data.imageCustomSize) || undefined,
      quality: nextGeneration.quality || undefined,
      count: nextImageCount,
    });
    patchNodeData(nodeId, {
      imageModel: nextModel,
      imageResolution: nextSize.resolution,
      imageAspectRatio: nextSize.aspectRatio,
      imageQuality: nextGeneration.quality || undefined,
      imageCount: nextImageCount,
    });
  };

  const runOrStopGeneration = () => {
    if (taskLaunching) return;
    if (taskRunning) {
      void (onStop?.() ?? actions.stopImageGeneration(nodeId));
      return;
    }
    const prompt = showPrompt ? promptDraftRef.current : undefined;
    const promptDocument = showPrompt ? promptDocumentDraftRef.current : undefined;
    const negativePrompt = advancedRule?.supportsNegativePrompt ? negativePromptDraftRef.current : undefined;
    if (prompt !== undefined) commitPrompt(prompt);
    if (negativePrompt !== undefined) commitNegativePrompt(negativePrompt);
    void (onRun?.() ?? actions.runImageGeneration(nodeId, {
      promptOverride: prompt,
      promptDocumentOverride: promptDocument,
      negativePromptOverride: negativePrompt,
    }));
  };

  const primaryReferenceStrip = (
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
  );

  return (
    <NodeToolbar nodeId={nodeId} isVisible={visible} position={Position.Bottom} offset={toolbarOffset}>
      <Card className={cn(
        "nodrag nopan nowheel gap-0 rounded-md border-border/40 py-0 shadow-sm",
        isActionFission
          ? "w-[min(50rem,calc(100vw-2rem))]"
          : "w-[min(40rem,calc(100vw-2rem))]",
      )}>
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
                  {isActionFission ? (
                    <div className="rf-action-fission-reference-groups">
                      <section className="rf-action-fission-reference-group rf-action-fission-reference-group--primary">
                        <span className="rf-action-fission-reference-title">{t("infiniteCanvas:mainReference")}</span>
                        {primaryReferenceStrip}
                      </section>
                      {additionalReferenceImages.length || additionalReferencePrompts.length ? (
                        <>
                          <Separator className="rf-action-fission-reference-divider" orientation="vertical" />
                          <section className="rf-action-fission-reference-group rf-action-fission-reference-group--additional">
                            <span className="rf-action-fission-reference-title">{t("infiniteCanvas:additionalReference")}</span>
                            <ImageReferenceStrip
                              prompts={additionalReferencePrompts}
                              items={additionalReferenceImages}
                              maxReferences={Math.max(0, maxReferences - referenceImages.length)}
                              supported={referenceSupported}
                              onRemove={actions.removeCanvasEdge}
                              onReorder={(edgeIds) => actions.reorderImageGeneratorReferences(nodeId, edgeIds)}
                            />
                          </section>
                        </>
                      ) : null}
                    </div>
                  ) : primaryReferenceStrip}

                  {showPrompt ? (
                    <Field>
                      <ImagePromptEditor
                        id={`image-generator-prompt-${nodeId}`}
                        value={promptDraft}
                        document={promptDocumentDraft}
                        references={referenceImages}
                        placeholder={t("infiniteCanvas:imageComposerPlaceholder")}
                        ariaLabel={t("infiniteCanvas:prompt")}
                        onFocusChange={(focused) => {
                          promptFocusedRef.current = focused;
                          if (focused) beginHistoryGesture();
                          else endHistoryGesture();
                        }}
                        onCompositionChange={(composing) => {
                          promptComposingRef.current = composing;
                        }}
                        onChange={(prompt, document) => {
                          promptDraftRef.current = prompt;
                          promptDocumentDraftRef.current = document;
                          setPromptDraft(prompt);
                          setPromptDocumentDraft(document);
                          commitPrompt(prompt, document);
                        }}
                        onCommit={() => commitPrompt()}
                      />
                    </Field>
                  ) : null}
                  {advancedRule?.supportsNegativePrompt ? (
                    <Field>
                      <FieldLabel htmlFor={`image-generator-negative-prompt-${nodeId}`}>
                        {t("infiniteCanvas:negativePrompt")}
                      </FieldLabel>
                      <Textarea
                        id={`image-generator-negative-prompt-${nodeId}`}
                        className="min-h-16 resize-none"
                        value={negativePromptDraft}
                        placeholder={t("infiniteCanvas:negativePromptPlaceholder")}
                        aria-label={t("infiniteCanvas:negativePrompt")}
                        disabled={taskBusy}
                        onFocus={beginHistoryGesture}
                        onBlur={() => {
                          commitNegativePrompt();
                          endHistoryGesture();
                        }}
                        onChange={(event) => {
                          const negativePrompt = event.currentTarget.value;
                          negativePromptDraftRef.current = negativePrompt;
                          setNegativePromptDraft(negativePrompt);
                          commitNegativePrompt(negativePrompt);
                        }}
                      />
                    </Field>
                  ) : null}
                  {promptExtendRule ? (
                    <Field orientation="horizontal" className="min-h-8">
                      <FieldLabel htmlFor={`image-generator-prompt-extend-${nodeId}`}>
                        {t("infiniteCanvas:promptExtend")}
                      </FieldLabel>
                      <Switch
                        id={`image-generator-prompt-extend-${nodeId}`}
                        size="sm"
                        checked={Boolean(data.imagePromptExtend)}
                        disabled={taskBusy}
                        aria-label={t("infiniteCanvas:promptExtend")}
                        onCheckedChange={(checked) => patchNodeData(nodeId, { imagePromptExtend: checked })}
                      />
                      <AppSelect
                        className="w-28 shrink-0"
                        size="sm"
                        variant="ghost"
                        value={promptExtendMode}
                        options={promptExtendModes.map((mode) => ({
                          value: mode,
                          label: t(mode === "agent" ? "infiniteCanvas:promptExtendAgent" : "infiniteCanvas:promptExtendDirect"),
                        }))}
                        ariaLabel={t("infiniteCanvas:promptExtendMode")}
                        menuPlacement="top"
                        disabled={taskBusy || !data.imagePromptExtend}
                        onChange={(value) => patchNodeData(nodeId, { imagePromptExtendMode: value as "direct" | "agent" })}
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
                    customSize={isLibtv || !rule.sizeRule.pixelSizeConstraints ? undefined : data.imageCustomSize || ""}
                    customSizeConstraints={isLibtv ? undefined : rule.sizeRule.pixelSizeConstraints}
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
                      customSize: t("infiniteCanvas:customPixelSize"),
                      width: t("infiniteCanvas:width"),
                      height: t("infiniteCanvas:height"),
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
                          count: Number(libtvImageCount),
                        });
                      } else {
                        useGenerationPreferenceStore.getState().rememberApi({
                          providerId: provider?.id,
                          model,
                          resolution: imageResolution,
                          aspectRatio: sizeSelection.aspectRatio,
                          customSize: undefined,
                          quality: apiGenerationSelection.quality || undefined,
                          count: apiGenerationSelection.imageCount,
                        });
                      }
                      patchNodeData(nodeId, isLibtv ? {
                          libtvImageGeneration: {
                            ...libtvState,
                            [libtvCapabilities.resolutionField === "resolution" ? "resolution" : "quality"]: imageResolution,
                          },
                        }
                        : { imageResolution, imageCustomSize: undefined });
                    }}
                    onQualityChange={(quality) => {
                      if (isLibtv) {
                        useGenerationPreferenceStore.getState().rememberLibtv({
                          modelName: libtvModel?.modelName || libtvModel?.modelKey,
                          modelKey: libtvModel?.modelKey,
                          resolution: libtvCapabilities.resolutionField === "resolution" ? libtvResolution : undefined,
                          quality,
                          aspectRatio: libtvAspectRatio,
                          count: Number(libtvImageCount),
                        });
                      } else {
                        useGenerationPreferenceStore.getState().rememberApi({
                          providerId: provider?.id,
                          model,
                          resolution: sizeSelection.resolution,
                          aspectRatio: sizeSelection.aspectRatio,
                          customSize: normalizeImageModelCustomSize(rule, data.imageCustomSize) || undefined,
                          quality,
                          count: apiGenerationSelection.imageCount,
                        });
                      }
                      patchNodeData(nodeId, isLibtv
                        ? { libtvImageGeneration: { ...libtvState, quality } }
                        : { imageQuality: quality });
                    }}
                    onImageCountChange={(count) => {
                      const imageCount = Number(count);
                      if (isLibtv) {
                        useGenerationPreferenceStore.getState().rememberLibtv({
                          modelName: libtvModel?.modelName || libtvModel?.modelKey,
                          modelKey: libtvModel?.modelKey,
                          resolution: libtvCapabilities.resolutionField === "resolution" ? libtvResolution : undefined,
                          quality: libtvCapabilities.resolutionField === "quality" ? libtvResolution : libtvQuality || undefined,
                          aspectRatio: libtvAspectRatio,
                          count: imageCount,
                        });
                      } else {
                        useGenerationPreferenceStore.getState().rememberApi({
                          providerId: provider?.id,
                          model,
                          resolution: sizeSelection.resolution,
                          aspectRatio: sizeSelection.aspectRatio,
                          customSize: normalizeImageModelCustomSize(rule, data.imageCustomSize) || undefined,
                          quality: apiGenerationSelection.quality || undefined,
                          count: imageCount,
                        });
                      }
                      patchNodeData(nodeId, isLibtv
                        ? { libtvImageGeneration: { ...libtvState, count: imageCount } }
                        : { imageCount });
                    }}
                    onCustomSizeChange={isLibtv ? undefined : (imageCustomSize) => {
                      useGenerationPreferenceStore.getState().rememberApi({
                        providerId: provider?.id,
                        model,
                        resolution: sizeSelection.resolution,
                        aspectRatio: sizeSelection.aspectRatio,
                        customSize: normalizeImageModelCustomSize(rule, imageCustomSize) || undefined,
                        quality: apiGenerationSelection.quality || undefined,
                        count: apiGenerationSelection.imageCount,
                      });
                      patchNodeData(nodeId, { imageCustomSize: imageCustomSize || undefined });
                    }}
                    onAspectRatioChange={(imageAspectRatio) => {
                      if (isLibtv) {
                        useGenerationPreferenceStore.getState().rememberLibtv({
                          modelName: libtvModel?.modelName || libtvModel?.modelKey,
                          modelKey: libtvModel?.modelKey,
                          resolution: libtvCapabilities.resolutionField === "resolution" ? libtvResolution : undefined,
                          quality: libtvCapabilities.resolutionField === "quality" ? libtvResolution : libtvQuality || undefined,
                          aspectRatio: imageAspectRatio,
                          count: Number(libtvImageCount),
                        });
                      } else {
                        useGenerationPreferenceStore.getState().rememberApi({
                          providerId: provider?.id,
                          model,
                          resolution: sizeSelection.resolution,
                          aspectRatio: imageAspectRatio,
                          customSize: undefined,
                          quality: apiGenerationSelection.quality || undefined,
                          count: apiGenerationSelection.imageCount,
                        });
                      }
                      patchNodeData(nodeId, isLibtv
                        ? { libtvImageGeneration: { ...libtvState, aspectRatio: imageAspectRatio } }
                        : { imageAspectRatio, imageCustomSize: undefined });
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
