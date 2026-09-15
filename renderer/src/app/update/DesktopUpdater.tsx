import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Download, RefreshCw, X, type LucideIcon } from "lucide-react";
import type {
  ForartAppInfo,
  ForartUpdateCheckResult,
  ForartUpdateNotes,
  ForartUpdateProgress,
  ForartUpdateRelease,
  ForartUpdateRunResult,
} from "../appConfig";
import { AppScrollArea } from "../../components/AppScrollArea";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Progress } from "../../components/ui/progress";

export type DesktopUpdateStatus = "idle" | "checking" | "available" | "current" | "error" | "updating" | "updated";

export interface DesktopUpdateControl {
  status: DesktopUpdateStatus;
  buttonTitle: string;
  buttonLabel: string;
  icon: LucideIcon;
  open: () => void;
}

interface DesktopUpdaterResult {
  control: DesktopUpdateControl;
  dialog: ReactNode;
}

interface DesktopUpdaterOptions {
  enabled: boolean;
  language: string;
}

function formatUpdateDate(value: string) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}.${month}.${day}`;
}

function normalizeVersionLabel(value: string) {
  return String(value || "").trim().replace(/^v/i, "");
}

function displayVersion(value: string) {
  const normalized = normalizeVersionLabel(value);
  return normalized ? `v${normalized}` : "";
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
}

function updatePhaseKey(phase: string) {
  if (phase === "listing") return "app:updatePhaseListing";
  if (phase === "downloading") return "app:updatePhaseDownloading";
  if (phase === "scheduling") return "app:updatePhaseScheduling";
  if (phase === "scheduled") return "app:updatePhaseScheduled";
  return "app:updatePhaseUpdating";
}

export function useDesktopUpdater({ enabled, language }: DesktopUpdaterOptions): DesktopUpdaterResult {
  const { t } = useTranslation();
  const appInfoRef = useRef<ForartAppInfo | null>(null);
  const [appInfo, setAppInfo] = useState<ForartAppInfo | null>(null);
  const [status, setStatus] = useState<DesktopUpdateStatus>("idle");
  const [latestUpdatedAt, setLatestUpdatedAt] = useState("");
  const [message, setMessage] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [checkResult, setCheckResult] = useState<ForartUpdateCheckResult | null>(null);
  const [notes, setNotes] = useState<ForartUpdateNotes | null>(null);
  const [progress, setProgress] = useState<ForartUpdateProgress | null>(null);

  const checkForUpdates = useCallback(async (showCheckingState = true) => {
    if (!enabled) return;
    if (showCheckingState) {
      setStatus("checking");
      setMessage(t("app:updateCheckingMessage"));
    }

    const fallbackInfo = appInfoRef.current;
    const result: ForartUpdateCheckResult | undefined = await window.forartConfig?.checkUpdate().catch((error): ForartUpdateCheckResult => ({
      ok: false,
      currentRevision: fallbackInfo?.currentRevision || "",
      latestRevision: "",
      currentUpdatedAt: fallbackInfo?.currentUpdatedAt || "",
      latestUpdatedAt: "",
      updateAvailable: false,
      repoUrl: fallbackInfo?.repoUrl || "",
      error: String(error),
    }));
    if (!result?.ok) {
      setStatus(showCheckingState ? "error" : "idle");
      setMessage(showCheckingState ? (result?.error || t("app:updateCheckFailed")) : "");
      if (showCheckingState) setModalOpen(true);
      return;
    }

    setCheckResult(result);
    setNotes(result.updateNotes || null);
    setLatestUpdatedAt(result.updateAvailable ? (result.latestUpdatedAt || result.currentUpdatedAt) : (result.currentUpdatedAt || result.latestUpdatedAt));
    setAppInfo((current) => {
      if (!current) return current;
      const next = {
        ...current,
        repoUrl: result.repoUrl,
        currentRevision: result.currentRevision || current.currentRevision,
        currentUpdatedAt: result.currentUpdatedAt || current.currentUpdatedAt,
      };
      appInfoRef.current = next;
      return next;
    });
    if (result.updateAvailable) {
      setStatus("available");
      setMessage(t("app:updateAvailableMessage"));
    } else {
      setStatus("current");
      setMessage(t("app:updateCurrentMessage"));
    }
    if (showCheckingState) setModalOpen(true);
  }, [enabled, t]);

  useEffect(() => {
    if (!enabled) return;
    let canceled = false;

    async function loadAppInfo() {
      const info = await window.forartConfig?.appInfo().catch(() => null);
      if (canceled || !info) return;
      appInfoRef.current = info;
      setAppInfo(info);
      setLatestUpdatedAt(info.currentUpdatedAt);
      await checkForUpdates(false);
    }

    void loadAppInfo();
    return () => {
      canceled = true;
    };
  }, [checkForUpdates, enabled]);

  useEffect(() => {
    if (!enabled) return;
    return window.forartConfig?.onUpdateProgress?.((nextProgress) => {
      setProgress(nextProgress);
      const label = t(updatePhaseKey(nextProgress.phase));
      setMessage(nextProgress.phase === "downloading"
        ? `${label} ${Math.round(nextProgress.percent)}% - ${formatBytes(nextProgress.bytesPerSecond)}/s`
        : label);
    });
  }, [enabled, language, t]);

  async function confirmUpdate() {
    if (status === "checking" || status === "updating") return;
    if (status !== "available") {
      await checkForUpdates(true);
      return;
    }

    setStatus("updating");
    setProgress(null);
    setMessage(t("app:updateUpdatingMessage"));
    const result: ForartUpdateRunResult | undefined = await window.forartConfig?.runUpdate().catch((error): ForartUpdateRunResult => ({ ok: false, error: String(error) }));
    if (result?.ok) {
      setStatus("updated");
      setMessage(t("app:updateFinished"));
    } else {
      setStatus("error");
      setMessage(result?.error || t("app:updateFailed"));
    }
  }

  async function openUpdater() {
    if (status === "checking" || status === "updating") return;
    setModalOpen(true);
    if (!checkResult || status === "idle") await checkForUpdates(true);
  }

  const currentUpdateDateLabel = formatUpdateDate(appInfo?.currentUpdatedAt || latestUpdatedAt || "");
  const latestUpdateDateLabel = formatUpdateDate(latestUpdatedAt || appInfo?.currentUpdatedAt || "");
  const currentVersionLabel = normalizeVersionLabel(appInfo?.currentRevision || checkResult?.currentRevision || "");
  const latestVersionLabel = normalizeVersionLabel(checkResult?.latestRevision || notes?.version || "");
  const currentVersionDisplay = displayVersion(currentVersionLabel) || currentUpdateDateLabel;
  const latestVersionDisplay = displayVersion(latestVersionLabel) || latestUpdateDateLabel;
  const buttonLabel = status === "available"
    ? `${t("app:updateAvailableShort")} ${latestVersionDisplay}`
    : status === "checking"
      ? t("app:updateChecking")
      : status === "updating"
        ? t("app:updateUpdating")
        : status === "updated"
          ? t("app:updateRestart")
          : currentVersionDisplay;
  const buttonTitle = message || t("app:updateCheckingTitle");
  const UpdateIcon = status === "available" ? Download : RefreshCw;
  const modalTitle = status === "available"
    ? t("app:updateModalAvailableTitle")
    : status === "updated"
      ? t("app:updateModalCompleteTitle")
      : t("app:updateModalTitle");
  const releaseHistory: ForartUpdateRelease[] = checkResult?.recentReleases?.length
    ? checkResult.recentReleases
    : notes
      ? [{ version: notes.version || latestVersionLabel, updatedAt: notes.updatedAt || "", items: notes.items }]
      : [];
  const updateSummaryText = status === "available"
    ? t("app:updateAvailableSummary", { version: latestVersionDisplay })
    : status === "current"
      ? t("app:updateCurrentSummary", { version: currentVersionDisplay })
      : message || t("app:updateCheckFailed");
  const progressPercent = Math.max(0, Math.min(100, progress?.percent || 0));
  const progressVisible = Boolean(progress && (status === "updating" || status === "updated"));
  const progressPhase = progress ? t(updatePhaseKey(progress.phase)) : "";
  const progressSpeed = progress ? `${formatBytes(progress.bytesPerSecond)}/s` : "";
  const progressTotal = progress ? formatBytes(progress.downloadedBytes) : "0 B";
  const dialog = (
    <Dialog
      open={modalOpen}
      onOpenChange={(open) => {
        if (!open && status === "updating") return;
        setModalOpen(open);
      }}
    >
      <DialogContent className="grid h-[min(820px,80dvh)] max-h-[80dvh] w-[min(960px,calc(100vw-32px))] max-w-none grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden border-0 p-0 shadow-none">
        <DialogHeader className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 bg-background p-4 px-5 text-left">
          <div className="flex min-w-0 flex-col gap-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <DialogTitle id="forart-update-title" className="text-base leading-6">{modalTitle}</DialogTitle>
            </div>
            <DialogDescription className="mt-1 truncate text-xs text-muted-foreground">{t("app:updateModalSubtitle")}</DialogDescription>
          </div>
          <DialogClose asChild>
            <Button variant="ghost" size="icon" aria-label={t("app:updateClose")} disabled={status === "updating"}>
              <X aria-hidden="true" />
            </Button>
          </DialogClose>
        </DialogHeader>

        <AppScrollArea className="h-full min-h-0 bg-background" viewportClassName="px-5 py-4">
          <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-1 rounded-2xl border border-border bg-background px-4 py-3">
                  <span className="text-xs font-medium text-muted-foreground">{t("app:updateCurrentVersion")}</span>
                  <strong className="truncate text-base font-semibold text-foreground">{currentVersionDisplay}</strong>
                  <span className="text-xs text-muted-foreground">{currentUpdateDateLabel}</span>
                </div>
                <div className="flex min-w-0 flex-col gap-1 rounded-2xl border border-border bg-background px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-medium text-muted-foreground">{t("app:updateLatestVersion")}</span>
                    <Button
                      variant="ghost"
                      size="micro"
                      type="button"
                      disabled={status === "checking" || status === "updating"}
                      onClick={() => checkForUpdates(true)}
                    >
                      <RefreshCw className={status === "checking" ? "animate-spin" : undefined} aria-hidden="true" />
                      {status === "checking" ? t("app:updateChecking") : t("app:updateCheckAction")}
                    </Button>
                  </div>
                  <strong className="truncate text-base font-semibold text-foreground">{latestVersionDisplay}</strong>
                  <span className="text-xs text-muted-foreground">{latestUpdateDateLabel}</span>
                </div>
            </div>
            <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 rounded-2xl border border-border px-4 py-3 text-sm">
              <div className="flex min-w-0 items-center gap-3">
                <span className={`size-2.5 shrink-0 rounded-full ${status === "error" ? "bg-destructive" : status === "current" || status === "updated" ? "bg-emerald-500" : "bg-amber-500"}`} aria-hidden="true" />
                <strong className="min-w-0 text-sm text-foreground">{message || updateSummaryText}</strong>
              </div>
            </div>

            {progressVisible ? (
              <section className="grid gap-3 rounded-xl bg-card p-4 ring-1 ring-border/45" aria-label={t("app:updateProgressLabel")}>
                <div className="flex min-w-0 items-center justify-between gap-3 text-sm">
                  <strong className="min-w-0 text-foreground">{progressPhase}</strong>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{Math.round(progressPercent)}%</span>
                </div>
                <Progress value={progressPercent} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progressPercent)} />
                <div className="flex min-w-0 items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span className="min-w-0 truncate">{progress?.currentFile || t("app:updatePreparing")}</span>
                  <strong className="shrink-0 font-medium">{progressTotal} / {progressSpeed}</strong>
                </div>
                {progress?.fileCount ? (
                  <div className="flex min-w-0 items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span className="min-w-0 truncate">{t("app:updateFile")} {progress.fileIndex}/{progress.fileCount}</span>
                    <strong className="shrink-0 font-medium">{formatBytes(progress.fileBytes)}{progress.fileTotalBytes ? ` / ${formatBytes(progress.fileTotalBytes)}` : ""}</strong>
                  </div>
                ) : null}
              </section>
            ) : null}

            <div className="mt-2 min-h-0 space-y-5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="m-0 text-sm font-semibold">{t("app:updateNotes")}</h3>
                  <p className="m-0 mt-1 text-xs text-muted-foreground">{releaseHistory.length ? t("app:updateNotesCount", { count: releaseHistory.length }) : t("app:updateNoNotes")}</p>
                </div>
                {releaseHistory.length ? <Badge variant="outline">{t("app:updateNotesCount", { count: releaseHistory.length })}</Badge> : null}
              </div>
              {releaseHistory.length ? (
                <div className="mt-4 grid gap-5 border-l border-border/70 pl-4">
                  {releaseHistory.map((release) => (
                    <section key={`${release.version}-${release.updatedAt}`} className="grid gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="text-sm text-foreground">{displayVersion(release.version)}</strong>
                        {release.updatedAt ? <span className="text-xs text-muted-foreground">{formatUpdateDate(release.updatedAt)}</span> : null}
                        {normalizeVersionLabel(release.version) === latestVersionLabel ? <Badge variant="secondary">{t("app:updateLatestBadge")}</Badge> : null}
                        {normalizeVersionLabel(release.version) === currentVersionLabel ? <Badge variant="outline">{t("app:updateCurrentBadge")}</Badge> : null}
                      </div>
                      {release.items.length ? (
                        <ol className="grid gap-2 text-sm leading-6">
                          {release.items.map((item, index) => (
                            <li key={`${release.version}-${item.text}-${index}`} className="flex items-start gap-2">
                              <Badge variant={item.category === "fix" ? "outline" : item.category === "new" ? "secondary" : "outline"} className="mt-0.5 shrink-0">{t(`app:updateCategory${item.category === "new" ? "New" : item.category === "improvement" ? "Improvement" : "Fix"}`)}</Badge>
                              <span className="min-w-0 text-muted-foreground">{item.text}</span>
                            </li>
                          ))}
                        </ol>
                      ) : <p className="text-sm text-muted-foreground">{t("app:updateNoNotes")}</p>}
                    </section>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">{t("app:updateNoNotes")}</p>
              )}
            </div>
          </div>
        </AppScrollArea>

        <DialogFooter className="border-t bg-muted/30 p-5">
          <Button type="button" disabled={status !== "available"} onClick={confirmUpdate}>
            <Download data-icon="inline-start" aria-hidden="true" />
            {status === "updating" ? t("app:updateUpdating") : t("app:updateStart")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return {
    control: {
      status,
      buttonTitle,
      buttonLabel,
      icon: UpdateIcon,
      open: () => void openUpdater(),
    },
    dialog,
  };
}
