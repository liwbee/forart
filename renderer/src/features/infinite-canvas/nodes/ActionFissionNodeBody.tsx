import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NodeToolbar, Position, useEdges, useNodes, useReactFlow, useStore } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import type { GenerationTaskDto } from "../../../app/appConfig";
import {
  Download,
  Images,
  Library,
  Play,
  Plus,
  Shuffle,
  Sparkles,
  Square,
  Settings2,
  Trash2,
} from "lucide-react";
import { AppScrollArea } from "../../../components/AppScrollArea";
import { ImageWithFallback } from "../../../components/ImageWithFallback";
import { RemoteDataState } from "../../../components/RemoteDataState";
import { Button } from "../../../components/ui/button";
import { ButtonGroup } from "../../../components/ui/button-group";
import { NativeTabs } from "../../../components/NativeTabs";
import { Skeleton } from "../../../components/ui/skeleton";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../../../components/ui/hover-card";
import { AdditionalReferenceToggle } from "./AdditionalReferenceToggle";
import { ImageViewer } from "../../../lib/ImageViewer";
import { cn } from "../../../lib/utils";
import { resolveLibraryImageUrl } from "../../../lib/libraryImageActions";
import { canvasPreviewSourceUrl } from "../canvasThumbnails";
import type { ActionEntry, ActionProject, ActionTag } from "../../action-library/types";
import {
  actionFissionMode,
  actionFissionModeHasData,
  addActionFissionRow,
  normalizeActionFissionState,
  removeActionFissionRow,
  switchActionFissionMode,
} from "../action-fission/actionFissionState";
import {
  actionFissionImageGenerationBlocked,
  actionFissionModeSwitchBlocked,
  actionFissionPromptGenerationBlocker,
  actionFissionRowReady,
  actionFissionReferenceImages,
  getActionFissionRunReadiness,
  randomizeActionFissionRows,
  assignPendingActionFissionRows,
  type ActionFissionBusyState,
  type ActionFissionPromptGenerationBlocker,
} from "../action-fission/actionFissionRules";
import {
  buildActionFissionAgentPromptContext,
  normalizeActionFissionAgentPromptResult,
} from "../action-fission/actionFissionAgentPrompts";
import {
  ACTION_FISSION_AGENT_TASK,
  actionFissionRowTaskId,
  MAX_ACTION_FISSION_ROWS,
  type ActionFissionCategoryGroup,
  type ActionFissionAgentReasoning,
  type ActionFissionMode,
  type ActionFissionRow,
} from "../action-fission/actionFissionTypes";
import { useActionFissionLibraryData } from "../action-fission/useActionFissionLibraryData";
import { useCanvasAgent } from "../../canvas-agent";
import { useNativeCanvasActions } from "../canvasActions";
import { actionFissionResultImage } from "../generation/generationDownloadTarget";
import { generationStatusPresentation, generationStatusTone, type GenerationStatusTone } from "../generation/generationStatusPresentation";
import { GenerationStatusDisplay } from "../generation/GenerationStatusDisplay";
import { isGenerationTaskActive, useGenerationTaskCache } from "../generation/generationTaskCache";
import type { NativeCanvasNodeData } from "../nativeCanvas";
import type { NativeCanvasEdge, NativeCanvasNode } from "../nativeCanvas";
import {
  collectAdditionalPromptInputs,
  collectAdditionalImageReferences,
  collectImageGeneratorReferences,
} from "../generation/imageGenerationInputs";
import { ActionFissionBatchActions, ActionFissionParamPanel } from "./ActionFissionParamPanel";
import { ActionFissionAgentPromptDialog } from "./ActionFissionAgentPromptDialog";
import { actionFissionLaunchingRowIds, useGenerationRuntimeStore } from "../generation/generationRuntimeStore";
import { ReferenceComparisonImageViewer } from "./ReferenceComparisonImageViewer";
import { useInfiniteCanvasSettings } from "../infiniteCanvasSettings";
import { BatchNodeProgress } from "../batch/BatchNodeProgress";
import { ResultAssetCreateButton } from "./ResultAssetCreateButton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../../components/ui/alert-dialog";

interface ActionFissionNodeBodyProps {
  nodeId: string;
  data: NativeCanvasNodeData;
  paramPanelVisible: boolean;
}

type RowTone = GenerationStatusTone;

function isRowQueued(task: GenerationTaskDto | undefined, launching = false) {
  return generationStatusTone({ task, launching }) === "queued";
}

function isRowGenerating(task: GenerationTaskDto | undefined) {
  return generationStatusTone({ task }) === "running";
}

function toneForRow(
  row: ActionFissionRow,
  task: GenerationTaskDto | undefined,
  launching = false,
  runtimeError = "",
  mode: ActionFissionMode = "library",
  /** 上一轮模型没有返回该行的提示词：状态回退为待处理（黄色）。 */
  missingPrompt = false,
): RowTone {
  return generationStatusTone({
    task,
    launching,
    runtimeError,
    resultAvailable: Boolean(row.resultUrl || task?.status === "succeeded"),
    resultDownloaded: row.resultDownloadState === "downloaded",
    ready: actionFissionRowReady(row, mode) && !missingPrompt,
  });
}

function isRowRunning(task: GenerationTaskDto | undefined) {
  return isGenerationTaskActive(task);
}

/** 下载按钮和「创建素材节点」按钮共用同一套可用条件，避免两个入口判定不一致。 */
function rowResultActionEnabled(
  row: ActionFissionRow,
  task: GenerationTaskDto | undefined,
  runtimeError: string | undefined,
  launching: boolean,
  mode: ActionFissionMode = "library",
) {
  return Boolean(actionFissionResultImage(row, task).url)
    && !launching
    && !isRowRunning(task)
    && toneForRow(row, task, false, runtimeError, mode) !== "error";
}

function statusDetails(tone: RowTone, t: ReturnType<typeof useTranslation>["t"]) {
  if (tone === "queued") return t("infiniteCanvas:actionFissionQueued");
  if (tone === "running") return t("infiniteCanvas:running");
  if (tone === "completed") return t("infiniteCanvas:actionFissionCompleted");
  if (tone === "error") return t("infiniteCanvas:generationFailed");
  if (tone === "ready") return t("infiniteCanvas:actionFissionReady");
  return t("infiniteCanvas:actionFissionPending");
}

