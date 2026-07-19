import { CircleAlert, Download, Image as ImageIcon, LoaderCircle, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import type { GenerationTaskDto, GenerationTaskStatus } from "../../../app/appConfig";
import { NativeTabs, type NativeTabItem } from "../../../components/NativeTabs";
import { copyText } from "../../../components/ErrorCopyLine";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../../../components/ui/empty";
import { ScrollArea } from "../../../components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import {
  getModelDisplayName,
  loadApiSettings,
  type ApiProvider,
} from "../../settings/apiProviders";
import { ImageViewer } from "../../../lib/ImageViewer";
import { resolveLibraryImageUrl } from "../../../lib/libraryImageActions";
import { formatGenerationDuration } from "./generationStatus";
import {
  hydrateRecentGenerationTasks,
  isGenerationTaskActive,
  useGenerationTaskCache,
} from "./generationTaskCache";

type TaskFilter = "all" | "active" | "succeeded" | "exceptional";
type TaskTone = "queued" | "running" | "succeeded" | "failed" | "neutral";

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
  const tasks = useGenerationTaskCache(useShallow((state) => Object.values(state.tasksById)));
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [refreshing, setRefreshing] = useState(false);
  const [downloadingTaskId, setDownloadingTaskId] = useState("");
  const [loadError, setLoadError] = useState("");
  const [apiProviders, setApiProviders] = useState<ApiProvider[]>([]);
  const [viewer, setViewer] = useState<{ taskId: string; index: number } | null>(null);

  const sortedTasks = useMemo(
    () => [...tasks].sort((left, right) => right.updatedAt - left.updatedAt),
    [tasks],
  );
  const counts = useMemo(() => ({
    all: sortedTasks.length,
    active: sortedTasks.filter((task) => isGenerationTaskActive(task)).length,
    succeeded: sortedTasks.filter((task) => task.status === "succeeded").length,
    exceptional: sortedTasks.filter((task) => !isGenerationTaskActive(task) && task.status !== "succeeded").length,
  }), [sortedTasks]);
  const visibleTasks = useMemo(
    () => sortedTasks.filter((task) => taskMatchesFilter(task, filter)),
    [filter, sortedTasks],
  );
  const tabs = useMemo<NativeTabItem<TaskFilter>[]>(() => [
    { value: "all", label: t("infiniteCanvas:taskFilterAll"), meta: counts.all },
    { value: "active", label: t("infiniteCanvas:taskFilterActive"), meta: counts.active },
    { value: "succeeded", label: t("infiniteCanvas:taskFilterSucceeded"), meta: counts.succeeded },
    { value: "exceptional", label: t("infiniteCanvas:taskFilterExceptional"), meta: counts.exceptional },
  ], [counts, t]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    setLoadError("");
    return Promise.all([
      hydrateRecentGenerationTasks(100),
      loadApiSettings().catch(() => null),
    ])
      .then(([, settings]) => {
        if (settings) setApiProviders(settings.providers);
      })
      .catch((error) => setLoadError(error instanceof Error ? error.message : String(error)))
      .finally(() => setRefreshing(false));
  }, []);

  useEffect(() => {
    if (open) void refresh();
    else setViewer(null);
  }, [open, refresh]);

  const viewerTask = viewer ? tasks.find((task) => task.id === viewer.taskId) : undefined;
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

  const downloadTaskImage = useCallback(async (task: GenerationTaskDto) => {
    const image = task.result?.images[0];
    if (!image || downloadingTaskId) return;
    setDownloadingTaskId(task.id);
    try {
      const imageUrl = resolveLibraryImageUrl(image.assetUrl);
      if (window.easyTool?.saveResult) {
        const result = await window.easyTool.saveResult({
          url: imageUrl,
          dataUrl: imageUrl,
          defaultName: image.fileName || `generated-image-${task.id}.png`,
        });
        toast.success(result.filePath
          ? t("infiniteCanvas:downloadSaved", { path: result.filePath })
          : t("infiniteCanvas:downloadComplete"));
      } else {
        const link = document.createElement("a");
        link.href = imageUrl;
        link.download = image.fileName || `generated-image-${task.id}.png`;
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
        onChange={setFilter}
        ariaLabel={t("infiniteCanvas:taskFilter")}
        className="generation-task-center__tabs"
      />

      {loadError ? <p className="generation-task-center__error" role="alert">{loadError}</p> : null}

      <ScrollArea className="generation-task-center__scroll" viewportClassName="generation-task-center__viewport">
        {visibleTasks.length ? (
          <div className="generation-task-center__list">
            {visibleTasks.map((task) => {
              const active = isGenerationTaskActive(task);
              const image = task.result?.images[0];
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
                <article key={task.id} className="generation-task-center__item">
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
                  ) : image?.thumbUrl || image?.assetUrl ? (
                    <button
                      type="button"
                      className="generation-task-center__preview generation-task-center__preview--image"
                      aria-label={t("shared:imagePreview")}
                      onClick={() => setViewer({ taskId: task.id, index: 0 })}
                    >
                      <img src={resolveLibraryImageUrl(image.thumbUrl || image.assetUrl)} alt="" />
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
                        onClick={() => void downloadTaskImage(task)}
                      >
                        {downloadingTaskId === task.id ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
                      </Button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <Empty className="generation-task-center__empty">
            <EmptyHeader>
              <EmptyMedia variant="icon"><ImageIcon aria-hidden="true" /></EmptyMedia>
              <EmptyTitle>{t("infiniteCanvas:noGenerationTasks")}</EmptyTitle>
              <EmptyDescription>{t("infiniteCanvas:noGenerationTasksDescription")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </ScrollArea>
      {viewerImage ? (
        <ImageViewer
          src={resolveLibraryImageUrl(viewerImage.assetUrl)}
          alt={viewerImage.fileName || viewerTask?.model || t("infiniteCanvas:imageGenerationTask")}
          onClose={() => setViewer(null)}
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
