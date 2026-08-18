import { useCallback, useEffect, useMemo, useState } from "react";
import { NodeToolbar, Position, useEdges, useNodes, useReactFlow, useStore } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import type { GenerationTaskDto } from "../../../app/appConfig";
import {
  CircleAlert,
  Download,
  Grid2X2,
  Images,
  List,
  Play,
  Plus,
  Shuffle,
  Square,
  Settings2,
  Trash2,
} from "lucide-react";
import { AppScrollArea } from "../../../components/AppScrollArea";
import { ImageWithFallback } from "../../../components/ImageWithFallback";
import { RemoteDataState } from "../../../components/RemoteDataState";
import { Button } from "../../../components/ui/button";
import { ButtonGroup } from "../../../components/ui/button-group";
import { Switch } from "../../../components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "../../../components/ui/toggle-group";
import { ImageViewer } from "../../../lib/ImageViewer";
import { cn } from "../../../lib/utils";
import { resolveLibraryImageUrl } from "../../../lib/libraryImageActions";
import { canvasPreviewSourceUrl } from "../canvasThumbnails";
import type { ActionEntry, ActionProject, ActionTag } from "../../action-library/types";
import {
  addActionFissionRow,
  normalizeActionFissionState,
  removeActionFissionRow,
} from "../action-fission/actionFissionState";
import {
  actionFissionReferenceImages,
  getActionFissionRunReadiness,
  randomizeActionFissionRows,
} from "../action-fission/actionFissionRules";
import {
  actionFissionRowTaskId,
  MAX_ACTION_FISSION_ROWS,
  type ActionFissionCategoryGroup,
  type ActionFissionRow,
} from "../action-fission/actionFissionTypes";
import { useActionFissionLibraryData } from "../action-fission/useActionFissionLibraryData";
import { useNativeCanvasActions } from "../canvasActions";
import { formatGenerationDuration, generationStatusMessage } from "../generation/generationStatus";
import { isGenerationTaskActive, useGenerationTaskCache } from "../generation/generationTaskCache";
import type { NativeCanvasNodeData } from "../nativeCanvas";
import type { NativeCanvasEdge, NativeCanvasNode } from "../nativeCanvas";
import {
  collectActionFissionAdditionalPrompts,
  collectActionFissionAdditionalReferences,
  collectImageGeneratorReferences,
} from "../generation/imageGenerationInputs";
import { ActionFissionBatchActions, ActionFissionParamPanel } from "./ActionFissionParamPanel";
import { actionFissionLaunchingRowIds, useGenerationRuntimeStore } from "../generation/generationRuntimeStore";
import { ReferenceComparisonImageViewer } from "./ReferenceComparisonImageViewer";
import { useInfiniteCanvasSettings } from "../infiniteCanvasSettings";

interface ActionFissionNodeBodyProps {
  nodeId: string;
  data: NativeCanvasNodeData;
  paramPanelVisible: boolean;
}

type RowTone = "idle" | "queued" | "ready" | "running" | "completed" | "error";

function isRowQueued(task: GenerationTaskDto | undefined, launching = false) {
  return Boolean(
    launching
    || task?.status === "queued"
    || task?.status === "preparing"
    || task?.status === "submitting",
  );
}

function isRowGenerating(task: GenerationTaskDto | undefined) {
  return task?.status === "running" || task?.status === "result_processing";
}

function toneForRow(row: ActionFissionRow, task: GenerationTaskDto | undefined, launching = false, runtimeError = ""): RowTone {
  if (launching) return "queued";
  if (runtimeError || task?.status === "failed") return "error";
  if (isRowQueued(task)) return "queued";
  if (isRowGenerating(task)) return "running";
  if (
    (row.resultUrl || task?.status === "succeeded")
    && row.resultDownloadState !== "downloaded"
  ) return "completed";
  if (row.selectedActionId) return "ready";
  return "idle";
}

function isRowRunning(task: GenerationTaskDto | undefined) {
  return isGenerationTaskActive(task);
}

function statusDetails(tone: RowTone, t: ReturnType<typeof useTranslation>["t"]) {
  if (tone === "queued") return t("infiniteCanvas:actionFissionQueued");
  if (tone === "running") return t("infiniteCanvas:running");
  if (tone === "completed") return t("infiniteCanvas:actionFissionCompleted");
  if (tone === "error") return t("infiniteCanvas:generationFailed");
  if (tone === "ready") return t("infiniteCanvas:actionFissionReady");
  return t("infiniteCanvas:actionFissionPending");
}