function RowStatus({
  row,
  task,
  runtimeError,
  now,
  hasReference,
  launching,
  mode = "library",
  missingPrompt = false,
  pendingLabel,
  hideTransient = false,
}: {
  row: ActionFissionRow;
  task?: GenerationTaskDto;
  runtimeError?: string;
  now: number;
  hasReference: boolean;
  launching: boolean;
  mode?: ActionFissionMode;
  missingPrompt?: boolean;
  /** 覆盖「待配置」文案：Agent 模式下显示为待生成提示词。 */
  pendingLabel?: string;
  hideTransient?: boolean;
}) {
  const { t } = useTranslation();
  const tone = toneForRow(row, task, launching, runtimeError, mode, missingPrompt);
  const basePresentation = generationStatusPresentation({
    task,
    launching,
    runtimeError,
    resultAvailable: Boolean(row.resultUrl || task?.status === "succeeded"),
    resultDownloaded: row.resultDownloadState === "downloaded",
    ready: actionFissionRowReady(row, mode) && hasReference && !missingPrompt,
  }, t, now);
  const presentation = tone === "idle" && pendingLabel
    ? { ...basePresentation, message: pendingLabel }
    : basePresentation;
  if (hideTransient && presentation.showTransient) return null;
  return <GenerationStatusDisplay presentation={{ ...presentation, tone }} mode="inline" />;
}

interface ViewerImage {
  id: string;
  kind: "result" | "action";
  src: string;
  alt: string;
}

function openPreviewFromKeyboard(event: React.KeyboardEvent<HTMLDivElement>, onOpen: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  event.stopPropagation();
  onOpen();
}

function ActionPreview({
  row,
  onOpen,
}: {
  row: ActionFissionRow;
  onOpen: (image: ViewerImage) => void;
}) {
  const { t } = useTranslation();
  const originalUrl = row.selectedActionAssetUrl ? resolveLibraryImageUrl(row.selectedActionAssetUrl) : "";
  const previewSourceUrl = canvasPreviewSourceUrl(row.selectedActionAssetUrl, row.selectedActionThumbUrl);
  const previewUrl = previewSourceUrl ? resolveLibraryImageUrl(previewSourceUrl) : "";
  const previewFallbackUrl = originalUrl;
  const alt = t("infiniteCanvas:actionFissionActionPreview");
  return (
    <div className={cn("rf-action-fission-action-preview nodrag nopan", originalUrl && "is-viewable")}>
      <HoverCard openDelay={250} closeDelay={80}>
        <HoverCardTrigger asChild>
          <div
            className="rf-action-fission-action-preview__trigger"
            role={originalUrl ? "button" : undefined}
            tabIndex={originalUrl ? 0 : undefined}
            aria-label={originalUrl ? t("infiniteCanvas:viewLargeImage") : undefined}
            onKeyDown={originalUrl ? (event) => openPreviewFromKeyboard(event, () => onOpen({ id: row.id, kind: "action", src: originalUrl, alt })) : undefined}
            onClick={originalUrl ? (event) => {
              event.stopPropagation();
              onOpen({ id: row.id, kind: "action", src: originalUrl, alt });
            } : undefined}
          >
            {previewUrl ? <ImageWithFallback src={previewUrl} fallbackSrc={previewFallbackUrl} deferSourceChange alt={alt} loading="lazy" decoding="async" draggable={false} /> : <Images aria-hidden="true" />}
          </div>
        </HoverCardTrigger>
        {previewUrl || originalUrl || row.selectedActionName || row.selectedActionPrompt ? (
          <HoverCardContent className="rf-action-fission-action-hover-preview" side="top" sideOffset={8}>
            {previewUrl || originalUrl ? <div className="rf-action-fission-action-hover-preview__image">
              <ImageWithFallback src={previewUrl} fallbackSrc={originalUrl} alt={alt} loading="lazy" decoding="async" draggable={false} />
            </div> : null}
            <div className="rf-action-fission-action-hover-preview__text">
              {row.selectedActionName ? <strong title={row.selectedActionName}>{row.selectedActionName}</strong> : null}
              {row.selectedActionPrompt ? <p>{row.selectedActionPrompt}</p> : null}
            </div>
          </HoverCardContent>
        ) : null}
      </HoverCard>
    </div>
  );
}

function ResultPreview({
  row,
  task,
  runtimeError,
  isDownloadBusy,
  onDownload,
  onOpen,
  showStatusOverlay = false,
  launching,
  now,
  mode = "library",
}: {
  row: ActionFissionRow;
  task?: GenerationTaskDto;
  runtimeError?: string;
  isDownloadBusy: boolean;
  onDownload: () => void;
  onOpen: (image: ViewerImage) => void;
  showStatusOverlay?: boolean;
  launching: boolean;
  now: number;
  mode?: ActionFissionMode;
}) {
  const { t } = useTranslation();
  // Prefer the terminal task result while row persistence catches up. This
  // prevents a stale row URL from keeping the old image visible/downloadable.
  const resultImage = actionFissionResultImage(row, task);
  const originalUrl = resultImage.url;
  const previewUrl = resultImage.thumbUrl;
  const resolvedOriginalUrl = originalUrl ? resolveLibraryImageUrl(originalUrl) : "";
  const previewSourceUrl = canvasPreviewSourceUrl(originalUrl, previewUrl);
  const resolvedPreviewUrl = previewSourceUrl ? resolveLibraryImageUrl(previewSourceUrl) : "";
  const resolvedPreviewFallbackUrl = resolvedOriginalUrl;
  const alt = t("infiniteCanvas:actionFissionResultPreview");
  const canDownload = rowResultActionEnabled(row, task, runtimeError, launching, mode);
  const isPendingDownload = canDownload && row.resultDownloadState !== "downloaded";
  const tone = toneForRow(row, task, launching, runtimeError, mode);
  const isActive = tone === "queued" || tone === "running";
  const hasGenerationMessage = showStatusOverlay
    && (tone === "queued" || tone === "running" || tone === "error");
  return (
    <div className={cn(
      "rf-action-fission-result-preview nodrag nopan",
      isActive && "is-generating",
      showStatusOverlay && tone === "error" && "has-generation-error",
      resolvedOriginalUrl && "is-viewable",
    )}>
      {resolvedOriginalUrl ? (
        <div
          className="rf-action-fission-viewer-trigger"
          role="button"
          tabIndex={0}
          aria-label={t("infiniteCanvas:viewLargeImage")}
          onKeyDown={(event) => openPreviewFromKeyboard(event, () => onOpen({ id: row.id, kind: "result", src: resolvedOriginalUrl, alt }))}
          onClick={(event) => {
            event.stopPropagation();
            onOpen({ id: row.id, kind: "result", src: resolvedOriginalUrl, alt });
          }}
        >
          {resolvedPreviewUrl
            ? <ImageWithFallback src={resolvedPreviewUrl} fallbackSrc={resolvedPreviewFallbackUrl} deferSourceChange alt={alt} loading="lazy" decoding="async" draggable={false} />
            : !hasGenerationMessage ? <Images aria-hidden="true" /> : null}
        </div>
      ) : !hasGenerationMessage ? <Images aria-hidden="true" /> : null}
      {canDownload ? (
        <Button
          className={cn("rf-action-fission-download", isPendingDownload && "is-pending")}
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={isDownloadBusy}
          aria-label={t(isPendingDownload ? "infiniteCanvas:imagePendingDownload" : "infiniteCanvas:imageDownloaded")}
          title={t(isPendingDownload ? "infiniteCanvas:imagePendingDownload" : "infiniteCanvas:imageDownloaded")}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onDownload();
          }}
        >
          <Download aria-hidden="true" />
        </Button>
      ) : null}
      {showStatusOverlay ? <GenerationStatusDisplay presentation={generationStatusPresentation({ task, launching, runtimeError, resultAvailable: Boolean(originalUrl || task?.status === "succeeded"), resultDownloaded: row.resultDownloadState === "downloaded", ready: actionFissionRowReady(row, mode) }, t, now)} mode="overlay" /> : null}
    </div>
  );
}


