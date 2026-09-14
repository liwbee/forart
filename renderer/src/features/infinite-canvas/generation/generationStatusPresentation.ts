import type { TFunction } from "i18next";
import { formatGenerationDuration, generationStatusMessage, type GenerationStatusTask } from "./generationStatus";

export type GenerationStatusTone = "idle" | "ready" | "queued" | "running" | "completed" | "error";

export interface GenerationStatusPresentationInput {
  task?: GenerationStatusTask & { status?: string; errorMessage?: string; runningAt?: number | string; startedAt?: number | string };
  runtimeError?: string;
  persistedError?: string;
  launching?: boolean;
  queued?: boolean;
  running?: boolean;
  failed?: boolean;
  resultAvailable?: boolean;
  resultDownloaded?: boolean;
  ready?: boolean;
}

export interface GenerationStatusPresentation {
  tone: GenerationStatusTone;
  message: string;
  showTransient: boolean;
  showElapsed: boolean;
  elapsedText: string;
}

export function generationStatusTone(input: GenerationStatusPresentationInput): GenerationStatusTone {
  const { task, runtimeError, persistedError, launching, queued, running, failed, resultAvailable, resultDownloaded, ready } = input;
  if (launching) return "queued";
  if (failed || runtimeError || persistedError || task?.status === "failed") return "error";
  if (queued || task?.status === "queued" || task?.status === "preparing" || task?.status === "submitting") return "queued";
  if (running || task?.status === "running" || task?.status === "result_processing") return "running";
  if (resultAvailable && !resultDownloaded) return "completed";
  if (ready) return "ready";
  return "idle";
}

export function generationStatusPresentation(
  input: GenerationStatusPresentationInput,
  t: TFunction,
  now = Date.now(),
): GenerationStatusPresentation {
  const tone = generationStatusTone(input);
  const { task, runtimeError, persistedError, launching } = input;
  let message: string;
  if (tone === "error") message = runtimeError || persistedError || task?.errorMessage || t("infiniteCanvas:generationFailed");
  else if (tone === "queued" || tone === "running") {
    message = (launching ? "" : generationStatusMessage(task, t))
      || (tone === "queued" ? t("infiniteCanvas:actionFissionQueued") : t("infiniteCanvas:running"));
  } else if (tone === "completed") message = t("infiniteCanvas:actionFissionCompleted");
  else if (tone === "ready") message = t("infiniteCanvas:actionFissionReady");
  else message = t("infiniteCanvas:actionFissionPending");

  const startedAt = Number(task?.runningAt || task?.startedAt || 0);
  return {
    tone,
    message: launching ? t("infiniteCanvas:generationPreparing") : message,
    showTransient: tone === "queued" || tone === "running" || tone === "error",
    showElapsed: tone === "running",
    elapsedText: formatGenerationDuration(startedAt ? now - startedAt : 0),
  };
}