function rowStatusMessage(task: GenerationTaskDto | undefined, tone: RowTone, t: ReturnType<typeof useTranslation>["t"], runtimeError = "") {
  if (tone === "error") return runtimeError || task?.errorMessage || t("infiniteCanvas:generationFailed");
  if (tone === "queued" || tone === "running") {
    return generationStatusMessage(task, t) || statusDetails(tone, t);
  }
  return statusDetails(tone, t);
}

function rowElapsedText(task: GenerationTaskDto | undefined, now: number) {
  const runningAt = Number(task?.runningAt || 0);
  return formatGenerationDuration(runningAt ? now - runningAt : 0);
}

function RowStatus({
  row,
  task,
  runtimeError,
  now,
  hasReference,
  launching,
  hideTransient = false,
}: {
  row: ActionFissionRow;
  task?: GenerationTaskDto;
  runtimeError?: string;
  now: number;
  hasReference: boolean;
  launching: boolean;
  hideTransient?: boolean;
}) {
  const { t } = useTranslation();
  const rowTone = toneForRow(row, task, launching, runtimeError);
  const tone = rowTone === "ready" && !hasReference ? "idle" : rowTone;
  if (hideTransient && (tone === "queued" || tone === "running" || tone === "error")) return null;
  const message = launching ? t("infiniteCanvas:generationPreparing") : rowStatusMessage(task, tone, t, runtimeError);
  const showElapsed = tone === "running";
  return (
    <span className="rf-action-fission-status" data-tone={tone} title={message}>
      <span>{message}</span>
      {showElapsed ? <time>{rowElapsedText(task, now)}</time> : null}
    </span>
  );
}

