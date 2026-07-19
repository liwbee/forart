export function formatGenerationDuration(totalMs: number) {
  const totalSeconds = Math.max(0, Math.floor(totalMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

import type { TFunction } from "i18next";

const STATUS_TRANSLATION_KEYS: Record<string, string> = {
  "generation.resultProcessing": "resultProcessing",
  "image.referenceUploading": "imageReferenceUploading",
  "image.referencePreparing": "imageReferencePreparing",
  "image.waitingForResult": "imageWaitingForResult",
  "image.referencesPreparing": "imageReferencesPreparing",
  "image.textRequestPreparing": "imageTextRequestPreparing",
  "image.geminiSubmitting": "imageGeminiSubmitting",
  "image.editSubmitting": "imageEditSubmitting",
  "image.jsonReferenceRetrying": "imageJsonReferenceRetrying",
  "image.generationSubmitting": "imageGenerationSubmitting",
  "libtv.workspacePreparing": "libtvWorkspacePreparing",
  "libtv.referencesUploading": "libtvReferencesUploading",
  "libtv.nodeCreating": "libtvNodeCreating",
  "libtv.referenceUploading": "libtvReferenceUploading",
  "libtv.generating": "libtvGenerating",
  "libtv.queueWaiting": "libtvQueueWaiting",
  "libtv.generationPreparing": "libtvGenerationPreparing",
  "libtv.startBusyRetrying": "libtvStartBusyRetrying",
  "libtv.startRetrying": "libtvStartRetrying",
  "libtv.recovering": "libtvRecovering",
};

type GenerationStatusTask = {
  message?: string;
  messageCode?: string;
  messageParams?: Record<string, string | number>;
  remoteMessage?: string;
};

export function generationStatusMessage(task: GenerationStatusTask | undefined, t: TFunction) {
  if (task?.messageCode) {
    const translationKey = STATUS_TRANSLATION_KEYS[task.messageCode];
    if (translationKey) return t(`infiniteCanvas:${translationKey}`, task.messageParams || {});
  }
  const message = task?.remoteMessage || task?.message;
  if (message === "result_processing") return t("infiniteCanvas:resultProcessing");
  return message
    ? t("infiniteCanvas:remoteGenerationStatus", { status: message })
    : "";
}