function ActionRowSummary({
  row,
  projects,
  tags,
  mode = "library",
  generating = false,
}: {
  row: ActionFissionRow;
  projects: ActionProject[];
  tags: ActionTag[];
  mode?: ActionFissionMode;
  generating?: boolean;
}) {
  const { t } = useTranslation();
  if (mode === "agent") {
    // 生成提示词期间在卡片图片下方显示文本骨架，替代生图节点的扫光提示。
    if (generating) {
      return (
        <div
          className="rf-action-fission-row-summary rf-action-fission-row-summary--generating"
          role="status"
          aria-label={t("infiniteCanvas:actionFissionAgentGenerating")}
        >
          {/* 复用与文本摘要相同的三个行元素，行高自然一致，
              卡片高度不会在生成时变化，也不依赖写死的高度。 */}
          <strong><Skeleton className="inline-block h-2.5 w-[72%] align-middle" /></strong>
          <span><Skeleton className="inline-block h-2 w-[46%] align-middle" /></span>
          <small><Skeleton className="inline-block h-2 w-[88%] align-middle" /></small>
        </div>
      );
    }
    const label = String(row.agentPromptLabel || "").trim();
    const prompt = String(row.agentPrompt || "").trim();
    const firstLine = prompt.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0] || "";
    return (
  <div className="rf-action-fission-row-summary">
        <strong title={label}>{label || t("infiniteCanvas:actionFissionAgentPromptPending")}</strong>
        <span>{t(row.useAdditionalReferences
          ? "infiniteCanvas:actionFissionAgentAdditionalReferenceOn"
          : "infiniteCanvas:actionFissionAgentAdditionalReferenceOff")}</span>
        <small title={firstLine}>{firstLine || t("infiniteCanvas:actionFissionAgentPromptPending")}</small>
      </div>
    );
  }
  const selectedGroup = row.categoryGroups.find((group) => group.id === row.selectedCategoryGroupId) || row.categoryGroups[0];
  const projectName = projects.find((project) => project.id === selectedGroup?.actionProjectId)?.name || t("infiniteCanvas:actionFissionSelectProject");
  const tagNames = [
    ...tags.filter((tag) => selectedGroup?.includeActionTagIds.includes(tag.id)).map((tag) => tag.name),
    ...tags.filter((tag) => selectedGroup?.excludeActionTagIds.includes(tag.id)).map((tag) => t("infiniteCanvas:actionFissionExcludeTag", { name: tag.name })),
  ];
  return (
    <div className="rf-action-fission-row-summary">
      <strong title={projectName}>{projectName}</strong>
      <span title={tagNames.join(", ")}>{tagNames.length ? tagNames.join(" · ") : t("infiniteCanvas:actionFissionFilterAny")}</span>
      <small title={row.selectedActionName}>{row.selectedActionName || t("infiniteCanvas:actionFissionNoCandidates")}</small>
    </div>
  );
}

function hasCategoryCandidates(groups: readonly { group: ActionFissionCategoryGroup; actions: readonly ActionEntry[] }[]) {
  return groups.some(({ actions }) => actions.length > 0);
}

