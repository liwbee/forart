import { useEffect, useMemo, useRef, useState } from "react";
import { useEdges, useNodes } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import {
  CircleAlert,
  Download,
  Grid2X2,
  Images,
  List,
  Play,
  Plus,
  Shuffle,
  Split,
  Square,
  Settings2,
  Trash2,
} from "lucide-react";
import { AppScrollArea } from "../../../components/AppScrollArea";
import { Button } from "../../../components/ui/button";
import { ButtonGroup } from "../../../components/ui/button-group";
import { Input } from "../../../components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "../../../components/ui/toggle-group";
import { cn } from "../../../lib/utils";
import { ImageViewer } from "../../../lib/ImageViewer";
import { resolveLibraryImageUrl } from "../../../lib/libraryImageActions";
import type { ActionProject, ActionTag } from "../../action-library/types";
import {
  addActionFissionRow,
  normalizeActionFissionState,
  removeActionFissionRow,
} from "../action-fission/actionFissionState";
import { getActionFissionRunReadiness, randomizeActionFissionRows } from "../action-fission/actionFissionRules";
import { MAX_ACTION_FISSION_ROWS, type ActionFissionRow } from "../action-fission/actionFissionTypes";
import { useActionFissionLibraryData } from "../action-fission/useActionFissionLibraryData";
import { useNativeCanvasActions } from "../canvasActions";
import { isNativeGenerationTaskActive } from "../generation/useNativeImageGeneration";
import { formatGenerationDuration, generationStatusMessage } from "../generation/generationStatus";
import type { NativeCanvasNodeData } from "../nativeCanvas";
import type { NativeCanvasEdge, NativeCanvasNode } from "../nativeCanvas";
import { collectImageGeneratorReferences } from "../generation/imageGenerationInputs";
import { ActionFissionParamPanel } from "./ActionFissionParamPanel";
import { actionFissionLaunchingRowIds, useGenerationRuntimeStore } from "../generation/generationRuntimeStore";

interface ActionFissionNodeBodyProps {
  nodeId: string;
  data: NativeCanvasNodeData;
  paramPanelVisible: boolean;
}

type RowTone = "idle" | "queued" | "ready" | "running" | "completed" | "error";

function isRowQueued(row: ActionFissionRow, launching = false) {
  return Boolean(
    launching
    || row.libtvQueued
    || Boolean(row.libtvTaskId && !row.libtvTask)
    || Boolean((row.generationTaskId || row.generationRemoteTaskId) && !row.generationTask)
    || row.libtvTask?.status === "queued"
    || row.libtvTask?.status === "preparing"
    || row.libtvTask?.status === "uploading"
    || row.generationTask?.status === "queued"
    || row.generationTask?.status === "submitting",
  );
}

function isRowGenerating(row: ActionFissionRow) {
  return Boolean(
    row.libtvRunning
    || row.libtvTask?.status === "running"
    || row.generationTask?.status === "running",
  );
}

function toneForRow(row: ActionFissionRow, launching = false): RowTone {
  if (launching) return "queued";
  if (row.error || row.generationTask?.status === "failed") return "error";
  if (isRowQueued(row)) return "queued";
  if (isRowGenerating(row)) return "running";
  if (
    (row.resultUrl || row.generationTask?.status === "succeeded")
    && row.resultDownloadState !== "downloaded"
  ) return "completed";
  if (row.selectedActionId) return "ready";
  return "idle";
}

function isRowRunning(row: ActionFissionRow) {
  return Boolean(
    row.libtvTaskId
    || row.generationTaskId
    || row.generationRemoteTaskId
    || row.libtvQueued
    || row.libtvRunning
    || isNativeGenerationTaskActive(row.generationTask),
  );
}

