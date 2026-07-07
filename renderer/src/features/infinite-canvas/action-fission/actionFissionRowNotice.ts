import type { TFunction } from "i18next";
import type { ApiProvider } from "../../settings/apiProviders";
import { formatGenerationDuration, getGenerationElapsedMs } from "../generation/generationTaskTime";
import type { CanvasGenerationTask } from "../types";
import type { ActionFissionRow } from "./actionFissionTypes";

export type ActionFissionRowNoticeTone = "queued" | "running" | "ready" | "completed" | "missing" | "error";

export type ActionFissionRowNotice =
  | { visible: false }
  | {
      visible: true;
      tone: ActionFissionRowNoticeTone;
      text: string;
    };

interface ResolveActionFissionRowNoticeOptions {
  row: ActionFissionRow;
  selectedProvider: ApiProvider | null;
  selectedModel: string;
  candidateCount: number;
  publicReferenceCount: number;
  publicReferenceLimit: number;
  activeTask?: CanvasGenerationTask | null;
  isActive?: boolean;
  now?: number;
  t: TFunction;
}

function fallback(defaultValue: string) {
  return { defaultValue };
}

function withTaskTime(prefix: string, task: CanvasGenerationTask | undefined, now?: number) {
  if (!task?.startedAt) return prefix;
  return `(${formatGenerationDuration(getGenerationElapsedMs(task, now))})${prefix}`;
}

export function resolveActionFissionRowNotice({
  row,
  selectedProvider,
  selectedModel,
  candidateCount,
  publicReferenceCount,
  publicReferenceLimit,
  activeTask,
  isActive,
  now,
  t,
}: ResolveActionFissionRowNoticeOptions): ActionFissionRowNotice {
  const task = activeTask || undefined;
  const taskStatus = task?.status;
  const interruptReason = task?.interruptReason;
  const rowActive = Boolean(isActive || row.libtvRunning);

  if (row.libtvQueued && !row.libtvRunning) {
    return {
      visible: true,
      tone: "queued",
      text: t("infiniteCanvas:actionFissionQueued", fallback("Waiting")),
    };
  }

  if (rowActive) {
    const label = t("infiniteCanvas:running", fallback("Generating"));
    const message = task?.message || "";
    const text = message ? `${label}: ${message}` : label;
    return {
      visible: true,
      tone: "running",
      text: withTaskTime(text, task, now),
    };
  }

  if (taskStatus === "interrupted" && (interruptReason === "user_stop" || interruptReason === "superseded")) {
    return { visible: false };
  }

  if (row.error || taskStatus === "failed") {
    return {
      visible: true,
      tone: "error",
      text: row.error || task?.error || t("infiniteCanvas:generationFailed", fallback("Generation failed")),
    };
  }

  if (taskStatus === "interrupted") {
    return {
      visible: true,
      tone: "error",
      text: task?.error || t("infiniteCanvas:generationInterruptedUnexpected", fallback("Task interrupted unexpectedly")),
    };
  }

  if (!selectedProvider || !selectedModel) {
    return {
      visible: true,
      tone: "error",
      text: selectedProvider?.id === "libtv-api" ? t("infiniteCanvas:libtvModelRequired") : t("infiniteCanvas:noImageApiConfigured"),
    };
  }

  if (publicReferenceCount > publicReferenceLimit) {
    return {
      visible: true,
      tone: "error",
      text: t("infiniteCanvas:actionFissionTooManyPublicReferences", { count: publicReferenceLimit }),
    };
  }

  if (row.resultUrl && row.resultDownloadState === "pending") {
    return {
      visible: true,
      tone: "completed",
      text: withTaskTime(t("infiniteCanvas:actionFissionCompleted", fallback("Completed")), task, now),
    };
  }

  if (!publicReferenceCount) {
    return {
      visible: true,
      tone: "missing",
      text: t("infiniteCanvas:actionFissionConnectReferenceFirst", fallback("Connect a reference image first")),
    };
  }

  if (!row.actionProjectId) {
    return {
      visible: true,
      tone: "missing",
      text: t("infiniteCanvas:actionFissionSelectProjectOrTagsFirst", fallback("Select a project or tags first")),
    };
  }

  if (!row.selectedActionPrompt && candidateCount <= 0) {
    return {
      visible: true,
      tone: "error",
      text: t("infiniteCanvas:actionFissionNoCandidates"),
    };
  }

  if (!row.selectedActionPrompt) {
    return {
      visible: true,
      tone: "missing",
      text: t("infiniteCanvas:actionFissionSelectActionFirst", fallback("Select an action first")),
    };
  }

  return {
    visible: true,
    tone: "ready",
    text: t("infiniteCanvas:actionFissionReady", fallback("Ready")),
  };
}
