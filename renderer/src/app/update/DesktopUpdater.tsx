import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Download, RefreshCw, X, type LucideIcon } from "lucide-react";
import type {
  ForartAppInfo,
  ForartUpdateCheckResult,
  ForartUpdateConnectivityResult,
  ForartUpdateNotes,
  ForartUpdateProgress,
  ForartUpdateRunResult,
} from "../appConfig";
import { AppScrollArea } from "../../components/AppScrollArea";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../components/ui/collapsible";
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
import { Separator } from "../../components/ui/separator";

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
  const [connectivity, setConnectivity] = useState<ForartUpdateConnectivityResult | null>(null);
  const [connectivityChecking, setConnectivityChecking] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

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

  async function runConnectivityCheck() {
    if (connectivityChecking) return;
    setConnectivityChecking(true);
    const result = await window.forartConfig?.updateConnectivity().catch((): ForartUpdateConnectivityResult => ({ ok: false, results: [] }));
    setConnectivity(result || { ok: false, results: [] });
    setConnectivityChecking(false);
  }

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
  const noteItems = notes?.items || [];
  const updateSummaryText = status === "available"
    ? t("app:updateAvailableSummary", { version: latestVersionDisplay })
    : status === "current"
      ? t("app:updateCurrentSummary", { version: currentVersionDisplay })
      : message || t("app:updateConnectivityWarn");
  const statusBadgeText = status === "error"
    ? t("app:updateErrorBadge")
    : status === "current" || status === "updated"
      ? t("app:updateOkBadge")
      : t("app:updateReadyBadge");
  const progressPercent = Math.max(0, Math.min(100, progress?.percent || 0));
  const progressVisible = Boolean(progress && (status === "updating" || status === "updated"));
  const progressPhase = progress ? t(updatePhaseKey(progress.phase)) : "";
  const progressSpeed = progress ? `${formatBytes(progress.bytesPerSecond)}/s` : "";
  const progressTotal = progress ? formatBytes(progress.downloadedBytes) : "0 B";
  const connectivityResults = connectivity?.results || [];
  const connectivityFailedCount = connectivityResults.filter((item) => !item.ok).length;
  const connectivitySummaryText = connectivityChecking
    ? t("app:updateConnectivityChecking")
    : connectivityResults.length
      ? connectivityFailedCount
        ? t("app:updateConnectivityIssueSummary", { failed: connectivityFailedCount, total: connectivityResults.length })
        : t("app:updateConnectivityOk")
      : t("app:updateConnectivityNotTested");
  const connectivityBadgeVariant = connectivityFailedCount ? "destructive" : connectivityResults.length ? "secondary" : "outline";

  const dialog = (
    <Dialog
      open={modalOpen}
      onOpenChange={(open) => {
        if (!open && status === "updating") return;
        setModalOpen(open);
      }}
    >
      <DialogContent className="grid max-h-[calc(100dvh-32px)] w-[min(980px,calc(100vw-32px))] max-w-none grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden border-0 p-0 shadow-none">
        <DialogHeader className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 border-b bg-muted/30 p-5 text-left">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <DialogTitle id="forart-update-title" className="text-xl leading-7">{modalTitle}</DialogTitle>
              <Badge variant={status === "error" ? "destructive" : status === "current" || status === "updated" ? "secondary" : "outline"}>{statusBadgeText}</Badge>
            </div>
            <DialogDescription className="sr-only">{updateSummaryText}</DialogDescription>
          </div>
          <DialogClose asChild>
            <Button variant="ghost" size="icon" aria-label={t("app:updateClose")} disabled={status === "updating"}>
              <X aria-hidden="true" />
            </Button>
          </DialogClose>
        </DialogHeader>

        <AppScrollArea className="h-full min-h-0 bg-background" viewportClassName="px-5 py-4">
          <div className="grid gap-4">
            <section className="min-w-0 rounded-xl bg-card p-4 ring-1 ring-border/45">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <h3 className="m-0 text-sm font-semibold">{t("app:updateConnectivity")}</h3>
                  <Badge variant={connectivityBadgeVariant}>{connectivitySummaryText}</Badge>
                </div>
                <Button variant="ghost" size="sm" type="button" disabled={connectivityChecking || status === "updating"} onClick={runConnectivityCheck}>
                  <RefreshCw data-icon="inline-start" className={connectivityChecking ? "animate-spin" : undefined} aria-hidden="true" />
                  <span>{connectivityChecking ? t("app:updateConnectivityChecking") : t("app:updateConnectivityTest")}</span>
                </Button>
              </div>
            </section>

            <section className="grid gap-3 rounded-xl bg-card p-4 ring-1 ring-border/45">
              <div className="flex min-w-0 items-center gap-3">
                <span className={`size-2.5 shrink-0 rounded-full ${status === "error" ? "bg-destructive" : status === "current" || status === "updated" ? "bg-emerald-500" : "bg-amber-500"}`} aria-hidden="true" />
                <strong className="min-w-0 text-sm text-foreground">{message || updateSummaryText}</strong>
              </div>
              <Separator />
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-1 p-3">
                  <span className="text-xs font-medium text-muted-foreground">{t("app:updateCurrentVersion")}</span>
                  <strong className="truncate text-base font-semibold text-foreground">{currentVersionDisplay}</strong>
                  <span className="text-xs text-muted-foreground">{currentUpdateDateLabel}</span>
                </div>
                <div className="flex min-w-0 flex-col gap-1 p-3">
                  <span className="text-xs font-medium text-muted-foreground">{t("app:updateLatestVersion")}</span>
                  <strong className="truncate text-base font-semibold text-foreground">{latestVersionDisplay}</strong>
                  <span className="text-xs text-muted-foreground">{latestUpdateDateLabel}</span>
                </div>
              </div>
            </section>

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

            <Collapsible open={notesOpen} onOpenChange={setNotesOpen}>
              <section className="rounded-xl bg-card p-4 ring-1 ring-border/45">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="m-0 text-sm font-semibold">{t("app:updateNotes")}</h3>
                    <p className="m-0 mt-1 text-xs text-muted-foreground">{noteItems.length ? t("app:updateNotesCount", { count: noteItems.length }) : t("app:updateNoNotes")}</p>
                  </div>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="icon" type="button" aria-label={notesOpen ? t("app:updateNotesCollapse") : t("app:updateNotesExpand")}>
                      <ChevronDown className={notesOpen ? "rotate-180 transition-transform" : "transition-transform"} aria-hidden="true" />
                    </Button>
                  </CollapsibleTrigger>
                </div>
                <CollapsibleContent>
                  {noteItems.length ? (
                    <ol className="mt-4 grid gap-2 pl-5 pr-2 text-sm leading-6 text-muted-foreground">
                      {noteItems.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
                    </ol>
                  ) : (
                    <p className="mt-4 text-sm text-muted-foreground">{t("app:updateNoNotes")}</p>
                  )}
                </CollapsibleContent>
              </section>
            </Collapsible>
          </div>
        </AppScrollArea>

        <DialogFooter className="border-t bg-muted/30 p-5">
          <Button variant="ghost" type="button" disabled={status === "checking" || status === "updating"} onClick={() => checkForUpdates(true)}>
            <RefreshCw data-icon="inline-start" className={status === "checking" ? "animate-spin" : undefined} aria-hidden="true" />
            {t("app:updateCheckAction")}
          </Button>
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
