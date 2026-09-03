import { NodeToolbar, Position, useEdges, useNodes, useStore } from "@xyflow/react";
import { CircleAlert, Images, Maximize2, Minimize2, Play, Square, Upload } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type SVGProps } from "react";
import { useTranslation } from "react-i18next";
import type { ForartAgentSettings, LibtvImageModelRecord } from "../../../app/appConfig";
import { AppSelect } from "../../../components/AppSelect";
import { SizePresetPicker } from "../../../components/SizePresetPicker";
import { Alert, AlertDescription } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { Card, CardContent } from "../../../components/ui/card";
import { Field, FieldGroup, FieldLabel } from "../../../components/ui/field";
import { ScrollArea } from "../../../components/ui/scroll-area";
import { Separator } from "../../../components/ui/separator";
import { Skeleton } from "../../../components/ui/skeleton";
import { Switch } from "../../../components/ui/switch";
import { Textarea } from "../../../components/ui/textarea";
import { Spinner } from "../../../components/ui/spinner";
import { cn } from "../../../lib/utils";
import {
  API_PROVIDER_CHANGED_EVENT,
  getModelDisplayName,
  hasLoadedApiSettings,
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
  type ImageGeneratorReferenceInput,
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
import { imagePromptDocumentFromReferenceText, normalizeImagePromptDocument } from "../generation/imagePromptReferences";
import { ImagePromptEditor } from "./ImagePromptEditor";
import { useCanvasAgent } from "../../canvas-agent";
import { AGENT_SETTINGS_CHANGED_EVENT, loadAgentSettings, readAgentSettings } from "../../settings/agentSettings";
import { useInfiniteCanvasSettings } from "../infiniteCanvasSettings";

interface ImagePromptOptimizationResult {
  optimizedPrompt: string;
  preserved: string[];
  changes: Array<{ category: string; summary: string }>;
  warnings: string[];
}

function PencilSparkleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path
        d="m14.44 5.78l2.229-2.23a1.6 1.6 0 0 1 2.263 0l1.518 1.518a1.6 1.6 0 0 1 0 2.263l-2.23 2.23M14.44 5.78l3.78 3.78m-3.78-3.78l-1.815 1.814m5.596 1.967L7.98 19.8a2 2 0 0 1-1.124.565l-3.775.553.553-3.774A2 2 0 0 1 4.2 16.02l3.312-3.312"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4.4 1.418a.64.64 0 0 1 1.2 0l.167.45a4 4 0 0 0 2.366 2.365l.449.166a.64.64 0 0 1 0 1.202l-.45.166a4 4 0 0 0-2.365 2.366l-.166.449a.64.64 0 0 1-1.202 0l-.166-.45a4 4 0 0 0-2.366-2.365l-.449-.166a.64.64 0 0 1 0-1.202l.45-.166a4 4 0 0 0 2.365-2.366zm4.724 5.843a.4.4 0 0 1 .752 0l.103.281a2.5 2.5 0 0 0 1.479 1.479l.28.103a.4.4 0 0 1 0 .752l-.28.103a2.5 2.5 0 0 0-1.479 1.479l-.103.28a.4.4 0 0 1-.752 0l-.103-.28a2.5 2.5 0 0 0-1.479-1.479l-.28-.103a.4.4 0 0 1 0-.752l.28-.103a2.5 2.5 0 0 0 1.479-1.479z"
        fill="currentColor"
      />
    </svg>
  );
}