function RowGenerationOverlay({ row, task, runtimeError, now, launching }: { row: ActionFissionRow; task?: GenerationTaskDto; runtimeError?: string; now: number; launching: boolean }) {
  const { t } = useTranslation();
  const tone = toneForRow(row, task, launching, runtimeError);
  if (tone !== "queued" && tone !== "running" && tone !== "error") return null;
  const message = launching ? t("infiniteCanvas:generationPreparing") : rowStatusMessage(task, tone, t, runtimeError);
  return (
    <>
      {tone === "running" ? (
        <time
          className="rf-action-fission-generation-timer"
          aria-label={t("infiniteCanvas:generationElapsed", { time: rowElapsedText(task, now) })}
        >
          {rowElapsedText(task, now)}
        </time>
      ) : null}
      <div
        className={cn("rf-action-fission-generation-status", tone === "error" && "is-error")}
        role={tone === "error" ? "alert" : "status"}
        aria-live="polite"
      >
        {tone === "error" ? <CircleAlert aria-hidden="true" /> : null}
        <span>{message}</span>
      </div>
    </>
  );
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

function AdditionalReferenceToggle({
  checked,
  disabled,
  onCheckedChange,
}: {
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const { t } = useTranslation();
  const stopPropagation = (event: React.SyntheticEvent) => event.stopPropagation();
  return (
    <div
      className="rf-action-fission-additional-toggle nodrag nopan"
      onPointerDown={stopPropagation}
      onClick={stopPropagation}
      onDoubleClick={stopPropagation}
    >
      <span>{t("infiniteCanvas:additionalReference")}</span>
      <Switch
        size="sm"
        checked={checked}
        disabled={disabled}
        aria-label={t("infiniteCanvas:useAdditionalReference")}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
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
  const alt = t("infiniteCanvas:actionFissionActionPreview");
  return (
    <div className={cn("rf-action-fission-action-preview nodrag nopan", originalUrl && "is-viewable")}>
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
        {previewUrl ? <ImageWithFallback src={previewUrl} fallbackSrc={originalUrl} alt={alt} loading="lazy" decoding="async" draggable={false} /> : <Images aria-hidden="true" />}
      </div>
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
}) {
  const { t } = useTranslation();
  const taskImage = task?.result?.images[0];
  const originalUrl = row.resultUrl || taskImage?.assetUrl || "";
  const previewUrl = row.resultThumbUrl || taskImage?.thumbUrl || "";
  const resolvedOriginalUrl = originalUrl ? resolveLibraryImageUrl(originalUrl) : "";
  const previewSourceUrl = canvasPreviewSourceUrl(originalUrl, previewUrl);
  const resolvedPreviewUrl = previewSourceUrl ? resolveLibraryImageUrl(previewSourceUrl) : "";
  const alt = t("infiniteCanvas:actionFissionResultPreview");
  const canDownload = Boolean(resolvedOriginalUrl) && !launching && !isRowRunning(task) && toneForRow(row, task, false, runtimeError) !== "error";
  const isPendingDownload = canDownload && row.resultDownloadState !== "downloaded";
  const tone = toneForRow(row, task, launching, runtimeError);
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
            ? <ImageWithFallback src={resolvedPreviewUrl} fallbackSrc={resolvedOriginalUrl} alt={alt} loading="lazy" decoding="async" draggable={false} />
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
      {showStatusOverlay ? <RowGenerationOverlay row={row} task={task} runtimeError={runtimeError} now={now} launching={launching} /> : null}
    </div>
  );
}


function ActionRowSummary({ row, projects, tags }: { row: ActionFissionRow; projects: ActionProject[]; tags: ActionTag[] }) {
  const { t } = useTranslation();
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
      <ActionFissionBatchActions
        grouped={false}
        canRandomize={canRandomize}
        onRandomize={onRandomize}
        canDownload={canDownload}
        isDownloading={isDownloading}
        onDownload={onDownload}
      />
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
  const { projects, rowData, isLoading, failure: libraryFailure, retry: retryLibrary } = useActionFissionLibraryData(state);
  const viewerImages = useMemo(() => ({
    result: state.rows.flatMap((row) => {
      const url = row.resultUrl || tasksByRowId[row.id]?.result?.images[0]?.assetUrl || "";
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
    () => collectActionFissionAdditionalReferences(nodeId, canvasNodes, canvasEdges, t("infiniteCanvas:additionalReference")),
    [canvasEdges, canvasNodes, nodeId, t],
  );
  const additionalPrompts = useMemo(
    () => collectActionFissionAdditionalPrompts(nodeId, canvasNodes, canvasEdges, t("infiniteCanvas:additionalReference")),
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
  const viewerReference = viewerReferences[viewerReferenceIndex];

  const setState = useCallback((nextState: typeof state) => {
    actions.patchNodeData(nodeId, { actionFission: nextState });
  }, [actions, nodeId]);
  const deleteRow = useCallback((rowId: string) => {
    void actions.discardActionFissionRow(nodeId, rowId);
    setState(removeActionFissionRow(state, rowId));
  }, [actions, nodeId, setState, state]);
  const canSwitchAnyRow = rowData.some(({ categoryGroups }) => hasCategoryCandidates(categoryGroups));
  const referenceCount = primaryReferences.length;
  const hasAdditionalReferences = additionalReferences.length > 0 || additionalPrompts.length > 0;
  const runReadiness = getActionFissionRunReadiness(state.rows, referenceCount);
  const hasRunningRows = state.rows.some((row) => isRowGenerating(tasksByRowId[row.id]));
  const hasQueuedRows = state.rows.some((row) => isRowQueued(tasksByRowId[row.id]));
  const isRunning = state.rows.some((row) => isRowRunning(tasksByRowId[row.id]));
  const isGenerationActive = isLaunching || hasQueuedRows || hasRunningRows;
  const canRandomize = !libraryFailure && canSwitchAnyRow && !isGenerationActive;
  const completedRowCount = state.rows.filter((row) => {
    const task = tasksByRowId[row.id];
    if (launchingRowIds.has(row.id) || isRowQueued(task) || isRowGenerating(task)) return false;
    if (toneForRow(row, task, false, runtimeErrorsByRowId[row.id]) === "error") return false;
    return Boolean(row.resultUrl || task?.result?.images[0]?.assetUrl);
  }).length;
  const groupTone: RowTone = isLaunching
    ? "queued"
    : hasRunningRows
      ? "running"
      : hasQueuedRows
      ? "queued"
      : state.rows.some((row) => toneForRow(row, tasksByRowId[row.id], false, runtimeErrorsByRowId[row.id]) === "error")
        ? "error"
        : state.rows.length > 0 && state.rows.every((row) => toneForRow(row, tasksByRowId[row.id]) === "completed")
          ? "completed"
          : runReadiness.canRun
            ? "ready"
            : "idle";
  const groupStatus = isLaunching
    ? t("infiniteCanvas:generationPreparing")
    : groupTone === "running"
      ? t("infiniteCanvas:actionFissionRunningProgress", { completed: completedRowCount, total: state.rows.length })
      : statusDetails(groupTone, t);
  const downloadableRows = state.rows.filter((row) => {
    const task = tasksByRowId[row.id];
    const hasResult = Boolean(row.resultUrl || task?.result?.images[0]?.assetUrl);
    return hasResult && !launchingRowIds.has(row.id) && !isRowRunning(task)
      && toneForRow(row, task, false, runtimeErrorsByRowId[row.id]) !== "error";
  });
  const candidatesByRowId = useMemo(
    () => new Map(rowData.map((item) => [item.row.id, item.categoryGroups])),
    [rowData],
  );
  const selectActions = () => setState({
    ...state,
    rows: randomizeActionFissionRows(state.rows, candidatesByRowId),
  });
  const setRowAdditionalReferences = (rowId: string, useAdditionalReferences: boolean) => setState({
    ...state,
    rows: state.rows.map((row) => row.id === rowId ? { ...row, useAdditionalReferences } : row),
  });

  useEffect(() => {
    if (!data.actionFission) actions.patchNodeData(nodeId, { actionFission: state });
  }, [actions, data.actionFission, nodeId, state]);

  useEffect(() => {
    if (!isRunning) return;
    setTimerNow(Date.now());
    const interval = window.setInterval(() => setTimerNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [isRunning]);

  useEffect(() => {
    const pendingRows = rowData.filter(({ row, categoryGroups }) => (
      !row.selectedActionId && hasCategoryCandidates(categoryGroups)
    ));
    if (libraryFailure || !pendingRows.length) return;
    const pendingRowIds = new Set(pendingRows.map(({ row }) => row.id));
    setState({
      ...state,
      rows: randomizeActionFissionRows(state.rows, candidatesByRowId, { rowIds: pendingRowIds }),
    });
  }, [candidatesByRowId, libraryFailure, rowData, setState, state]);

  const refreshRow = (rowId: string) => {
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
              || !row.selectedActionId
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
        canRandomize={canRandomize}
        onRandomize={selectActions}
        canDownload={downloadableRows.length > 0}
        isDownloading={Boolean(downloadBusyRowId)}
        onDownload={downloadAllRows}
        canRun={!libraryFailure && runReadiness.canRun}
        isGenerationActive={isGenerationActive}
        onRun={() => actions.runActionFission(nodeId)}
        onStop={() => actions.stopActionFission(nodeId)}
      />
      <section
      className={cn("rf-action-fission", libraryFailure && "rf-action-fission--unavailable")}
      data-layout={state.layout}
      data-generating={isGenerationActive}
      data-has-additional-references={hasAdditionalReferences || undefined}
    >
      {!libraryFailure ? <header className="rf-action-fission-header">
        <span className="rf-action-fission-status rf-action-fission-group-status rf-action-fission-header-status" data-tone={groupTone}>
          {groupStatus}
        </span>
        <Button className="nodrag" type="button" variant="ghost" size="sm" disabled={state.rows.length >= MAX_ACTION_FISSION_ROWS} onClick={() => setState(addActionFissionRow(state))}>
          <Plus data-icon="inline-start" aria-hidden="true" />
          {t("infiniteCanvas:actionFissionAddRow")}
        </Button>
        <ToggleGroup
          className="rf-action-fission-layout-toggle nodrag"
          type="single"
          variant="outline"
          size="sm"
          value={state.layout}
          aria-label={t("infiniteCanvas:actionFissionLayout")}
          onValueChange={(layout) => {
            if (layout === "list" || layout === "grid") setState({ ...state, layout });
          }}
        >
          <ToggleGroupItem value="list" aria-label={t("infiniteCanvas:actionFissionListLayout")} title={t("infiniteCanvas:actionFissionListLayout")}>
            <List aria-hidden="true" />
          </ToggleGroupItem>
          <ToggleGroupItem value="grid" aria-label={t("infiniteCanvas:actionFissionGridLayout")} title={t("infiniteCanvas:actionFissionGridLayout")}>
            <Grid2X2 aria-hidden="true" />
          </ToggleGroupItem>
        </ToggleGroup>
      </header> : null}

      <AppScrollArea className="rf-action-fission-scroll nowheel" viewportClassName="rf-action-fission-scroll-viewport" scrollBarClassName="nodrag">
        {libraryFailure ? (
          <RemoteDataState
            failure={libraryFailure}
            scope="node"
            className="h-full min-h-0 border-0"
            onRetry={retryLibrary}
          />
        ) : isLoading ? (
          <div className="rf-action-fission-empty">{t("common:states.loading")}</div>
        ) : state.layout === "grid" ? (
          <div className="rf-action-fission-grid">
            {rowData.map(({ row, tags, categoryGroups }, index) => (
              <article key={row.id} className="rf-action-fission-grid-card" data-index={String(index + 1).padStart(2, "0")}>
                <ResultPreview row={row} task={tasksByRowId[row.id]} runtimeError={runtimeErrorsByRowId[row.id]} now={timerNow} launching={launchingRowIds.has(row.id)} showStatusOverlay isDownloadBusy={Boolean(downloadBusyRowId)} onDownload={() => downloadRow(row)} onOpen={setViewerImage} />
                <RowStatus row={row} task={tasksByRowId[row.id]} runtimeError={runtimeErrorsByRowId[row.id]} now={timerNow} launching={launchingRowIds.has(row.id)} hasReference={referenceCount > 0} hideTransient />
                <div className="rf-action-fission-action-stack">
                  {hasAdditionalReferences ? (
                    <AdditionalReferenceToggle
                      checked={Boolean(row.useAdditionalReferences)}
                      disabled={launchingRowIds.has(row.id) || isRowRunning(tasksByRowId[row.id])}
                      onCheckedChange={(checked) => setRowAdditionalReferences(row.id, checked)}
                    />
                  ) : null}
                  <ActionPreview row={row} onOpen={setViewerImage} />
                </div>
                <ActionRowSummary row={row} projects={projects} tags={tags} />
                <ButtonGroup className="rf-action-fission-row-actions nodrag">
                  <Button type="button" variant="ghost" size="icon-xs" disabled={Boolean(libraryFailure)} aria-label={t("infiniteCanvas:actionFissionRowSettings")} title={t("infiniteCanvas:actionFissionRowSettings")} onClick={() => actions.openActionFissionRowSettings(nodeId, row.id)}><Settings2 aria-hidden="true" /></Button>
                  <Button type="button" variant="ghost" size="icon-xs" disabled={Boolean(libraryFailure) || !hasCategoryCandidates(categoryGroups)} aria-label={t("infiniteCanvas:actionFissionRefreshAction")} onClick={() => refreshRow(row.id)}><Shuffle aria-hidden="true" /></Button>
                  <Button type="button" variant="ghost" size="icon-xs" disabled={launchingRowIds.has(row.id) || (!isRowRunning(tasksByRowId[row.id]) && (!row.selectedActionId || referenceCount < 1))} aria-label={t(isRowRunning(tasksByRowId[row.id]) ? "infiniteCanvas:stopRun" : "infiniteCanvas:actionFissionRerunImage")} onClick={() => void (isRowRunning(tasksByRowId[row.id]) ? actions.stopActionFission(nodeId, row.id) : actions.runActionFission(nodeId, row.id))}>{isRowRunning(tasksByRowId[row.id]) ? <Square aria-hidden="true" fill="currentColor" /> : <Play aria-hidden="true" />}</Button>
                  <Button type="button" variant="ghost" size="icon-xs" disabled={state.rows.length <= 1} aria-label={t("infiniteCanvas:actionFissionDeleteRow")} onClick={() => deleteRow(row.id)}><Trash2 aria-hidden="true" /></Button>
                </ButtonGroup>
              </article>
            ))}
          </div>
        ) : (
          <div className="rf-action-fission-list">
            {rowData.map(({ row, tags, categoryGroups }, index) => (
              <article key={row.id} className="rf-action-fission-list-card" data-index={String(index + 1).padStart(2, "0")}>
                <ResultPreview row={row} task={tasksByRowId[row.id]} runtimeError={runtimeErrorsByRowId[row.id]} now={timerNow} launching={launchingRowIds.has(row.id)} isDownloadBusy={Boolean(downloadBusyRowId)} onDownload={() => downloadRow(row)} onOpen={setViewerImage} />
                <ActionRowSummary row={row} projects={projects} tags={tags} />
                <RowStatus row={row} task={tasksByRowId[row.id]} runtimeError={runtimeErrorsByRowId[row.id]} now={timerNow} launching={launchingRowIds.has(row.id)} hasReference={referenceCount > 0} />
                {hasAdditionalReferences ? (
                  <AdditionalReferenceToggle
                    checked={Boolean(row.useAdditionalReferences)}
                    disabled={launchingRowIds.has(row.id) || isRowRunning(tasksByRowId[row.id])}
                    onCheckedChange={(checked) => setRowAdditionalReferences(row.id, checked)}
                  />
                ) : null}
                <ActionPreview row={row} onOpen={setViewerImage} />
                <ButtonGroup className="rf-action-fission-row-actions nodrag">
                  <Button type="button" variant="ghost" size="icon-sm" disabled={Boolean(libraryFailure)} aria-label={t("infiniteCanvas:actionFissionRowSettings")} title={t("infiniteCanvas:actionFissionRowSettings")} onClick={() => actions.openActionFissionRowSettings(nodeId, row.id)}><Settings2 aria-hidden="true" /></Button>
                  <Button type="button" variant="ghost" size="icon-sm" disabled={Boolean(libraryFailure) || !hasCategoryCandidates(categoryGroups)} aria-label={t("infiniteCanvas:actionFissionRefreshAction")} onClick={() => refreshRow(row.id)}><Shuffle aria-hidden="true" /></Button>
                  <Button type="button" variant="ghost" size="icon-sm" disabled={launchingRowIds.has(row.id) || (!isRowRunning(tasksByRowId[row.id]) && (!row.selectedActionId || referenceCount < 1))} aria-label={t(isRowRunning(tasksByRowId[row.id]) ? "infiniteCanvas:stopRun" : "infiniteCanvas:actionFissionRerunImage")} onClick={() => void (isRowRunning(tasksByRowId[row.id]) ? actions.stopActionFission(nodeId, row.id) : actions.runActionFission(nodeId, row.id))}>{isRowRunning(tasksByRowId[row.id]) ? <Square aria-hidden="true" fill="currentColor" /> : <Play aria-hidden="true" />}</Button>
                  <Button type="button" variant="ghost" size="icon-sm" disabled={state.rows.length <= 1} aria-label={t("infiniteCanvas:actionFissionDeleteRow")} onClick={() => deleteRow(row.id)}><Trash2 aria-hidden="true" /></Button>
                </ButtonGroup>
              </article>
            ))}
          </div>
        )}
      </AppScrollArea>

      {!libraryFailure ? <ActionFissionParamPanel
        nodeId={nodeId}
        data={data}
        visible={paramPanelVisible}
        canRandomize={canRandomize}
        onRandomize={selectActions}
        canDownload={downloadableRows.length > 0 && !isLaunching}
        isDownloading={Boolean(downloadBusyRowId)}
        onDownload={downloadAllRows}
        canRun={runReadiness.canRun}
        isRunning={isRunning}
        onRun={() => actions.runActionFission(nodeId)}
        onStop={() => actions.stopActionFission(nodeId)}
      /> : null}
      {!libraryFailure && viewerImage?.kind === "action" ? (
        <ImageViewer
          src={resolvedViewerImage?.src ?? viewerImage.src}
          alt={resolvedViewerImage?.alt ?? viewerImage.alt}
          ariaLabel={t("infiniteCanvas:viewLargeImage")}
          onClose={() => setViewerImage(null)}
          actions={viewerActions}
          navigation={viewerNavigation}
        />
      ) : !libraryFailure && viewerImage ? (
        <ReferenceComparisonImageViewer
          src={resolvedViewerImage?.src ?? viewerImage.src}
          alt={resolvedViewerImage?.alt ?? viewerImage.alt}
          ariaLabel={t("infiniteCanvas:viewLargeImage")}
          onClose={() => setViewerImage(null)}
          actions={viewerActions}
          activity={viewerActivity}
          reference={viewerImage.kind === "result" && viewerReference ? {
            src: viewerReference.imageUrl,
            alt: viewerReference.title || t("infiniteCanvas:mainReference"),
            navigation: {
              index: viewerReferenceIndex,
              total: viewerReferences.length,
              previousLabel: t("infiniteCanvas:previousReferenceImage"),
              nextLabel: t("infiniteCanvas:nextReferenceImage"),
              onPrevious: () => setViewerReferenceNodeId(viewerReferences[Math.max(0, viewerReferenceIndex - 1)]?.nodeId || ""),
              onNext: () => setViewerReferenceNodeId(viewerReferences[Math.min(viewerReferences.length - 1, viewerReferenceIndex + 1)]?.nodeId || ""),
            },
          } : undefined}
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
      </section>
    </>
  );
}
