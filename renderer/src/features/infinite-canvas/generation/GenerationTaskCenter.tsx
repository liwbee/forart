import { ChevronLeft, ChevronRight, CircleAlert, Download, Image as ImageIcon, LoaderCircle, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import type { GenerationTaskDto, GenerationTaskStatus } from "../../../app/appConfig";
import { NativeTabs, type NativeTabItem } from "../../../components/NativeTabs";
import { ImageWithFallback } from "../../../components/ImageWithFallback";
import { copyText } from "../../../components/ErrorCopyLine";
import { VirtualList } from "../../../components/VirtualList";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../../../components/ui/empty";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import {
  getModelDisplayName,
  loadApiSettings,
  type ApiProvider,
} from "../../settings/apiProviders";
import { ImageViewer } from "../../../lib/ImageViewer";
import { resolveLibraryImageUrl } from "../../../lib/libraryImageActions";
import { formatGenerationDuration } from "./generationStatus";
import { buildTaskDownloadName } from "./generationDownloadName";
import { generationTaskImageAt } from "./generationDownloadTarget";
import {
  isGenerationTaskActive,
  useGenerationTaskCache,
} from "./generationTaskCache";

type TaskFilter = "all" | "active" | "succeeded" | "exceptional";
type TaskTone = "queued" | "running" | "succeeded" | "failed" | "neutral";
const TASK_PAGE_SIZE = 30;
const TASK_ROW_HEIGHT = 69;
const EMPTY_TASK_COUNTS = { all: 0, active: 0, succeeded: 0, exceptional: 0 };

function taskTone(status: GenerationTaskStatus): TaskTone {
  if (status === "queued" || status === "preparing" || status === "submitting") return "queued";
  if (status === "running" || status === "result_processing") return "running";
  if (status === "succeeded") return "succeeded";
  if (status === "failed") return "failed";
  return "neutral";
}

function taskStatusKey(status: GenerationTaskStatus) {
  return `infiniteCanvas:taskStatus${status.split("_").map((part) => `${part[0]?.toUpperCase() || ""}${part.slice(1)}`).join("")}`;
}

function taskMatchesFilter(task: GenerationTaskDto, filter: TaskFilter) {
  if (filter === "active") return isGenerationTaskActive(task);
  if (filter === "succeeded") return task.status === "succeeded";
  if (filter === "exceptional") return !isGenerationTaskActive(task) && task.status !== "succeeded";
  return true;
}

interface GenerationTaskCenterProps {
  open: boolean;
  onClose: () => void;
}