function ActionFissionNodeToolbar({
  nodeId,
  visible,
  showRandomize,
  canRandomize,
  onRandomize,
  canDownload,
  isDownloading,
  onDownload,
  canRun,
  isGenerationActive,
  onRun,
  onStop,
}: {
  nodeId: string;
  visible: boolean;
  showRandomize: boolean;
  canRandomize: boolean;
  onRandomize: () => void;
  canDownload: boolean;
  isDownloading: boolean;
  onDownload: () => void | Promise<void>;
  canRun: boolean;
  isGenerationActive: boolean;
  onRun: () => void | Promise<void>;
  onStop: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const toolbarOffset = useStore((canvas) => canvas.transform[2]) * 36;
  const { deleteElements } = useReactFlow<NativeCanvasNode, NativeCanvasEdge>();
  const runLabel = t(isGenerationActive ? "infiniteCanvas:stopRun" : "infiniteCanvas:run");

  return (
    <NodeToolbar nodeId={nodeId} isVisible={visible} position={Position.Top} offset={toolbarOffset} className="rf-native-node-toolbar">
      <Button
        type="button"
        variant="default"
        size="icon-sm"
        disabled={!isGenerationActive && !canRun}
        aria-label={runLabel}
        title={runLabel}
        onClick={() => void (isGenerationActive ? onStop() : onRun())}
      >
        {isGenerationActive
          ? <Square aria-hidden="true" fill="currentColor" />
          : <Play aria-hidden="true" fill="currentColor" />}
      </Button>
      {/* 运行 | 整组操作（下载 / 换一批） | 删除 */}
      <span className="rf-native-toolbar-divider" aria-hidden="true" />
      <ActionFissionBatchActions
        grouped={false}
        showRandomize={showRandomize}
        canRandomize={canRandomize}
        onRandomize={onRandomize}
        canDownload={canDownload}
        isDownloading={isDownloading}
        onDownload={onDownload}
      />
      <span className="rf-native-toolbar-divider" aria-hidden="true" />
      <Button
        type="button"
        variant="destructive"
        size="icon-sm"
        aria-label={t("common:actions.delete")}
        title={t("common:actions.delete")}
        onClick={() => void deleteElements({ nodes: [{ id: nodeId }] })}
      >
        <Trash2 aria-hidden="true" />
      </Button>
    </NodeToolbar>
  );
}

export function ActionFissionNodeBody({ nodeId, data, paramPanelVisible }: ActionFissionNodeBodyProps) {
  const { t } = useTranslation();
  const actions = useNativeCanvasActions();
  const { settings, updateSettings } = useInfiniteCanvasSettings();
  const viewerSettings = settings.referenceComparisonViewer;
  const [viewerImage, setViewerImage] = useState<ViewerImage | null>(null);
  const [viewerReferenceNodeId, setViewerReferenceNodeId] = useState("");
  const [downloadBusyRowId, setDownloadBusyRowId] = useState("");
  const [timerNow, setTimerNow] = useState(Date.now());
  const canvasNodes = useNodes<NativeCanvasNode>();
  const canvasEdges = useEdges<NativeCanvasEdge>();
  const state = useMemo(() => normalizeActionFissionState(data.actionFission), [data.actionFission]);
  const mode = actionFissionMode(state);
  const agent = useCanvasAgent();
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentError, setAgentError] = useState("");
  const [agentPromptRowId, setAgentPromptRowId] = useState("");
  const [missingPromptRowIds, setMissingPromptRowIds] = useState<ReadonlySet<string>>(() => new Set());
  const [modeSwitchTarget, setModeSwitchTarget] = useState<ActionFissionMode | null>(null);
  const activeAgentRunIdRef = useRef("");
  const agentRunLockRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const matchingAgentRun = useMemo(() => Object.values(agent.runs)
    .filter((run) => run.nodeId === nodeId && run.task === ACTION_FISSION_AGENT_TASK)
    .sort((left, right) => Number(right.startedAt || 0) - Number(left.startedAt || 0))[0], [agent.runs, nodeId]);
  const agentBusy = agentRunning || matchingAgentRun?.status === "running";
  const agentPromptRow = state.rows.find((row) => row.id === agentPromptRowId) || null;
  const tasksByRowId = useGenerationTaskCache(useShallow((cache) => Object.fromEntries(
    state.rows.map((row) => [row.id, cache.tasksById[actionFissionRowTaskId(row)]]),
  )));
  const runtimeErrorsByRowId = useGenerationRuntimeStore(useShallow((runtime) => Object.fromEntries(
    state.rows.map((row) => {
      const suffix = `:action-fission:${nodeId}:${row.id}`;
      return [row.id, Object.entries(runtime.errorsByKey).find(([key]) => key.endsWith(suffix))?.[1] || ""];
    }),
  )));
  const launchingKeys = useGenerationRuntimeStore((runtime) => runtime.launchingKeys);
  const launchingRowIds = useMemo(() => actionFissionLaunchingRowIds(launchingKeys, nodeId), [launchingKeys, nodeId]);
  const isLaunching = launchingRowIds.size > 0;
  const {
    projects,
    rowData,
    isLoading,
    failure: libraryFailure,
    retry: retryLibrary,
  } = useActionFissionLibraryData(state, { enabled: mode === "library" });
  // Agent 模式不依赖动作库，动作库故障不应影响节点主体与参数面板。
  const libraryUnavailable = mode === "library" && libraryFailure;
  const viewerImages = useMemo(() => ({
    result: state.rows.flatMap((row) => {
      const url = actionFissionResultImage(row, tasksByRowId[row.id]).url;
      return url ? [{
        id: row.id,
        kind: "result" as const,
        src: resolveLibraryImageUrl(url),
        alt: t("infiniteCanvas:actionFissionResultPreview"),
      }] : [];
    }),
    action: state.rows.flatMap((row) => row.selectedActionAssetUrl ? [{
      id: row.id,
      kind: "action" as const,
      src: resolveLibraryImageUrl(row.selectedActionAssetUrl),
      alt: t("infiniteCanvas:actionFissionActionPreview"),
    }] : []),
  }), [state.rows, t, tasksByRowId]);
  const resolvedViewerImage = viewerImage
    ? viewerImages[viewerImage.kind].find((image) => image.id === viewerImage.id) ?? viewerImage
    : null;
  const viewerRow = viewerImage
    ? state.rows.find((row) => row.id === viewerImage.id)
    : undefined;
  const primaryReferences = useMemo(
    () => collectImageGeneratorReferences(nodeId, canvasNodes, canvasEdges, t("infiniteCanvas:mainReference")),
    [canvasEdges, canvasNodes, nodeId, t],
  );
  const additionalReferences = useMemo(
    () => collectAdditionalImageReferences(nodeId, canvasNodes, canvasEdges, t("infiniteCanvas:additionalReference")),
    [canvasEdges, canvasNodes, nodeId, t],
  );
  const additionalPrompts = useMemo(
    () => collectAdditionalPromptInputs(nodeId, canvasNodes, canvasEdges, t("infiniteCanvas:additionalReference")),
    [canvasEdges, canvasNodes, nodeId, t],
  );
  const viewerReferences = useMemo(() => {
    if (viewerImage?.kind !== "result" || !viewerRow) return [];
    const allReferences = [...primaryReferences, ...additionalReferences];
    const referenceByUrl = new Map(allReferences.map((reference) => [reference.imageUrl, reference]));
    return actionFissionReferenceImages(
      viewerRow,
      primaryReferences.map((reference) => reference.imageUrl),
      additionalReferences.map((reference) => reference.imageUrl),
    ).flatMap((url) => {
      const reference = referenceByUrl.get(url);
      return reference ? [reference] : [];
    });
  }, [additionalReferences, primaryReferences, viewerImage?.kind, viewerRow]);
  const selectedViewerReferenceIndex = viewerReferences.findIndex((reference) => reference.nodeId === viewerReferenceNodeId);
  const viewerReferenceIndex = selectedViewerReferenceIndex >= 0 ? selectedViewerReferenceIndex : 0;

  const setState = useCallback((nextState: typeof state) => {
    actions.patchNodeData(nodeId, { actionFission: nextState });
  }, [actions, nodeId]);
  const setSelectionStateSilently = useCallback((nextState: typeof state) => {
    actions.patchActionFissionSelectionSilently(nodeId, nextState);
  }, [actions, nodeId]);
  const deleteRow = useCallback((rowId: string) => {
    void actions.discardActionFissionRow(nodeId, rowId);
    setState(removeActionFissionRow(state, rowId));
  }, [actions, nodeId, setState, state]);
  const canSwitchAnyRow = rowData.some(({ categoryGroups }) => hasCategoryCandidates(categoryGroups));
  const referenceCount = primaryReferences.length;
  const hasAdditionalReferences = additionalReferences.length > 0 || additionalPrompts.length > 0;
  const runReadiness = getActionFissionRunReadiness(state.rows, referenceCount, mode);
  const hasRunningRows = state.rows.some((row) => isRowGenerating(tasksByRowId[row.id]));
  const hasQueuedRows = state.rows.some((row) => isRowQueued(tasksByRowId[row.id]));
  const isRunning = state.rows.some((row) => isRowRunning(tasksByRowId[row.id]));
  const isGenerationActive = isLaunching || hasQueuedRows || hasRunningRows;
  // 两种长任务互斥：生图与生成提示词不能同时进行。
  const busy: ActionFissionBusyState = {
    imageGenerationActive: isGenerationActive,
    promptGenerationActive: agentBusy,
  };
  const modeSwitchBlocked = actionFissionModeSwitchBlocked(busy);
  const imageRunBlockedByAgent = actionFissionImageGenerationBlocked(busy);
  const promptGenerationBlocker: ActionFissionPromptGenerationBlocker | "" = actionFissionPromptGenerationBlocker({
    mode,
    referenceCount,
    busy,
  });
  const canRandomize = mode === "library" && !libraryFailure && canSwitchAnyRow && !isGenerationActive;
  const completedRowCount = state.rows.filter((row) => {
    const task = tasksByRowId[row.id];
    if (launchingRowIds.has(row.id) || isRowQueued(task) || isRowGenerating(task)) return false;
    if (toneForRow(row, task, false, runtimeErrorsByRowId[row.id], mode) === "error") return false;
    return Boolean(row.resultUrl || task?.result?.images[0]?.assetUrl);
  }).length;
  const groupTone: RowTone = isLaunching
    ? "queued"
    : hasRunningRows
      ? "running"
      : hasQueuedRows
      ? "queued"
      : state.rows.some((row) => toneForRow(row, tasksByRowId[row.id], false, runtimeErrorsByRowId[row.id], mode) === "error")
        ? "error"
        : state.rows.length > 0 && state.rows.every((row) => toneForRow(row, tasksByRowId[row.id], false, "", mode) === "completed")
          ? "completed"
          : runReadiness.canRun
            ? "ready"
            : "idle";
  const groupStatus = isLaunching
    ? t("infiniteCanvas:generationPreparing")
    : groupTone === "running"
      ? t("infiniteCanvas:actionFissionRunningProgress", { completed: completedRowCount, total: state.rows.length })
      : groupTone === "idle" && mode === "agent"
        ? t("infiniteCanvas:actionFissionAgentPromptPending")
        : statusDetails(groupTone, t);
  const downloadableRows = state.rows.filter((row) => {
    const task = tasksByRowId[row.id];
    const hasResult = Boolean(row.resultUrl || task?.result?.images[0]?.assetUrl);
    return hasResult && !launchingRowIds.has(row.id) && !isRowRunning(task)
      && toneForRow(row, task, false, runtimeErrorsByRowId[row.id], mode) !== "error";
  });
  const candidatesByRowId = useMemo(
    () => new Map(rowData.map((item) => [item.row.id, item.categoryGroups])),
    [rowData],
  );
  const selectActions = () => {
    if (mode !== "library") return;
    setState({
      ...state,
      rows: randomizeActionFissionRows(state.rows, candidatesByRowId),
    });
  };
  const setRowAdditionalReferences = (rowId: string, useAdditionalReferences: boolean) => setState({
    ...state,
    rows: state.rows.map((row) => row.id === rowId ? { ...row, useAdditionalReferences } : row),
  });

  /**
   * Agent 模式下卡片右下角的状态文案：
   * 上一轮模型没有返回提示词的行显示「未返回提示词」（沿用待配置的黄色状态）。
   */
  const agentRowMissingPrompt = (row: ActionFissionRow) => (
    mode === "agent" && missingPromptRowIds.has(row.id)
  );
  const agentPendingLabel = (row: ActionFissionRow) => {
    if (mode !== "agent") return undefined;
    return t(agentRowMissingPrompt(row)
      ? "infiniteCanvas:actionFissionAgentPromptMissing"
      : "infiniteCanvas:actionFissionAgentPromptPending");
  };

  /** Agent 模式：调 LLM 为整组卡片生成提示词，成功结果一次性写入并合并为一条撤销记录。 */
  const generateAgentPrompts = async ({ providerId, model, reasoning }: {
    providerId: string;
    model: string;
    reasoning: ActionFissionAgentReasoning;
  }) => {
    // 硬性规则：同一节点上生成提示词与生图互斥，且不允许并发生成提示词。
    if (agentRunLockRef.current || agentBusy) return;
    const current = stateRef.current;
    const targetRows = current.rows;
    if (!targetRows.length) return;
    // 前置条件不满足时按钮已经禁用，这里保持静默，不再额外弹提示。
    if (promptGenerationBlocker) return;
    const context = buildActionFissionAgentPromptContext({
      rows: targetRows,
      primaryReferences,
      additionalReferences,
      instruction: String(data.text || ""),
    });
    setAgentError("");
    setMissingPromptRowIds(new Set());
    setAgentRunning(true);
    agentRunLockRef.current = true;
    let runId = "";
    try {
      const response = await agent.run({
        task: ACTION_FISSION_AGENT_TASK,
        nodeId,
        modelRoute: { providerId, model },
        reasoning,
        context,
        onRunId: (nextRunId) => {
          runId = nextRunId;
          activeAgentRunIdRef.current = nextRunId;
        },
      });
      const { patches, missingRowIds } = normalizeActionFissionAgentPromptResult(
        response.result,
        targetRows.map((row) => row.id),
      );
      const patchByRowId = new Map(patches.map((patch) => [patch.rowId, patch]));
      const latest = stateRef.current;
      // 结果只能写回仍然是 Agent 模式的同一节点（撤销等外部改动会改变模式）。
      if (actionFissionMode(latest) === "agent") {
        const nextRows = latest.rows.map((row) => {
          const patch = patchByRowId.get(row.id);
          if (!patch) return row;
          return {
            ...row,
            agentPrompt: patch.agentPrompt,
            agentPromptLabel: patch.agentPromptLabel,
            agentWarnings: patch.agentWarnings,
          };
        });
        actions.beginHistoryGesture();
        actions.patchNodeData(nodeId, {
          actionFission: {
            ...latest,
            agentProviderId: providerId,
            agentModel: model,
            agentReasoning: reasoning,
            rows: nextRows,
          },
        });
        // setNodes 是异步提交的，延迟收尾才能把模型选择与提示词合并成一条撤销记录。
        window.setTimeout(() => actions.endHistoryGesture(), 0);
      }
      if (missingRowIds.length) {
        // 缺行不做弹窗提示，改为在对应卡片的右下角状态里标注。
        setMissingPromptRowIds(new Set(missingRowIds));
      }
    } catch (error) {
      if (activeAgentRunIdRef.current === runId) {
        setAgentError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (activeAgentRunIdRef.current === runId) activeAgentRunIdRef.current = "";
      agentRunLockRef.current = false;
      setAgentRunning(false);
    }
  };

  const cancelAgentPrompts = async () => {
    // 画布重挂后仍可能残留运行中的任务，此时用 Agent 运行记录里的 runId 兜底取消。
    const runId = activeAgentRunIdRef.current || matchingAgentRun?.runId || "";
    if (!runId) return;
    await agent.cancel(runId);
    activeAgentRunIdRef.current = "";
    setAgentRunning(false);
  };

  const saveAgentPrompt = (rowId: string, agentPrompt: string) => {
    setState({
      ...state,
      rows: state.rows.map((row) => row.id === rowId
        ? {
            ...row,
            agentPrompt: agentPrompt || undefined,
          }
        : row),
    });
  };

  const requestModeSwitch = (nextMode: ActionFissionMode) => {
    if (nextMode === mode || modeSwitchBlocked) return;
    if (!actionFissionModeHasData(state)) {
      setState(switchActionFissionMode(state, nextMode));
      return;
    }
    setModeSwitchTarget(nextMode);
  };

  const confirmModeSwitch = () => {
    if (!modeSwitchTarget) return;
    setMissingPromptRowIds(new Set());
    setState(switchActionFissionMode(state, modeSwitchTarget));
    setModeSwitchTarget(null);
  };

  useEffect(() => {
    if (!data.actionFission) actions.patchNodeDataSilently(nodeId, { actionFission: state });
  }, [actions, data.actionFission, nodeId, state]);

  useEffect(() => {
    if (!isRunning) return;
    setTimerNow(Date.now());
    const interval = window.setInterval(() => setTimerNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [isRunning]);

  useEffect(() => {
    if (mode !== "library") return;
    const pendingRows = rowData.filter(({ row, categoryGroups }) => (
      !row.selectedActionId && hasCategoryCandidates(categoryGroups)
    ));
    if (libraryFailure || !pendingRows.length) return;
    const pendingRowIds = new Set(pendingRows.map(({ row }) => row.id));
    // A row whose category filter matches no action in the library can never be filled.
    // Writing node data anyway republishes the canvas on every render, so only patch when
    // the library actually assigned something.
    const nextRows = assignPendingActionFissionRows(state.rows, candidatesByRowId, pendingRowIds);
    if (!nextRows) return;
    setSelectionStateSilently({ ...state, rows: nextRows });
  }, [candidatesByRowId, libraryFailure, mode, rowData, setSelectionStateSilently, state]);

  const refreshRow = (rowId: string) => {
    if (mode !== "library") return undefined;
    const nextState = {
      ...state,
      rows: randomizeActionFissionRows(state.rows, candidatesByRowId, { rowIds: new Set([rowId]) }),
    };
    setState(nextState);
    return nextState.rows.find((row) => row.id === rowId);
  };

  const switchViewerAction = () => {
    if (!viewerImage || viewerImage.kind !== "action") return;
    const nextRow = refreshRow(viewerImage.id);
    const nextSrc = nextRow?.selectedActionAssetUrl
      ? resolveLibraryImageUrl(nextRow.selectedActionAssetUrl)
      : "";
    if (!nextRow || !nextSrc) {
      setViewerImage(null);
      return;
    }
    setViewerImage({
      id: nextRow.id,
      kind: "action",
      src: nextSrc,
      alt: t("infiniteCanvas:actionFissionActionPreview"),
    });
  };

  const viewerActivity = viewerImage?.kind === "result" && viewerRow
    ? launchingRowIds.has(viewerRow.id) || isRowQueued(tasksByRowId[viewerRow.id])
      ? {
          state: "queued" as const,
          label: t("infiniteCanvas:actionFissionQueued"),
        }
      : isRowGenerating(tasksByRowId[viewerRow.id])
        ? {
            state: "running" as const,
            label: t("infiniteCanvas:generationInProgress"),
          }
        : undefined
    : undefined;

  const viewerActions = !viewerImage
    ? []
    : viewerImage.kind === "action"
      ? [{
          id: "switch-action",
          label: t("infiniteCanvas:actionFissionRefreshAction"),
          icon: "shuffle" as const,
          disabled: (() => {
            const row = state.rows.find((item) => item.id === viewerImage.id);
            return Boolean(libraryFailure)
              || !row
              || !hasCategoryCandidates(candidatesByRowId.get(row.id) || [])
              || launchingRowIds.has(row.id)
              || isRowRunning(tasksByRowId[row.id]);
          })(),
          onClick: switchViewerAction,
        }]
      : [{
          id: "rerun-result",
          label: viewerActivity?.state === "queued"
            ? t("infiniteCanvas:actionFissionQueued")
            : viewerActivity?.state === "running"
              ? t("infiniteCanvas:running")
              : t("infiniteCanvas:actionFissionRerunImage"),
          icon: "refresh" as const,
          disabled: (() => {
            const row = state.rows.find((item) => item.id === viewerImage.id);
            return !row
              || launchingRowIds.has(row.id)
              || isRowRunning(tasksByRowId[row.id])
              || imageRunBlockedByAgent
              || !actionFissionRowReady(row, mode)
              || referenceCount < 1;
          })(),
          onClick: () => void actions.runActionFission(nodeId, viewerImage.id),
        }];
  const viewerNavigation = (() => {
    if (!viewerImage) return undefined;
    const images = viewerImages[viewerImage.kind];
    const index = images.findIndex((image) => image.id === viewerImage.id);
    if (images.length <= 1 || index < 0) return undefined;
    return {
      index,
      total: images.length,
      previousLabel: t("infiniteCanvas:previousImage"),
      nextLabel: t("infiniteCanvas:nextImage"),
      onPrevious: () => {
        if (index > 0) setViewerImage(images[index - 1]);
      },
      onNext: () => {
        if (index < images.length - 1) setViewerImage(images[index + 1]);
      },
    };
  })();

  const downloadRow = (row: ActionFissionRow) => {
    if (downloadBusyRowId) return;
    setDownloadBusyRowId(row.id);
    void actions.downloadActionFissionResult(nodeId, row.id)
      .catch(() => undefined)
      .finally(() => setDownloadBusyRowId(""));
  };

  const downloadAllRows = async () => {
    if (downloadBusyRowId || !downloadableRows.length) return;
    setDownloadBusyRowId("group");
    try {
      for (const row of downloadableRows) {
        try {
          await actions.downloadActionFissionResult(nodeId, row.id);
        } catch {
          // The shared download action reports the row-level error.
        }
      }
    } finally {
      setDownloadBusyRowId("");
    }
  };

  return (
    <>
      <ActionFissionNodeToolbar
        nodeId={nodeId}
        visible={paramPanelVisible}
        showRandomize={mode === "library"}
        canRandomize={canRandomize}
        onRandomize={selectActions}
        canDownload={downloadableRows.length > 0}
        isDownloading={Boolean(downloadBusyRowId)}
        onDownload={downloadAllRows}
        canRun={!libraryUnavailable && runReadiness.canRun && !agentBusy}
        isGenerationActive={isGenerationActive}
        onRun={() => actions.runActionFission(nodeId)}
        onStop={() => actions.stopActionFission(nodeId)}
      />
      <section
      className={cn("rf-action-fission", libraryUnavailable && "rf-action-fission--unavailable")}
      data-generating={isGenerationActive}
      data-mode={mode}
      data-has-additional-references={hasAdditionalReferences || undefined}
    >
      <header className="rf-action-fission-header">
        <BatchNodeProgress className="rf-action-fission-group-status" completed={completedRowCount} total={state.rows.length} tone={groupTone} label={groupStatus} />
        <Button className="nodrag" type="button" variant="ghost" size="sm" disabled={state.rows.length >= MAX_ACTION_FISSION_ROWS} onClick={() => setState(addActionFissionRow(state))}>
          <Plus data-icon="inline-start" aria-hidden="true" />
          {t("infiniteCanvas:actionFissionAddRow")}
        </Button>
        <NativeTabs<ActionFissionMode>
          className="nodrag rf-action-fission-mode-tabs"
          ariaLabel={t("infiniteCanvas:actionFissionModeTabs")}
          value={mode}
          onChange={requestModeSwitch}
          items={[
            {
              value: "library",
              label: "",
              icon: Library,
              ariaLabel: t("infiniteCanvas:actionFissionModeLibrary"),
              disabled: modeSwitchBlocked,
            },
            {
              value: "agent",
              label: "",
              icon: Sparkles,
              ariaLabel: t("infiniteCanvas:actionFissionModeAgent"),
              disabled: modeSwitchBlocked,
            },
          ]}
        />
      </header>

      <AppScrollArea className="rf-action-fission-scroll nowheel" viewportClassName="rf-action-fission-scroll-viewport" scrollBarClassName="nodrag">
        {libraryUnavailable ? (
          <RemoteDataState
            failure={libraryFailure}
            scope="node"
            className="h-full min-h-0 border-0"
            onRetry={retryLibrary}
          />
        ) : isLoading ? (
          <div className="rf-action-fission-empty">{t("common:states.loading")}</div>
        ) : (
          <div className="rf-action-fission-grid">
            {rowData.map(({ row, tags, categoryGroups }, index) => (
              <article key={row.id} className="rf-action-fission-grid-card" data-index={String(index + 1).padStart(2, "0")}>
                <ResultAssetCreateButton
                  index={index + 1}
                  disabled={actions.readOnly || !rowResultActionEnabled(row, tasksByRowId[row.id], runtimeErrorsByRowId[row.id], launchingRowIds.has(row.id), mode)}
                  onCreate={(clientPoint) => actions.createAssetNodeFromResult({
                    sourceNodeId: nodeId,
                    sourceKey: row.id,
                    clientPoint,
                    ...actionFissionResultImage(row, tasksByRowId[row.id]),
                  })}
                />
                <ResultPreview mode={mode} row={row} task={tasksByRowId[row.id]} runtimeError={runtimeErrorsByRowId[row.id]} now={timerNow} launching={launchingRowIds.has(row.id)} showStatusOverlay isDownloadBusy={Boolean(downloadBusyRowId)} onDownload={() => downloadRow(row)} onOpen={setViewerImage} />
                <RowStatus mode={mode} row={row} task={tasksByRowId[row.id]} runtimeError={runtimeErrorsByRowId[row.id]} now={timerNow} launching={launchingRowIds.has(row.id)} hasReference={referenceCount > 0} missingPrompt={agentRowMissingPrompt(row)} pendingLabel={agentPendingLabel(row)} hideTransient />
                <div className="rf-action-fission-action-stack">
                  {hasAdditionalReferences ? (
                    <AdditionalReferenceToggle
                      checked={Boolean(row.useAdditionalReferences)}
                      disabled={launchingRowIds.has(row.id) || isRowRunning(tasksByRowId[row.id]) || agentBusy}
                      onCheckedChange={(checked) => setRowAdditionalReferences(row.id, checked)}
                    />
                  ) : null}
                  {mode === "agent" ? null : <ActionPreview row={row} onOpen={setViewerImage} />}
                </div>
                <ActionRowSummary mode={mode} row={row} projects={projects} tags={tags} generating={agentBusy} />
                <ButtonGroup className="rf-action-fission-row-actions nodrag">
                  <Button type="button" variant="ghost" size="icon-xs" disabled={(mode === "library" && Boolean(libraryFailure)) || (mode === "agent" && agentBusy)} aria-label={t(mode === "agent" ? "infiniteCanvas:actionFissionAgentPromptEdit" : "infiniteCanvas:actionFissionRowSettings")} title={t(mode === "agent" ? "infiniteCanvas:actionFissionAgentPromptEdit" : "infiniteCanvas:actionFissionRowSettings")} onClick={() => mode === "agent" ? setAgentPromptRowId(row.id) : actions.openActionFissionRowSettings(nodeId, row.id)}><Settings2 aria-hidden="true" /></Button>
                  {mode === "library" ? (
                    <Button type="button" variant="ghost" size="icon-xs" disabled={Boolean(libraryFailure) || !hasCategoryCandidates(categoryGroups)} aria-label={t("infiniteCanvas:actionFissionRefreshAction")} onClick={() => refreshRow(row.id)}><Shuffle aria-hidden="true" /></Button>
                  ) : null}
                  <Button type="button" variant="ghost" size="icon-xs" disabled={launchingRowIds.has(row.id) || (!isRowRunning(tasksByRowId[row.id]) && (imageRunBlockedByAgent || !actionFissionRowReady(row, mode) || referenceCount < 1))} aria-label={t(isRowRunning(tasksByRowId[row.id]) ? "infiniteCanvas:stopRun" : "infiniteCanvas:actionFissionRerunImage")} onClick={() => void (isRowRunning(tasksByRowId[row.id]) ? actions.stopActionFission(nodeId, row.id) : actions.runActionFission(nodeId, row.id))}>{isRowRunning(tasksByRowId[row.id]) ? <Square aria-hidden="true" fill="currentColor" /> : <Play aria-hidden="true" />}</Button>
                  <Button type="button" variant="ghost" size="icon-xs" disabled={state.rows.length <= 1 || agentBusy} aria-label={t("infiniteCanvas:actionFissionDeleteRow")} onClick={() => deleteRow(row.id)}><Trash2 aria-hidden="true" /></Button>
                </ButtonGroup>
              </article>
            ))}
          </div>
        )}
      </AppScrollArea>

      {!libraryUnavailable ? <ActionFissionParamPanel
        nodeId={nodeId}
        data={data}
        visible={paramPanelVisible}
        mode={mode}
        canRandomize={canRandomize}
        onRandomize={selectActions}
        canDownload={downloadableRows.length > 0 && !isLaunching}
        isDownloading={Boolean(downloadBusyRowId)}
        onDownload={downloadAllRows}
        canRun={runReadiness.canRun && !agentBusy}
        isRunning={isRunning}
        onRun={() => actions.runActionFission(nodeId)}
        onStop={() => actions.stopActionFission(nodeId)}
        agentRunning={agentBusy}
        agentError={agentError}
        promptGenerationBlocker={promptGenerationBlocker}
        onGeneratePrompts={(route) => void generateAgentPrompts(route)}
        onCancelPrompts={() => void cancelAgentPrompts()}
      /> : null}
      {!libraryUnavailable && viewerImage?.kind === "action" ? (
        <ImageViewer
          src={resolvedViewerImage?.src ?? viewerImage.src}
          alt={resolvedViewerImage?.alt ?? viewerImage.alt}
          ariaLabel={t("infiniteCanvas:viewLargeImage")}
          onClose={() => setViewerImage(null)}
          actions={viewerActions}
          navigation={viewerNavigation}
        />
      ) : !libraryUnavailable && viewerImage ? (
        <ReferenceComparisonImageViewer
          src={resolvedViewerImage?.src ?? viewerImage.src}
          alt={resolvedViewerImage?.alt ?? viewerImage.alt}
          ariaLabel={t("infiniteCanvas:viewLargeImage")}
          onClose={() => setViewerImage(null)}
          actions={viewerActions}
          activity={viewerActivity}
          references={viewerImage.kind === "result" ? viewerReferences.map((reference) => ({
            id: reference.nodeId,
            src: reference.imageUrl,
            thumbnailSrc: reference.previewUrl,
            alt: reference.title || t("infiniteCanvas:mainReference"),
          })) : []}
          referenceIndex={viewerReferenceIndex}
          onReferenceIndexChange={(index) => setViewerReferenceNodeId(viewerReferences[index]?.nodeId || "")}
          comparisonEnabled={viewerSettings.referenceComparisonEnabled}
          comparisonLabel={t("infiniteCanvas:referenceComparison")}
          onComparisonEnabledChange={(referenceComparisonEnabled) => updateSettings((current) => ({
            ...current,
            referenceComparisonViewer: { ...current.referenceComparisonViewer, referenceComparisonEnabled },
          }))}
          referencePanelPercent={viewerSettings.referencePanelPercent}
          onReferencePanelPercentChange={(referencePanelPercent) => updateSettings((current) => {
            const normalizedPercent = Math.max(20, Math.min(80, Math.round(referencePanelPercent)));
            if (normalizedPercent === current.referenceComparisonViewer.referencePanelPercent) return current;
            return {
              ...current,
              referenceComparisonViewer: { ...current.referenceComparisonViewer, referencePanelPercent: normalizedPercent },
            };
          })}
          navigation={viewerNavigation}
        />
      ) : null}
      <ActionFissionAgentPromptDialog
        open={Boolean(agentPromptRow)}
        row={agentPromptRow}
        onOpenChange={(open) => {
          if (!open) setAgentPromptRowId("");
        }}
        onSave={(prompt) => {
          if (agentPromptRowId) saveAgentPrompt(agentPromptRowId, prompt);
        }}
      />
      <AlertDialog
        open={Boolean(modeSwitchTarget)}
        onOpenChange={(open) => {
          if (!open) setModeSwitchTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("infiniteCanvas:actionFissionModeSwitchTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("infiniteCanvas:actionFissionModeSwitchDescription", {
                mode: t(modeSwitchTarget === "agent"
                  ? "infiniteCanvas:actionFissionModeAgent"
                  : "infiniteCanvas:actionFissionModeLibrary"),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common:actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmModeSwitch}>{t("common:actions.confirm")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </section>
    </>
  );
}
