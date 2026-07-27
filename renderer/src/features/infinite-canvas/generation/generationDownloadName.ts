import type { GenerationTaskDto } from "../../../app/appConfig";

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function formatGenerationDownloadTimestamp(date = new Date()) {
  return `${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function fileExtension(value: string | undefined) {
  const cleanValue = String(value || "").split(/[?#]/, 1)[0];
  const match = cleanValue.match(/(\.[a-z0-9]{2,5})$/i);
  return match?.[1].toLowerCase() || ".png";
}

function sanitizePart(value: string | undefined, fallback: string) {
  const sanitized = String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return sanitized || fallback;
}

export function buildGenerationDownloadName({
  platform,
  model,
  sourceFileName,
  sourceUrl,
  date,
}: {
  platform?: string;
  model?: string;
  sourceFileName?: string;
  sourceUrl?: string;
  date?: Date;
}) {
  return `${sanitizePart(platform, "Forart")}-${sanitizePart(model, "Local")}-${formatGenerationDownloadTimestamp(date)}${fileExtension(sourceFileName || sourceUrl)}`;
}

export function buildTaskDownloadName(task: GenerationTaskDto, sourceFileName?: string, sourceUrl?: string) {
  return buildGenerationDownloadName({
    platform: task.executorKind === "libtv" ? "LibTV" : task.providerName || task.providerId,
    model: task.model,
    sourceFileName,
    sourceUrl,
  });
}