function statusDetails(tone: RowTone, t: ReturnType<typeof useTranslation>["t"]) {
  if (tone === "queued") return t("infiniteCanvas:actionFissionQueued");
  if (tone === "running") return t("infiniteCanvas:running");
  if (tone === "completed") return t("infiniteCanvas:actionFissionCompleted");
  if (tone === "error") return t("infiniteCanvas:generationFailed");
  if (tone === "ready") return t("infiniteCanvas:actionFissionReady");
  return t("infiniteCanvas:actionFissionPending");
}

function rowTask(row: ActionFissionRow) {
  if (row.libtvTask && (row.libtvTaskId || row.libtvQueued || row.libtvRunning)) return row.libtvTask;
  if (row.generationTask && (row.generationTaskId || row.generationRemoteTaskId || isNativeGenerationTaskActive(row.generationTask))) {
    return row.generationTask;
  }
  return row.libtvTask || row.generationTask;
}

function rowStatusMessage(row: ActionFissionRow, tone: RowTone, t: ReturnType<typeof useTranslation>["t"]) {
  if (tone === "error") return row.error || row.libtvTask?.error || row.generationTask?.error || t("infiniteCanvas:generationFailed");
  if (tone === "queued" || tone === "running") {
    return generationStatusMessage(rowTask(row), t) || statusDetails(tone, t);
  }
  return statusDetails(tone, t);
}

function rowElapsedText(row: ActionFissionRow, now: number) {
  const task = rowTask(row);
  const runningAt = Number(task?.runningAt || 0);
  return formatGenerationDuration(runningAt ? now - runningAt : 0);
}

function RowStatus({
  row,
  now,
  hasReference,
  launching,
  hideTransient = false,
}: {
  row: ActionFissionRow;
  now: number;
  hasReference: boolean;
  launching: boolean;
  hideTransient?: boolean;
}) {
  const { t } = useTranslation();
  const rowTone = toneForRow(row, launching);
  const tone = rowTone === "ready" && !hasReference ? "idle" : rowTone;
  if (hideTransient && (tone === "queued" || tone === "running" || tone === "error")) return null;
  const message = launching ? t("infiniteCanvas:generationPreparing") : rowStatusMessage(row, tone, t);
  const showElapsed = tone === "running";
  return (
    <span className="rf-action-fission-status" data-tone={tone} title={message}>
      <span>{message}</span>
      {showElapsed ? <time>{rowElapsedText(row, now)}</time> : null}
    </span>
  );
}