interface ImagePromptOptimizationSnapshot {
  prompt: string;
  promptInputs: string;
  referenceImages: ImageGeneratorReferenceInput[];
  model: string;
  resolution: string;
  aspectRatio: string;
  quality: string;
  customSize: string;
  imageCount: number;
}

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
  const canvasZoom = useStore((state) => state.transform[2]);
  const toolbarOffset = canvasZoom * 20;
  const { t } = useTranslation();
  const actions = useNativeCanvasActions();
  const agent = useCanvasAgent();
  const { settings: infiniteCanvasSettings, updateSettings: updateInfiniteCanvasSettings } = useInfiniteCanvasSettings();
  const promptExpanded = infiniteCanvasSettings.promptEditorsExpanded;
  const canvasNodes = useNodes<NativeCanvasNode>();
  const canvasEdges = useEdges<NativeCanvasEdge>();
  const {
    beginHistoryGesture,
    endHistoryGesture,
    patchNodeData,
    patchNodeDataSilently,
  } = actions;
  const [apiSettings, setApiSettings] = useState<ApiSettings>(() => readApiSettings());
  const [agentSettings, setAgentSettings] = useState<ForartAgentSettings>(() => readAgentSettings());
  const [apiSettingsLoaded, setApiSettingsLoaded] = useState(() => hasLoadedApiSettings());
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
  const [optimizationRunning, setOptimizationRunning] = useState(false);
  const [optimizationError, setOptimizationError] = useState("");
  const handledOptimizationRunIdRef = useRef("");
  const referenceInputRef = useRef<HTMLInputElement | null>(null);
  const [parameterPanelElement, setParameterPanelElement] = useState<HTMLDivElement | null>(null);
  const [parameterRowElement, setParameterRowElement] = useState<HTMLDivElement | null>(null);
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
  // 级联撤销/重做会取消选中并卸载面板；此时草稿是陈旧的外部状态，
  // 卸载清理提交必须跳过，否则会把刚撤销的值写回节点。
  const externalHistoryOverrideRef = useRef(false);
  const pendingLibtvSelectionRef = useRef<PendingLibtvSelection | null>(null);
  const matchingOptimizationRun = useMemo(() => Object.values(agent.runs)
    .filter((run) => run.nodeId === nodeId && run.task === "optimize-image-generator-prompt")
    .sort((left, right) => Number(right.startedAt || 0) - Number(left.startedAt || 0))[0], [agent.runs, nodeId]);
  const optimizationBusy = optimizationRunning || matchingOptimizationRun?.status === "running";

  const commitPrompt = useCallback((
    prompt = promptDraftRef.current,
    document = promptDocumentDraftRef.current,
  ) => {
    // 以归一化签名比较：编辑器重挂后 Lexical 的结构归一化（文本节点拆分等）
    // 不应再次触发历史写入，否则会产生内容等价的重复撤销条目。
    const documentSignature = JSON.stringify(normalizeImagePromptDocument(document) || null);
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

  // 级联撤销/重做完成后递增：强制把已恢复的节点数据同步进仍有焦点的编辑器。
  const [externalSyncToken, setExternalSyncToken] = useState(0);

  useEffect(() => {
    const historyOverride = externalHistoryOverrideRef.current;
    const externalPrompt = String(data.text || "");
    const pendingPrompt = pendingPromptCommitRef.current;
    if (!historyOverride && pendingPrompt !== null) {
      if (externalPrompt === pendingPrompt) pendingPromptCommitRef.current = null;
      else return;
    }
    committedPromptRef.current = externalPrompt;
    const externalDocument = normalizeImagePromptDocument(data.imagePromptDocument);
    const externalSignature = JSON.stringify(externalDocument || null);
    committedPromptDocumentRef.current = externalSignature;
    if (
      historyOverride
      || (!promptFocusedRef.current && !promptComposingRef.current)
    ) {
      if (promptDraftRef.current !== externalPrompt) {
        promptDraftRef.current = externalPrompt;
        setPromptDraft(externalPrompt);
      }
      if (JSON.stringify(promptDocumentDraftRef.current || null) !== externalSignature) {
        promptDocumentDraftRef.current = externalDocument;
        setPromptDocumentDraft(externalDocument);
      }
    }
    if (historyOverride) {
      pendingPromptCommitRef.current = null;
      externalHistoryOverrideRef.current = false;
      setExternalSyncToken((token) => token + 1);
    }
  }, [data.imagePromptDocument, data.text]);

  useEffect(() => {
    const externalNegativePrompt = String(data.imageNegativePrompt || "");
    committedNegativePromptRef.current = externalNegativePrompt;
    if (negativePromptDraftRef.current === externalNegativePrompt) return;
    negativePromptDraftRef.current = externalNegativePrompt;
    setNegativePromptDraft(externalNegativePrompt);
  }, [data.imageNegativePrompt]);

  useEffect(() => {
    if (wasVisibleRef.current && !visible && !externalHistoryOverrideRef.current) {
      commitPrompt();
      commitNegativePrompt();
    }
    wasVisibleRef.current = visible;
  }, [commitNegativePrompt, commitPrompt, visible]);

  useEffect(() => () => {
    const prompt = promptDraftRef.current;
    const document = promptDocumentDraftRef.current;
    if (
      !externalHistoryOverrideRef.current
      && (prompt !== committedPromptRef.current
        || JSON.stringify(normalizeImagePromptDocument(document) || null) !== committedPromptDocumentRef.current)
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

    const syncSettings = () => {
      setApiSettings(readApiSettings());
      setApiSettingsLoaded(hasLoadedApiSettings());
    };
    const syncAgentSettings = () => setAgentSettings(readAgentSettings());
    syncSettings();
    syncAgentSettings();
    window.addEventListener(API_PROVIDER_CHANGED_EVENT, syncSettings);
    window.addEventListener(AGENT_SETTINGS_CHANGED_EVENT, syncAgentSettings);
    void loadApiSettings()
      .then((settings) => {
        setApiSettings(settings);
        setApiSettingsLoaded(true);
      })
      .catch(() => setApiSettingsLoaded(true));
    void loadAgentSettings().then(setAgentSettings).catch(() => undefined);
    return () => {
      window.removeEventListener(API_PROVIDER_CHANGED_EVENT, syncSettings);
      window.removeEventListener(AGENT_SETTINGS_CHANGED_EVENT, syncAgentSettings);
    };
  }, [visible]);

  const providers = useMemo(() => (
    orderedApiProviders(apiSettings.providers, apiSettings.providerOrder)
      .filter(isImageProviderConfigured)
  ), [apiSettings]);
  const platformItems = useMemo(() => (
    orderedApiProviderItems(providers, apiSettings.providerOrder)
  ), [apiSettings.providerOrder, providers]);
  const optimizationRoute = agentSettings.imageGeneratorPromptOptimization;
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
  // Connected prompt nodes are also inputs for action fission. The local
  // prompt editor is hidden there, but the primary reference strip must still
  // expose and preserve the connected prompt edge.
  const promptInputs = collectImageGeneratorPrompts(nodeId, canvasNodes, canvasEdges, t("infiniteCanvas:prompt"));
  const referenceImages = collectImageGeneratorReferences(nodeId, canvasNodes, canvasEdges, t("infiniteCanvas:referenceImage"));
  const isActionFission = data.kind === "actionFission";
  const [parameterPanelWidth, setParameterPanelWidth] = useState(isActionFission ? 800 : 668);
  const showOptimizationMenuButton = showPrompt && !isActionFission;
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

  const getOptimizationSnapshot = (): ImagePromptOptimizationSnapshot => ({
    prompt: promptDraftRef.current,
    promptInputs: JSON.stringify(promptInputs.map((item) => ({ nodeId: item.nodeId, text: item.text }))),
    referenceImages: referenceImages.map((item) => ({ ...item })),
    model: isLibtv ? libtvModelId : model,
    resolution: isLibtv ? libtvResolution : sizeSelection.resolution,
    aspectRatio: isLibtv ? libtvAspectRatio : sizeSelection.aspectRatio,
    quality: isLibtv ? libtvQuality : String(apiGenerationSelection.quality || ""),
    customSize: isLibtv ? "" : String(data.imageCustomSize || ""),
    imageCount: isLibtv ? Number(libtvImageCount) : Number(apiGenerationSelection.imageCount || 1),
  });

  const runPromptOptimization = async () => {
    if (optimizationBusy || taskBusy || !showPrompt) return;
    const modelRoute = optimizationRoute;
    if (!modelRoute) {
      setOptimizationError(t("infiniteCanvas:promptOptimizationNoModel"));
      return;
    }
    commitPrompt();
    setOptimizationRunning(true);
    setOptimizationError("");
    const snapshot = getOptimizationSnapshot();
    try {
      const response = await agent.run({
        task: "optimize-image-generator-prompt",
        nodeId,
        modelRoute,
        context: {
          prompt: snapshot.prompt,
          promptInputs,
          referenceImages: snapshot.referenceImages,
          model: snapshot.model,
          resolution: snapshot.resolution,
          aspectRatio: snapshot.aspectRatio,
          quality: snapshot.quality,
          customSize: snapshot.customSize,
          imageCount: snapshot.imageCount,
        },
      });
      const raw = response.result as Partial<ImagePromptOptimizationResult> | null;
      const result: ImagePromptOptimizationResult = {
        optimizedPrompt: String(raw?.optimizedPrompt || "").trim(),
        preserved: Array.isArray(raw?.preserved) ? raw.preserved.map(String) : [],
        changes: Array.isArray(raw?.changes)
          ? raw.changes.map((change) => ({ category: String(change?.category || ""), summary: String(change?.summary || "") }))
          : [],
        warnings: Array.isArray(raw?.warnings) ? raw.warnings.map(String) : [],
      };
      if (!result.optimizedPrompt) throw new Error(t("infiniteCanvas:promptOptimizationEmpty"));
      if (handledOptimizationRunIdRef.current !== response.runId) {
        handledOptimizationRunIdRef.current = response.runId;
        applyPromptOptimizationResult(result, snapshot);
      }
    } catch (error) {
      setOptimizationError(error instanceof Error ? error.message : String(error));
    } finally {
      setOptimizationRunning(false);
    }
  };

  function applyPromptOptimizationResult(result: ImagePromptOptimizationResult, snapshot: ImagePromptOptimizationSnapshot) {
    const current = getOptimizationSnapshot();
    if (JSON.stringify(current) !== JSON.stringify(snapshot)) {
      setOptimizationError(t("infiniteCanvas:promptOptimizationStale"));
      return;
    }
    const nextPrompt = result.optimizedPrompt.trim();
    const nextDocument = imagePromptDocumentFromReferenceText(nextPrompt, snapshot.referenceImages);
    beginHistoryGesture();
    patchNodeData(nodeId, {
      text: nextPrompt,
      imagePromptDocument: nextDocument,
    });
    // setNodes 是异步提交的：同步收尾会读到陈旧的 nodesRef，把手势记录成
    // 等价快照（优化变更丢失成碎片条目）。延迟到提交之后收尾，保证一条完整撤销记录。
    window.setTimeout(() => endHistoryGesture(), 0);
    promptDraftRef.current = nextPrompt;
    setPromptDraft(nextPrompt);
    promptDocumentDraftRef.current = nextDocument;
    setPromptDocumentDraft(nextDocument);
    committedPromptRef.current = nextPrompt;
    committedPromptDocumentRef.current = JSON.stringify(normalizeImagePromptDocument(nextDocument) || null);
  }

  useEffect(() => {
    const run = matchingOptimizationRun;
    if (!run) return;
    if (run.status === "running") {
      setOptimizationRunning(true);
      return;
    }
    setOptimizationRunning(false);
    if (handledOptimizationRunIdRef.current === run.runId) return;
    handledOptimizationRunIdRef.current = run.runId;
    if (run.status === "failed") {
      setOptimizationError(run.error || t("infiniteCanvas:promptOptimizationEmpty"));
      return;
    }
    if (run.status !== "completed" || !run.result || typeof run.result !== "object") return;
    const raw = run.result as Partial<ImagePromptOptimizationResult>;
    const result: ImagePromptOptimizationResult = {
      optimizedPrompt: String(raw.optimizedPrompt || "").trim(),
      preserved: Array.isArray(raw.preserved) ? raw.preserved.map(String) : [],
      changes: Array.isArray(raw.changes) ? raw.changes.map((change) => ({ category: String(change?.category || ""), summary: String(change?.summary || "") })) : [],
      warnings: Array.isArray(raw.warnings) ? raw.warnings.map(String) : [],
    };
    if (!result.optimizedPrompt) return;
    const current = getOptimizationSnapshot();
    if (current.prompt.trim() === result.optimizedPrompt) return;
    const sourcePrompt = String(run.sourcePrompt ?? current.prompt);
    if (current.prompt.trim() !== sourcePrompt.trim()) return;
    applyPromptOptimizationResult(result, { ...current, prompt: sourcePrompt });
  // Run lifecycle is the durable in-memory source; editor inputs are read at completion time.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchingOptimizationRun, t]);

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
    // 智能优化进行中不允许启动生成，避免优化结果与生成输入竞争。
    if (taskLaunching || optimizationBusy) return;
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

  const optimizationControl = !showOptimizationMenuButton ? null : (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      disabled={taskBusy || optimizationBusy}
      aria-label={t("infiniteCanvas:promptOptimization")}
      title={t("infiniteCanvas:promptOptimization")}
      onClick={() => void runPromptOptimization()}
    >
      {optimizationBusy
        ? <Spinner data-icon="inline-start" />
        : <PencilSparkleIcon data-icon="inline-start" aria-hidden="true" />}
    </Button>
  );

  // Radix ScrollArea 会隔离横向内在尺寸，因此从参数行测量内容宽度，
  // 让面板能随选择值扩宽，同时把空余宽度留给中间 spacer。
  useLayoutEffect(() => {
    const panel = parameterPanelElement;
    const row = parameterRowElement;
    if (!panel || !row) return;

    const updateWidth = () => {
      const panelStyle = window.getComputedStyle(panel);
      const minimumWidth = Number.parseFloat(panelStyle.minWidth) || 0;
      const maximumWidth = Number.parseFloat(panelStyle.maxWidth) || window.innerWidth;
      const panelRect = panel.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const horizontalInset = Math.max(0, rowRect.left - panelRect.left);
      const rowStyle = window.getComputedStyle(row);
      const gap = Number.parseFloat(rowStyle.columnGap) || 0;
      const contentWidth = Array.from(row.children).reduce((width, child) => (
        child.hasAttribute("data-parameter-panel-spacer")
          ? width
          : width + child.getBoundingClientRect().width
      ), gap * Math.max(0, row.children.length - 1));
      const nextWidth = Math.min(
        maximumWidth,
        Math.max(minimumWidth, Math.ceil(contentWidth + horizontalInset * 2)),
      );
      setParameterPanelWidth((currentWidth) => currentWidth === nextWidth ? currentWidth : nextWidth);
    };

    updateWidth();
    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(row);
    const mutationObserver = new MutationObserver(updateWidth);
    mutationObserver.observe(row, { childList: true, characterData: true, subtree: true });
    window.addEventListener("resize", updateWidth);
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", updateWidth);
    };
  }, [isActionFission, parameterPanelElement, parameterRowElement, visible]);

  return (
    <NodeToolbar nodeId={nodeId} isVisible={visible} position={Position.Bottom} offset={toolbarOffset}>
      <div ref={setParameterPanelElement} style={{ width: parameterPanelWidth }} className={cn(
        "w-max max-w-[calc(100vw-2rem)]",
        isActionFission
          ? "min-w-[min(50rem,calc(100vw-2rem))]"
          : "min-w-[min(41.75rem,calc(100vw-2rem))]",
      )}>
      <Card className="nodrag nopan nowheel relative w-full gap-0 rounded-md border-border/40 py-0 shadow-sm">
        {showPrompt ? (
          <Button
            type="button"
            variant="outline"
            size="icon-micro"
            className="absolute -right-px -top-px z-10 translate-x-1/2 -translate-y-1/2 rounded-full border-border/40 bg-card shadow-sm hover:bg-card dark:bg-card dark:hover:bg-card active:-translate-y-1/2"
            aria-label={t(promptExpanded ? "infiniteCanvas:collapsePromptEditor" : "infiniteCanvas:expandPromptEditor")}
            title={t(promptExpanded ? "infiniteCanvas:collapsePromptEditor" : "infiniteCanvas:expandPromptEditor")}
            aria-controls={`image-generator-prompt-${nodeId}`}
            aria-expanded={promptExpanded}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => updateInfiniteCanvasSettings((current) => ({
              ...current,
              promptEditorsExpanded: !current.promptEditorsExpanded,
            }))}
          >
            {promptExpanded
              ? <Minimize2 aria-hidden="true" />
              : <Maximize2 aria-hidden="true" />}
          </Button>
        ) : null}
        <ScrollArea className={promptExpanded
          ? "max-h-[calc(100vh-4rem)]"
          : "max-h-[min(32rem,calc(100vh-4rem))]"}>
          <CardContent className="p-2">
            {!apiSettingsLoaded ? (
              <div className="flex min-h-24 flex-col justify-center gap-2" aria-busy="true">
                <Skeleton className="h-3 w-[72%]" />
                <Skeleton className="h-3 w-[54%]" />
              </div>
            ) : !isLibtv && !provider ? (
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
                <FieldGroup className="gap-2 [contain:inline-size]">
                    {isActionFission ? (
                    <div className="rf-action-fission-reference-groups">
                      <section className="rf-action-fission-reference-group rf-action-fission-reference-group--primary">
                        <span className="rf-action-fission-reference-title">{t("infiniteCanvas:mainReference")}</span>
                        {primaryReferenceStrip}
                      </section>
                      {additionalReferenceImages.length || additionalReferencePrompts.length ? (
                        <>
                          <Separator className="rf-action-fission-reference-divider" orientation="horizontal" />
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

                    {showPrompt && !isActionFission && optimizationError ? (
                      <Alert variant="destructive"><CircleAlert aria-hidden="true" /><AlertDescription>{optimizationError}</AlertDescription></Alert>
                    ) : null}

                    {showPrompt ? (
                      <Field className="-mt-2">
                      {optimizationBusy ? (
                        <div
                          className="flex min-h-24 flex-col justify-center gap-2 rounded-md border border-border/40 bg-muted/30 p-3"
                          role="status"
                          aria-label={t("infiniteCanvas:promptOptimizationRunning")}
                        >
                          <Skeleton className="h-3 w-[92%]" />
                          <Skeleton className="h-3 w-[78%]" />
                          <Skeleton className="h-3 w-[64%]" />
                        </div>
                      ) : (
                        <ImagePromptEditor
                          id={`image-generator-prompt-${nodeId}`}
                          value={promptDraft}
                          document={promptDocumentDraft}
                          references={referenceImages}
                          placeholder={t("infiniteCanvas:imageComposerPlaceholder")}
                          ariaLabel={t("infiniteCanvas:prompt")}
                          expanded={promptExpanded}
                          externalSyncToken={externalSyncToken}
                          onUndoFallback={() => {
                            // 点击编辑器会开启 history gesture（暂停 zundo 追踪），
                            // 暂停状态下 undo/redo 不生效，需先结束手势再操作画布历史。
                            actions.endHistoryGesture();
                            externalHistoryOverrideRef.current = true;
                            actions.undoCanvasHistory();
                          }}
                          onRedoFallback={() => {
                            actions.endHistoryGesture();
                            externalHistoryOverrideRef.current = true;
                            actions.redoCanvasHistory();
                          }}
                        onFocusChange={(focused) => {
                          promptFocusedRef.current = focused;
                          if (focused) beginHistoryGesture();
                          else endHistoryGesture();
                        }}
                        onCompositionChange={(composing) => {
                          promptComposingRef.current = composing;
                        }}
                        onChange={(prompt, document) => {
                          externalHistoryOverrideRef.current = false;
                          promptDraftRef.current = prompt;
                          promptDocumentDraftRef.current = document;
                          setPromptDraft(prompt);
                          setPromptDocumentDraft(document);
                          commitPrompt(prompt, document);
                        }}
                        onDerivedValueChange={(prompt) => {
                          // 结构化引用文档是语义真值；本地化标签/引用顺序生成的 text
                          // 只是显示缓存。同步当前值但不新增 Undo 条目，也不清空 Redo。
                          promptDraftRef.current = prompt;
                          committedPromptRef.current = prompt;
                          setPromptDraft(prompt);
                          patchNodeDataSilently(nodeId, { text: prompt });
                        }}
                        onCommit={() => commitPrompt()}
                      />
                      )}
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

                <div ref={setParameterRowElement} className="flex w-max min-w-full max-w-[calc(100vw-4rem-2px)] items-end gap-2">
                  <div className="grid min-w-0 gap-1">
                    <span className="pl-2 text-[9px] font-medium leading-none text-muted-foreground">{t("infiniteCanvas:platform")}</span>
                    <AppSelect
                      className="w-max min-w-0"
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
                      triggerTextSize="sm"
                    />
                  </div>
                  <span className="text-xs text-border" aria-hidden="true">|</span>
                  <div className="grid min-w-0 gap-1">
                    <span className="pl-2 text-[9px] font-medium leading-none text-muted-foreground">{t("infiniteCanvas:model")}</span>
                    <AppSelect
                      className="w-max min-w-0"
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
                      triggerTextSize="sm"
                    />
                  </div>
                  <span className="text-xs text-border" aria-hidden="true">|</span>
                  <div className="grid min-w-0 gap-1">
                    <span className="pl-2 text-[9px] font-medium leading-none text-muted-foreground">{t("infiniteCanvas:specification")}</span>
                    <SizePresetPicker
                      className="w-max min-w-0"
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
                    triggerTextSize="sm"
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
                  </div>
                  <span className="min-w-0 flex-1" data-parameter-panel-spacer aria-hidden="true" />
                  {beforeRunControl}
                  {optimizationControl}
                  <Button
                    type="button"
                    variant="default"
                    size="icon-sm"
                    disabled={runDisabled || taskLaunching || optimizationBusy}
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
      </div>
    </NodeToolbar>
  );
}
