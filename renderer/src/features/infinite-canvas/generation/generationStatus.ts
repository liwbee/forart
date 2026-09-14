export function formatGenerationDuration(totalMs: number) {
  const totalSeconds = Math.max(0, Math.floor(totalMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

import type { TFunction } from "i18next";

const STATUS_TRANSLATION_KEYS: Record<string, string> = {
  "generation.resultProcessing": "resultProcessing",
  "generation.queueWaiting": "generationQueueWaiting",
  "generation.requestPreparing": "generationRequestPreparing",
  "generation.referencesPreparing": "generationReferencesPreparing",
  "generation.referencesUploading": "generationReferencesUploading",
  "generation.remoteSetup": "generationRemoteSetup",
  "generation.requestSubmitting": "generationRequestSubmitting",
  "generation.remoteProcessing": "generationRemoteProcessing",
  // Compatibility for tasks persisted before the unified phase names.
  "image.referenceUploading": "imageReferenceUploading",
  "image.referencePreparing": "imageReferencePreparing",
  "image.waitingForResult": "imageWaitingForResult",
  "image.referencesPreparing": "imageReferencesPreparing",
  "image.textRequestPreparing": "imageTextRequestPreparing",
  "image.geminiGenerating": "imageGeminiGenerating",
  "image.editSubmitting": "imageEditSubmitting",
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

export type GenerationStatusTask = {
  message?: string;
  messageCode?: string;
  messageParams?: Record<string, string | number>;
  remoteMessage?: string;
};

export function generationStatusMessage(task: GenerationStatusTask | undefined, t: TFunction) {
  if (task?.messageCode) {
    const translationKey = STATUS_TRANSLATION_KEYS[task.messageCode];
    if (translationKey) {
      const params = task.messageParams || {};
      if (task.messageCode === "generation.requestSubmitting") {
        const operation = params.operation === "edit"
          ? t("infiniteCanvas:generationOperationEdit")
          : t("infiniteCanvas:generationOperationGenerate");
        return t(`infiniteCanvas:${translationKey}`, { ...params, operation });
      }
      return t(`infiniteCanvas:${translationKey}`, params);
    }
  }
  const message = task?.remoteMessage || task?.message;
  if (message === "result_processing") return t("infiniteCanvas:resultProcessing");
  if (/^(queued|pending|submitted|processing|running|in_progress|in-progress)$/i.test(String(message || "").trim())) {
    return t("infiniteCanvas:generationRemoteProcessing");
  }
  return message
    ? t("infiniteCanvas:remoteGenerationStatus", { status: message })
    : "";
}