function RowGenerationOverlay({ row, now, launching }: { row: ActionFissionRow; now: number; launching: boolean }) {
  const { t } = useTranslation();
  const tone = toneForRow(row, launching);
  if (tone !== "queued" && tone !== "running" && tone !== "error") return null;
  const message = launching ? t("infiniteCanvas:generationPreparing") : rowStatusMessage(row, tone, t);
  return (
    <>
      {tone === "running" ? (
        <time
          className="rf-action-fission-generation-timer"
          aria-label={t("infiniteCanvas:generationElapsed", { time: rowElapsedText(row, now) })}
        >
          {rowElapsedText(row, now)}
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

function ActionPreview({ row, onOpen }: { row: ActionFissionRow; onOpen: (image: ViewerImage) => void }) {
  const { t } = useTranslation();
  const originalUrl = row.selectedActionAssetUrl ? resolveLibraryImageUrl(row.selectedActionAssetUrl) : "";
  const previewUrl = row.selectedActionThumbUrl
    ? resolveLibraryImageUrl(row.selectedActionThumbUrl)
    : originalUrl;
  const alt = t("infiniteCanvas:actionFissionActionPreview");
  return (
    <div
      className={cn("rf-action-fission-action-preview nodrag nopan", previewUrl && "is-viewable")}
      role={originalUrl ? "button" : undefined}
      tabIndex={originalUrl ? 0 : undefined}
      aria-label={originalUrl ? t("infiniteCanvas:viewLargeImage") : undefined}
      onKeyDown={originalUrl ? (event) => openPreviewFromKeyboard(event, () => onOpen({ id: row.id, kind: "action", src: originalUrl, alt })) : undefined}
      onClick={originalUrl ? (event) => {
        event.stopPropagation();
        onOpen({ id: row.id, kind: "action", src: originalUrl, alt });
      } : undefined}
    >
      {previewUrl ? <img src={previewUrl} alt={alt} draggable={false} /> : <Images aria-hidden="true" />}
    </div>
  );
}

function ResultPreview({
  row,
  isDownloadBusy,
  onDownload,
  onOpen,
  showStatusOverlay = false,
  launching,
  now,
}: {
  row: ActionFissionRow;
  isDownloadBusy: boolean;
  onDownload: () => void;
  onOpen: (image: ViewerImage) => void;
  showStatusOverlay?: boolean;
  launching: boolean;
  now: number;
}) {
  const { t } = useTranslation();
  const originalUrl = row.resultUrl || row.generationTask?.result?.localUrl || row.generationTask?.result?.url || "";
  const previewUrl = row.resultThumbUrl || originalUrl;
  const resolvedOriginalUrl = originalUrl ? resolveLibraryImageUrl(originalUrl) : "";
  const resolvedPreviewUrl = previewUrl ? resolveLibraryImageUrl(previewUrl) : "";
  const alt = t("infiniteCanvas:actionFissionResultPreview");
  const canDownload = Boolean(resolvedOriginalUrl) && !launching && !isRowRunning(row) && toneForRow(row) !== "error";
  const isPendingDownload = canDownload && row.resultDownloadState !== "downloaded";
  const tone = toneForRow(row, launching);
  const isActive = tone === "queued" || tone === "running";
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
          <img src={resolvedPreviewUrl} alt={alt} draggable={false} />
        </div>
      ) : <Images aria-hidden="true" />}
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
      {showStatusOverlay ? <RowGenerationOverlay row={row} now={now} launching={launching} /> : null}
    </div>
  );
}


function ActionRowSummary({ row, projects, tags }: { row: ActionFissionRow; projects: ActionProject[]; tags: ActionTag[] }) {
  const { t } = useTranslation();
  const projectName = projects.find((project) => project.id === row.actionProjectId)?.name || t("infiniteCanvas:actionFissionSelectProject");
  const tagNames = [
    ...tags.filter((tag) => row.includeActionTagIds.includes(tag.id)).map((tag) => tag.name),
    ...tags.filter((tag) => row.excludeActionTagIds.includes(tag.id)).map((tag) => t("infiniteCanvas:actionFissionExcludeTag", { name: tag.name })),
  ];
  return (
    <div className="rf-action-fission-row-summary">
      <strong title={projectName}>{projectName}</strong>
      <span title={tagNames.join(", ")}>{tagNames.length ? tagNames.join(" · ") : t("infiniteCanvas:actionFissionFilterAny")}</span>
      <small title={row.selectedActionName}>{row.selectedActionName || t("infiniteCanvas:actionFissionNoCandidates")}</small>
    </div>
  );
}

export function ActionFissionNodeBody({ nodeId, data, paramPanelVisible }: ActionFissionNodeBodyProps) {
  const { t } = useTranslation();
  const actions = useNativeCanvasActions();
  const [viewerImage, setViewerImage] = useState<ViewerImage | null>(null);
  const [downloadBusyRowId, setDownloadBusyRowId] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [timerNow, setTimerNow] = useState(Date.now());
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const cancelRenameRef = useRef(false);
  const canvasNodes = useNodes<NativeCanvasNode>();
  const canvasEdges = useEdges<NativeCanvasEdge>();
  const state = useMemo(() => normalizeActionFissionState(data.actionFission), [data.actionFission]);
  const launchingKeys = useGenerationRuntimeStore((runtime) => runtime.launchingKeys);
  const launchingRowIds = useMemo(() => actionFissionLaunchingRowIds(launchingKeys, nodeId), [launchingKeys, nodeId]);
  const isLaunching = launchingRowIds.size > 0;
  const { projects, rowData, isLoading } = useActionFissionLibraryData(state);
  const viewerImages = useMemo(() => ({
    result: state.rows.flatMap((row) => {
      const url = row.resultUrl || row.generationTask?.result?.localUrl || row.generationTask?.result?.url || "";
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
  }), [state.rows, t]);
  const setState = (nextState: typeof state) => actions.patchNodeData(nodeId, { actionFission: nextState });
  const canSwitchAnyRow = rowData.some(({ actions: candidates }) => candidates.length > 0);
  const referenceCount = collectImageGeneratorReferences(nodeId, canvasNodes, canvasEdges).length;
  const runReadiness = getActionFissionRunReadiness(state.rows, referenceCount);
  const hasRunningRows = state.rows.some(isRowGenerating);
  const hasQueuedRows = state.rows.some((row) => isRowQueued(row));
  const isRunning = state.rows.some((row) => (
    row.libtvTaskId
    || row.generationTaskId
    || row.generationRemoteTaskId
    || row.libtvQueued
    || row.libtvRunning
    || isNativeGenerationTaskActive(row.generationTask)
  ));
  const isGenerationActive = isLaunching || hasQueuedRows || hasRunningRows;
  const completedRowCount = state.rows.filter((row) => {
    if (launchingRowIds.has(row.id) || isRowQueued(row) || isRowGenerating(row)) return false;
    if (toneForRow(row) === "error") return false;
    return Boolean(row.resultUrl || row.generationTask?.result?.localUrl || row.generationTask?.result?.url);
  }).length;
  const groupTone: RowTone = isLaunching
    ? "queued"
    : hasRunningRows
      ? "running"
      : hasQueuedRows
      ? "queued"
      : state.rows.some((row) => toneForRow(row) === "error")
        ? "error"
        : state.rows.length > 0 && state.rows.every((row) => toneForRow(row) === "completed")
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
    const hasResult = Boolean(row.resultUrl || row.generationTask?.result?.localUrl || row.generationTask?.result?.url);
    return hasResult && !launchingRowIds.has(row.id) && !isRowRunning(row) && toneForRow(row) !== "error";
  });
  const defaultTitle = t("infiniteCanvas:actionFission");
  const title = String(data.label || "").trim() || defaultTitle;
  const candidatesByRowId = new Map(rowData.map((item) => [item.row.id, item.actions]));
  const selectActions = () => setState({
    ...state,
    rows: randomizeActionFissionRows(state.rows, candidatesByRowId),
  });

  useEffect(() => {
    if (!data.actionFission) actions.patchNodeData(nodeId, { actionFission: state });
  }, [actions, data.actionFission, nodeId, state]);

  useEffect(() => {
    if (!isRenaming) return;
    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, [isRenaming]);

  useEffect(() => {
    if (!isRenaming) setTitleDraft(title);
  }, [isRenaming, title]);

  useEffect(() => {
    if (!isRunning) return;
    setTimerNow(Date.now());
    const interval = window.setInterval(() => setTimerNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [isRunning]);

  useEffect(() => {
    const pendingRows = rowData.filter(({ row, actions: candidates }) => row.actionProjectId && !row.selectedActionId && candidates.length);
    if (!pendingRows.length) return;
    const pendingRowIds = new Set(pendingRows.map(({ row }) => row.id));
    setState({
      ...state,
      rows: randomizeActionFissionRows(state.rows, candidatesByRowId, { rowIds: pendingRowIds }),
    });
  }, [rowData, state.rows]);

  const refreshRow = (rowId: string) => {
    setState({
      ...state,
      rows: randomizeActionFissionRows(state.rows, candidatesByRowId, { rowIds: new Set([rowId]) }),
    });
  };

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

  const commitTitleRename = () => {
    if (cancelRenameRef.current) {
      cancelRenameRef.current = false;
      setTitleDraft(title);
      setIsRenaming(false);
      return;
    }
    const nextTitle = titleDraft.trim();
    setIsRenaming(false);
    if (nextTitle && nextTitle !== title) actions.patchNodeData(nodeId, { label: nextTitle });
    else setTitleDraft(title);
  };

  return (
    <section className="rf-action-fission" data-layout={state.layout} data-generating={isGenerationActive}>
      <header className="rf-action-fission-header">
        <div className="rf-action-fission-title">
          <Split aria-hidden="true" />
          {isRenaming ? (
            <Input
              ref={titleInputRef}
              className="rf-action-fission-title-input nodrag nopan nowheel"
              value={titleDraft}
              maxLength={80}
              aria-label={t("infiniteCanvas:renameActionFission")}
              onPointerDown={(event) => event.stopPropagation()}
              onChange={(event) => setTitleDraft(event.currentTarget.value)}
              onBlur={commitTitleRename}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelRenameRef.current = true;
                  event.currentTarget.blur();
                }
              }}
            />
          ) : (
            <span
              title={title}
              onDoubleClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                cancelRenameRef.current = false;
                setTitleDraft(title);
                setIsRenaming(true);
              }}
            >
              {title}
            </span>
          )}
          <span className="rf-action-fission-status rf-action-fission-group-status" data-tone={groupTone}>
            {groupStatus}
          </span>
        </div>
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
      </header>

      <AppScrollArea className="rf-action-fission-scroll nowheel" viewportClassName="rf-action-fission-scroll-viewport" scrollBarClassName="nodrag">
        {isLoading ? (
          <div className="rf-action-fission-empty">{t("common:states.loading")}</div>
        ) : state.layout === "grid" ? (
          <div className="rf-action-fission-grid">
            {rowData.map(({ row, tags, actions: candidates }, index) => (
              <article key={row.id} className="rf-action-fission-grid-card" data-index={String(index + 1).padStart(2, "0")}>
                <ResultPreview row={row} now={timerNow} launching={launchingRowIds.has(row.id)} showStatusOverlay isDownloadBusy={Boolean(downloadBusyRowId)} onDownload={() => downloadRow(row)} onOpen={setViewerImage} />
                <RowStatus row={row} now={timerNow} launching={launchingRowIds.has(row.id)} hasReference={referenceCount > 0} hideTransient />
                <ActionPreview row={row} onOpen={setViewerImage} />
                <ActionRowSummary row={row} projects={projects} tags={tags} />
                <ButtonGroup className="rf-action-fission-row-actions nodrag">
                  <Button type="button" variant="ghost" size="icon-xs" aria-label={t("infiniteCanvas:actionFissionRowSettings")} title={t("infiniteCanvas:actionFissionRowSettings")} onClick={() => actions.openActionFissionRowSettings(nodeId, row.id)}><Settings2 aria-hidden="true" /></Button>
                  <Button type="button" variant="ghost" size="icon-xs" disabled={!candidates.length} aria-label={t("infiniteCanvas:actionFissionRefreshAction")} onClick={() => refreshRow(row.id)}><Shuffle aria-hidden="true" /></Button>
                  <Button type="button" variant="ghost" size="icon-xs" disabled={launchingRowIds.has(row.id) || (!isRowRunning(row) && (!row.selectedActionId || referenceCount < 1))} aria-label={t(isRowRunning(row) ? "infiniteCanvas:stopRun" : "infiniteCanvas:actionFissionRerunImage")} onClick={() => void (isRowRunning(row) ? actions.stopActionFission(nodeId, row.id) : actions.runActionFission(nodeId, row.id))}>{isRowRunning(row) ? <Square aria-hidden="true" fill="currentColor" /> : <Play aria-hidden="true" />}</Button>
                  <Button type="button" variant="ghost" size="icon-xs" disabled={state.rows.length <= 1} aria-label={t("infiniteCanvas:actionFissionDeleteRow")} onClick={() => setState(removeActionFissionRow(state, row.id))}><Trash2 aria-hidden="true" /></Button>
                </ButtonGroup>
              </article>
            ))}
          </div>
        ) : (
          <div className="rf-action-fission-list">
            {rowData.map(({ row, tags, actions: candidates }, index) => (
              <article key={row.id} className="rf-action-fission-list-card" data-index={String(index + 1).padStart(2, "0")}>
                <ResultPreview row={row} now={timerNow} launching={launchingRowIds.has(row.id)} isDownloadBusy={Boolean(downloadBusyRowId)} onDownload={() => downloadRow(row)} onOpen={setViewerImage} />
                <ActionRowSummary row={row} projects={projects} tags={tags} />
                <RowStatus row={row} now={timerNow} launching={launchingRowIds.has(row.id)} hasReference={referenceCount > 0} />
                <ActionPreview row={row} onOpen={setViewerImage} />
                <ButtonGroup className="rf-action-fission-row-actions nodrag">
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={t("infiniteCanvas:actionFissionRowSettings")} title={t("infiniteCanvas:actionFissionRowSettings")} onClick={() => actions.openActionFissionRowSettings(nodeId, row.id)}><Settings2 aria-hidden="true" /></Button>
                  <Button type="button" variant="ghost" size="icon-sm" disabled={!candidates.length} aria-label={t("infiniteCanvas:actionFissionRefreshAction")} onClick={() => refreshRow(row.id)}><Shuffle aria-hidden="true" /></Button>
                  <Button type="button" variant="ghost" size="icon-sm" disabled={launchingRowIds.has(row.id) || (!isRowRunning(row) && (!row.selectedActionId || referenceCount < 1))} aria-label={t(isRowRunning(row) ? "infiniteCanvas:stopRun" : "infiniteCanvas:actionFissionRerunImage")} onClick={() => void (isRowRunning(row) ? actions.stopActionFission(nodeId, row.id) : actions.runActionFission(nodeId, row.id))}>{isRowRunning(row) ? <Square aria-hidden="true" fill="currentColor" /> : <Play aria-hidden="true" />}</Button>
                  <Button type="button" variant="ghost" size="icon-sm" disabled={state.rows.length <= 1} aria-label={t("infiniteCanvas:actionFissionDeleteRow")} onClick={() => setState(removeActionFissionRow(state, row.id))}><Trash2 aria-hidden="true" /></Button>
                </ButtonGroup>
              </article>
            ))}
          </div>
        )}
      </AppScrollArea>

      <ActionFissionParamPanel
        nodeId={nodeId}
        data={data}
        visible={paramPanelVisible}
        canRandomize={canSwitchAnyRow && !isLaunching}
        onRandomize={selectActions}
        canDownload={downloadableRows.length > 0 && !isLaunching}
        isDownloading={Boolean(downloadBusyRowId)}
        onDownload={downloadAllRows}
        canRun={runReadiness.canRun}
        isRunning={isRunning}
        onRun={() => actions.runActionFission(nodeId)}
        onStop={() => actions.stopActionFission(nodeId)}
      />
      {viewerImage ? (
        <ImageViewer
          src={viewerImage.src}
          alt={viewerImage.alt}
          ariaLabel={t("infiniteCanvas:viewLargeImage")}
          onClose={() => setViewerImage(null)}
          navigation={(() => {
            const images = viewerImages[viewerImage.kind];
            const index = images.findIndex((image) => image.id === viewerImage.id);
            if (images.length <= 1 || index < 0) return undefined;
            return {
              index,
              total: images.length,
              previousLabel: t("infiniteCanvas:previousImage"),
              nextLabel: t("infiniteCanvas:nextImage"),
              onPrevious: () => setViewerImage(images[(index - 1 + images.length) % images.length]),
              onNext: () => setViewerImage(images[(index + 1) % images.length]),
            };
          })()}
        />
      ) : null}
    </section>
  );
}