export function GenerationTaskCenter({ open, onClose }: GenerationTaskCenterProps) {
  const { t, i18n } = useTranslation();
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [page, setPage] = useState(0);
  const [pageTasks, setPageTasks] = useState<GenerationTaskDto[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState(EMPTY_TASK_COUNTS);
  const [refreshing, setRefreshing] = useState(false);
  const [downloadingTaskId, setDownloadingTaskId] = useState("");
  const [loadError, setLoadError] = useState("");
  const [apiProviders, setApiProviders] = useState<ApiProvider[]>([]);
  const [viewer, setViewer] = useState<{ taskId: string; index: number } | null>(null);
  const requestSequenceRef = useRef(0);
  const taskCacheRevision = useGenerationTaskCache((state) => state.revision);
  const observedCacheRevisionRef = useRef(taskCacheRevision);

  const pageTaskIds = useMemo(() => pageTasks.map((task) => task.id), [pageTasks]);
  const livePageTasks = useGenerationTaskCache(useShallow((state) => (
    pageTaskIds.map((taskId) => state.tasksById[taskId])
  )));
  const visibleTasks = useMemo(
    () => pageTasks
      .map((task, index) => {
        const liveTask = livePageTasks[index];
        return liveTask && liveTask.version > task.version ? liveTask : task;
      })
      .filter((task) => taskMatchesFilter(task, filter)),
    [filter, livePageTasks, pageTasks],
  );
  const pageCount = Math.max(1, Math.ceil(total / TASK_PAGE_SIZE));
  const tabs = useMemo<NativeTabItem<TaskFilter>[]>(() => [
    { value: "all", label: t("infiniteCanvas:taskFilterAll"), meta: counts.all },
    { value: "active", label: t("infiniteCanvas:taskFilterActive"), meta: counts.active },
    { value: "succeeded", label: t("infiniteCanvas:taskFilterSucceeded"), meta: counts.succeeded },
    { value: "exceptional", label: t("infiniteCanvas:taskFilterExceptional"), meta: counts.exceptional },
  ], [counts, t]);

  const refresh = useCallback(async (showRefreshing = true) => {
    const taskApi = window.forartGenerationTasks;
    if (!taskApi?.listPage) return;
    const requestSequence = ++requestSequenceRef.current;
    if (showRefreshing) setRefreshing(true);
    setLoadError("");
    try {
      const result = await taskApi.listPage({
        limit: TASK_PAGE_SIZE,
        offset: page * TASK_PAGE_SIZE,
        filter,
      });
      if (requestSequence !== requestSequenceRef.current) return;
      const nextTotal = Math.max(0, Number(result.total || 0));
      const nextPageCount = Math.max(1, Math.ceil(nextTotal / TASK_PAGE_SIZE));
      if (page >= nextPageCount && page > 0) {
        setPage(nextPageCount - 1);
        return;
      }
      setPageTasks(result.tasks);
      setTotal(nextTotal);
      setCounts(result.counts);
    } catch (error) {
      if (requestSequence === requestSequenceRef.current) {
        setLoadError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (requestSequence === requestSequenceRef.current) setRefreshing(false);
    }
  }, [filter, page]);

  useEffect(() => {
    if (open) void refresh();
    else {
      requestSequenceRef.current += 1;
      setViewer(null);
    }
  }, [open, refresh]);

  useEffect(() => {
    if (!open) {
      observedCacheRevisionRef.current = taskCacheRevision;
      return;
    }
    if (observedCacheRevisionRef.current === taskCacheRevision) return;
    observedCacheRevisionRef.current = taskCacheRevision;
    const timeout = window.setTimeout(() => void refresh(false), 400);
    return () => window.clearTimeout(timeout);
  }, [open, refresh, taskCacheRevision]);

  useEffect(() => {
    if (!open) return;
    void loadApiSettings()
      .then((settings) => setApiProviders(settings.providers))
      .catch(() => undefined);
  }, [open]);

  useEffect(() => setViewer(null), [filter, page]);

  const viewerTask = viewer ? visibleTasks.find((task) => task.id === viewer.taskId) : undefined;
  const viewerImages = viewerTask?.result?.images || [];
  const viewerIndex = Math.min(viewer?.index || 0, Math.max(0, viewerImages.length - 1));
  const viewerImage = viewerImages[viewerIndex];

  const copyTaskError = useCallback(async (message: string) => {
    try {
      await copyText(message);
      toast.success(t("infiniteCanvas:textCopied"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [t]);

  const downloadTaskImage = useCallback(async (task: GenerationTaskDto, imageIndex = 0) => {
    const image = generationTaskImageAt(task, imageIndex);
    if (!image || downloadingTaskId) return;
    setDownloadingTaskId(task.id);
    try {
      const imageUrl = resolveLibraryImageUrl(image.assetUrl);
      if (window.easyTool?.saveResult) {
        const result = await window.easyTool.saveResult({
          url: imageUrl,
          dataUrl: imageUrl,
          defaultName: buildTaskDownloadName(task, image.fileName, image.assetUrl),
          convertToPng: true,
        });
        toast.success(result.filePath
          ? t("infiniteCanvas:downloadSaved", { path: result.filePath })
          : t("infiniteCanvas:downloadComplete"));
      } else {
        const link = document.createElement("a");
        link.href = imageUrl;
        link.download = buildTaskDownloadName(task, image.fileName, image.assetUrl);
        document.body.appendChild(link);
        link.click();
        link.remove();
        toast.success(t("infiniteCanvas:downloadComplete"));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setDownloadingTaskId("");
    }
  }, [downloadingTaskId, t]);

  return (
    <section className="generation-task-center" aria-label={t("infiniteCanvas:taskCenter")}>
      <header className="generation-task-center__header">
        <div>
          <h2>{t("infiniteCanvas:taskCenter")}</h2>
          <p>{t("infiniteCanvas:taskCenterSummary", { active: counts.active, total: counts.all })}</p>
        </div>
        <div className="generation-task-center__header-actions">
          <Button type="button" variant="ghost" size="icon-sm" disabled={refreshing} aria-label={t("infiniteCanvas:refreshTasks")} title={t("infiniteCanvas:refreshTasks")} onClick={() => void refresh()}>
            <RefreshCw className={refreshing ? "animate-spin" : undefined} aria-hidden="true" />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t("common:actions.close")} title={t("common:actions.close")} onClick={onClose}>
            <X aria-hidden="true" />
          </Button>
        </div>
      </header>

      <NativeTabs
        items={tabs}
        value={filter}
        onChange={(nextFilter) => {
          setPage(0);
          setFilter(nextFilter);
        }}
        ariaLabel={t("infiniteCanvas:taskFilter")}
        className="generation-task-center__tabs"
      />

      {loadError ? <p className="generation-task-center__error" role="alert">{loadError}</p> : null}

      <VirtualList
        items={visibleTasks}
        estimateSize={TASK_ROW_HEIGHT}
        getItemKey={(task) => task.id}
        renderItem={(task) => {
              const active = isGenerationTaskActive(task);
              const image = generationTaskImageAt(task, 0);
              const imageOriginalUrl = image?.assetUrl ? resolveLibraryImageUrl(image.assetUrl) : "";
              const imagePreviewUrl = image?.thumbUrl ? resolveLibraryImageUrl(image.thumbUrl) : imageOriginalUrl;
              const sourceLabel = t(task.target.kind === "actionFissionRow"
                ? "infiniteCanvas:taskKindActionFission"
                : "infiniteCanvas:taskKindImageGeneration");
              const platformLabel = task.executorKind === "libtv"
                ? t("infiniteCanvas:taskPlatformLibtv")
                : task.providerName || task.providerId || t("infiniteCanvas:taskPlatformApi");
              const provider = task.executorKind === "api"
                ? apiProviders.find((item) => item.id === task.providerId)
                : undefined;
              const modelLabel = task.executorKind === "api" && task.model
                ? getModelDisplayName(provider, "image", task.model)
                : task.model;
              const taskDetails = [
                platformLabel,
                modelLabel || "—",
                task.resolution || task.quality || "—",
                task.aspectRatio || "—",
              ].join(" · ");
              const timestamp = new Intl.DateTimeFormat(i18n.language, {
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              }).format(task.updatedAt);
              const duration = Number(task.durationMs || 0) > 0
                ? formatGenerationDuration(Number(task.durationMs))
                : "";
              return (
                <article className="generation-task-center__item">
                  {task.errorMessage ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          className="generation-task-center__preview generation-task-center__preview--error"
                          aria-label={t("common:actions.copyError")}
                          onClick={() => void copyTaskError(task.errorMessage!)}
                        >
                          <CircleAlert aria-hidden="true" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="left" className="max-w-80 whitespace-pre-wrap break-words">{task.errorMessage}</TooltipContent>
                    </Tooltip>
                  ) : image?.assetUrl ? (
                    <button
                      type="button"
                      className="generation-task-center__preview generation-task-center__preview--image"
                      aria-label={t("shared:imagePreview")}
                      onClick={() => setViewer({ taskId: task.id, index: 0 })}
                    >
                      {imagePreviewUrl ? (
                        <ImageWithFallback src={imagePreviewUrl} fallbackSrc={imageOriginalUrl} alt="" loading="lazy" decoding="async" />
                      ) : <ImageIcon aria-hidden="true" />}
                    </button>
                  ) : (
                    <div className="generation-task-center__preview">
                      {active ? (
                      <LoaderCircle className="animate-spin" aria-hidden="true" />
                      ) : (
                      <ImageIcon aria-hidden="true" />
                      )}
                    </div>
                  )}
                  <div className="generation-task-center__item-content">
                    <div className="generation-task-center__item-title-row">
                      <strong>{sourceLabel}</strong>
                    </div>
                    <p title={taskDetails}>{taskDetails}</p>
                    <small className="generation-task-center__meta">{timestamp}{duration ? ` · ${duration}` : ""}</small>
                  </div>
                  <div className="generation-task-center__item-actions">
                    <Badge variant="outline" className="generation-task-center__status" data-tone={taskTone(task.status)}>
                      {t(taskStatusKey(task.status))}
                    </Badge>
                    {task.status === "succeeded" && image ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={Boolean(downloadingTaskId)}
                        aria-label={t("infiniteCanvas:downloadImage")}
                        title={t("infiniteCanvas:downloadImage")}
                        onClick={() => void downloadTaskImage(task, 0)}
                      >
                        {downloadingTaskId === task.id ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
                      </Button>
                    ) : null}
                  </div>
                </article>
              );
        }}
        className="generation-task-center__scroll"
        viewportClassName="generation-task-center__viewport"
        itemMode="flow"
        overscan={4}
        spacerClassName="generation-task-center__virtual-spacer"
        trackClassName="generation-task-center__virtual-track"
        itemClassName="generation-task-center__virtual-item"
        empty={(
          <Empty className="generation-task-center__empty">
            <EmptyHeader>
              <EmptyMedia variant="icon"><ImageIcon aria-hidden="true" /></EmptyMedia>
              <EmptyTitle>{t("infiniteCanvas:noGenerationTasks")}</EmptyTitle>
              <EmptyDescription>{t("infiniteCanvas:noGenerationTasksDescription")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      />
      {total > 0 ? (
        <footer className="generation-task-center__pagination">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={refreshing || page === 0}
            aria-label={t("infiniteCanvas:taskCenterPreviousPage")}
            title={t("infiniteCanvas:taskCenterPreviousPage")}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <span>{t("infiniteCanvas:taskCenterPage", { page: page + 1, pages: pageCount })}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={refreshing || page + 1 >= pageCount}
            aria-label={t("infiniteCanvas:taskCenterNextPage")}
            title={t("infiniteCanvas:taskCenterNextPage")}
            onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </footer>
      ) : null}
      {viewerImage ? (
        <ImageViewer
          src={resolveLibraryImageUrl(viewerImage.assetUrl)}
          alt={viewerTask?.model || t("infiniteCanvas:imageGenerationTask")}
          onClose={() => setViewer(null)}
          actions={viewerTask ? [{
            id: "download",
            label: t("infiniteCanvas:downloadImage"),
            icon: "download",
            disabled: Boolean(downloadingTaskId),
            onClick: () => void downloadTaskImage(viewerTask, viewerIndex),
          }] : []}
          navigation={viewerImages.length > 1 ? {
            index: viewerIndex,
            total: viewerImages.length,
            previousLabel: t("infiniteCanvas:previousImage"),
            nextLabel: t("infiniteCanvas:nextImage"),
            onPrevious: () => setViewer((current) => current ? { ...current, index: Math.max(0, current.index - 1) } : null),
            onNext: () => setViewer((current) => current ? { ...current, index: Math.min(viewerImages.length - 1, current.index + 1) } : null),
          } : undefined}
        />
      ) : null}
    </section>
  );
}
