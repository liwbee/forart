import type { ApiProvider } from "../../settings/apiProviders";
import { detectImageModelRuleId, getImageModelRule } from "../../settings/imageModelRules";

export interface ImageGenerationRequest {
  provider: ApiProvider;
  model: string;
  prompt: string;
  referenceImages?: string[];
  size?: string;
  resolution?: "1k" | "2k" | "4k";
  aspectRatio?: string;
  onStatus?: (message: string) => void;
  onTaskId?: (taskId: string) => void;
  signal?: AbortSignal;
}

export interface ImageGenerationResult {
  url: string;
  fileName: string;
  width?: number;
  height?: number;
}

function joinApiPath(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function imageGenerationsUrl(baseUrl: string) {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (/\/images\/generations$/i.test(normalized)) return normalized;
  for (const prefix of ["/api/v3", "/v1beta", "/v1", "/v2"]) {
    if (normalized.endsWith(prefix)) return joinApiPath(normalized, "images/generations");
  }
  return joinApiPath(normalized, "v1/images/generations");
}

function imageUploadsUrl(baseUrl: string) {
  const normalized = baseUrl
    .replace(/\/+$/, "")
    .replace(/\/images\/generations$/i, "")
    .replace(/\/images\/edits$/i, "");
  if (/\/v\d(?:beta)?$/i.test(normalized) || /\/api\/v\d$/i.test(normalized)) return joinApiPath(normalized, "uploads/images");
  return joinApiPath(normalized, "v1/uploads/images");
}

function taskUrlCandidates(baseUrl: string, taskId: string) {
  const normalized = baseUrl.replace(/\/+$/, "").replace(/\/images\/generations$/i, "");
  const taskPath = `tasks/${encodeURIComponent(taskId)}`;
  const imageTaskPath = `images/tasks/${encodeURIComponent(taskId)}`;
  const candidates = [
    joinApiPath(normalized, taskPath),
    joinApiPath(normalized, imageTaskPath),
  ];
  if (!/\/v\d(?:beta)?$/i.test(normalized) && !/\/api\/v\d$/i.test(normalized)) {
    candidates.push(joinApiPath(normalized, `v1/${taskPath}`), joinApiPath(normalized, `v1/${imageTaskPath}`));
  }
  return [...new Set(candidates)];
}

function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && Boolean(value.trim())) || "";
}

function isHttpImageUrl(value: string) {
  return /^https?:\/\/\S+/i.test(value.trim());
}

function valueToImage(value: unknown): ImageGenerationResult | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!isHttpImageUrl(text)) return null;
  return { url: text, fileName: "generated-image.png" };
}

function findImageInPayload(payload: unknown): ImageGenerationResult | null {
  const queue: unknown[] = [payload];
  const seen = new Set<unknown>();
  while (queue.length) {
    const value = queue.shift();
    const image = valueToImage(value);
    if (image) return image;
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((item) => queue.push(item));
      continue;
    }
    const record = value as Record<string, unknown>;
    const imageUrl = record.image_url;
    if (typeof imageUrl === "string" && isHttpImageUrl(imageUrl)) return { url: imageUrl, fileName: "generated-image.png" };
    if (imageUrl && typeof imageUrl === "object") {
      const nestedUrl = firstString((imageUrl as Record<string, unknown>).url);
      if (nestedUrl && isHttpImageUrl(nestedUrl)) return { url: nestedUrl, fileName: "generated-image.png" };
    }
    Object.values(record).forEach((childValue) => queue.push(childValue));
  }
  return null;
}

function summarizePayloadShape(payload: unknown) {
  if (!payload || typeof payload !== "object") return `response type ${typeof payload}`;
  const record = payload as Record<string, unknown>;
  const topKeys = Object.keys(record).slice(0, 10);
  const hints: string[] = [];
  const data = record.data;
  if (Array.isArray(data)) hints.push(`data[0] keys: ${Object.keys((data[0] || {}) as Record<string, unknown>).slice(0, 8).join(", ") || "none"}`);
  if (data && typeof data === "object" && !Array.isArray(data)) hints.push(`data keys: ${Object.keys(data as Record<string, unknown>).slice(0, 8).join(", ") || "none"}`);
  const status = firstString(record.status, record.state);
  if (status) hints.push(`status: ${status}`);
  return [`top-level keys: ${topKeys.join(", ") || "none"}`, ...hints].join("; ");
}

function readTaskId(payload: unknown) {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
  const data = Array.isArray(record?.data) ? record.data : record?.data;
  if (Array.isArray(data)) {
    const first = data.find((item) => item && typeof item === "object") as Record<string, unknown> | undefined;
    return firstString(first?.task_id, first?.taskId, first?.taskID, first?.task, first?.id, first?.request_id, first?.submit_id, first?.submitId);
  }
  const dataRecord = data && typeof data === "object" ? data as Record<string, unknown> : null;
  return firstString(
    dataRecord?.task_id,
    dataRecord?.taskId,
    dataRecord?.taskID,
    dataRecord?.task,
    dataRecord?.id,
    dataRecord?.request_id,
    dataRecord?.submit_id,
    dataRecord?.submitId,
    record?.task_id,
    record?.taskId,
    record?.taskID,
    record?.task,
    record?.id,
    record?.request_id,
    record?.submit_id,
    record?.submitId,
  );
}

function readTaskStatus(payload: unknown) {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
  const data = record?.data && typeof record.data === "object" ? record.data as Record<string, unknown> : null;
  return firstString(data?.status, data?.state, data?.task_status, data?.taskStatus, record?.status, record?.state, record?.task_status, record?.taskStatus);
}

function readTaskError(payload: unknown) {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
  const data = record?.data && typeof record.data === "object" ? record.data as Record<string, unknown> : null;
  const error = data?.error && typeof data.error === "object" ? data.error as Record<string, unknown> : null;
  const topError = record?.error && typeof record.error === "object" ? record.error as Record<string, unknown> : null;
  return firstString(error?.message, topError?.message, data?.error, record?.error, data?.message, record?.message);
}

async function readErrorMessage(response: Response) {
  const text = await response.text();
  if (!text) return `${response.status} ${response.statusText}`.trim();
  try {
    const payload = JSON.parse(text) as Record<string, unknown>;
    const error = payload.error && typeof payload.error === "object" ? payload.error as Record<string, unknown> : null;
    return firstString(error?.message, payload.message, payload.error, text);
  } catch {
    return text;
  }
}

async function requestJson(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(await readErrorMessage(response));
  return response.json() as Promise<unknown>;
}

async function requestFirstJson(urls: string[], init: RequestInit) {
  let lastError: unknown;
  for (const url of urls) {
    try {
      return await requestJson(url, init);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || "Request failed."));
}

async function wait(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      window.clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function looksLikeBase64Image(value: string) {
  const text = value.trim();
  return text.length > 180 && /^[A-Za-z0-9+/=\r\n]+$/.test(text);
}

function rejectBase64Image(value: string) {
  if (/^data:image\//i.test(value) || looksLikeBase64Image(value)) {
    throw new Error("Base64 image input is disabled. Please use an uploaded image file or an http(s) image URL.");
  }
}

function extensionFromContentType(contentType: string | null) {
  const subtype = String(contentType || "").split("/")[1] || "";
  if (!subtype) return "";
  return `.${subtype.replace("jpeg", "jpg").replace(/[^a-z0-9.+-]/gi, "")}`;
}

function fileNameFromImageSource(source: string, contentType: string | null, index: number) {
  try {
    const parsed = new URL(source);
    const name = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "");
    if (name && /\.[a-z0-9]+$/i.test(name)) return name;
  } catch {
    // Custom schemes such as blob: keep the generated filename.
  }
  return `reference-${index + 1}${extensionFromContentType(contentType) || ".png"}`;
}

async function readReferenceBlob(source: string, signal?: AbortSignal) {
  try {
    const response = await fetch(source, { signal });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());
    return {
      blob: await response.blob(),
      contentType: response.headers.get("content-type"),
      source,
    };
  } catch (error) {
    if (!isHttpImageUrl(source) || !window.easyTool?.saveCanvasAsset) throw error;
    const saved = await window.easyTool.saveCanvasAsset({ url: source, defaultName: "reference-image.png", kind: "input" });
    const response = await fetch(saved.url, { signal });
    if (!response.ok) throw new Error(`Failed to read downloaded reference image: ${response.status} ${response.statusText}`.trim());
    return {
      blob: await response.blob(),
      contentType: response.headers.get("content-type"),
      source: saved.url,
    };
  }
}

async function uploadReferenceImage(uploadUrl: string, headers: Record<string, string>, source: string, index: number, signal?: AbortSignal) {
  const { blob, contentType, source: readableSource } = await readReferenceBlob(source, signal);
  const mimeType = blob.type || contentType || "image/png";
  if (!/^image\//i.test(mimeType)) throw new Error(`Reference image must be an image file, received ${mimeType}.`);
  const file = new File([blob], fileNameFromImageSource(readableSource, mimeType, index), { type: mimeType });
  const formData = new FormData();
  formData.append("file", file);
  const payload = await requestJson(uploadUrl, {
    method: "POST",
    headers,
    signal,
    body: formData,
  });
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
  const data = record?.data && typeof record.data === "object" ? record.data as Record<string, unknown> : null;
  const uploadedUrl = firstString(record?.url, data?.url);
  if (!uploadedUrl || !isHttpImageUrl(uploadedUrl)) throw new Error(`Image upload did not return a usable URL (${summarizePayloadShape(payload)}).`);
  return uploadedUrl;
}

async function normalizeReferenceImages(
  baseUrl: string,
  uploadHeaders: Record<string, string>,
  referenceImages: string[] = [],
  onStatus?: (message: string) => void,
  signal?: AbortSignal,
) {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const image of referenceImages) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const value = String(image || "").trim();
    if (!value || seen.has(value)) continue;
    rejectBase64Image(value);
    if (!/^https?:\/\/|^blob:|^forart-asset:/i.test(value)) {
      throw new Error("Reference images must be http(s), blob, or Forart asset URLs. Base64 is not supported.");
    }
    seen.add(value);
    if (/^https:\/\/upload\.apimart\.ai\//i.test(value)) {
      normalized.push(value);
    } else {
      onStatus?.(`Uploading reference image ${normalized.length + 1}...`);
      normalized.push(await uploadReferenceImage(imageUploadsUrl(baseUrl), uploadHeaders, value, normalized.length, signal));
    }
  }
  return normalized;
}

function openAiSizeFor(resolution: string, aspectRatio: string) {
  const shortEdge = resolution === "4k" ? 4096 : resolution === "2k" ? 2048 : 1024;
  const [rawW, rawH] = aspectRatio.split(":").map(Number);
  const ratioW = rawW || 1;
  const ratioH = rawH || 1;
  if (ratioW === ratioH) return `${shortEdge}x${shortEdge}`;
  if (ratioW > ratioH) return `${shortEdge}x${Math.round(shortEdge * ratioH / ratioW)}`;
  return `${Math.round(shortEdge * ratioW / ratioH)}x${shortEdge}`;
}

function modelRuleFor(provider: ApiProvider, model: string) {
  return getImageModelRule(provider.modelRules.image[model] || detectImageModelRuleId(model));
}

async function pollImageTask(
  baseUrl: string,
  headers: Record<string, string>,
  taskId: string,
  initialPayload: unknown,
  onStatus?: (message: string) => void,
  signal?: AbortSignal,
) {
  let lastPayload = initialPayload;
  onStatus?.("Waiting for image result...");
  await wait(3000, signal);
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const payload = await requestFirstJson(taskUrlCandidates(baseUrl, taskId), {
      method: "GET",
      headers,
      signal,
    });
    lastPayload = payload;
    const result = findImageInPayload(payload);
    if (result) return result;
    const status = readTaskStatus(payload).toLowerCase();
    if (status) onStatus?.(`Generating: ${status}`);
    if (/(failure|failed|fail|error|errored|cancelled|canceled|rejected|expired|timeout)/i.test(status)) {
      throw new Error(readTaskError(payload) || `Image generation task failed (${summarizePayloadShape(payload)}).`);
    }
    await wait(4000, signal);
  }

  throw new Error(`Image generation task timed out (${summarizePayloadShape(lastPayload)}).`);
}

async function submitImageGeneration(
  baseUrl: string,
  headers: Record<string, string>,
  model: string,
  prompt: string,
  size: string,
  resolution: string,
  aspectRatio: string,
  referenceImages: string[],
  onStatus?: (message: string) => void,
  onTaskId?: (taskId: string) => void,
  signal?: AbortSignal,
) {
  onStatus?.("Submitting image generation...");
  const payload = await requestJson(imageGenerationsUrl(baseUrl), {
    method: "POST",
    headers,
    signal,
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
      size,
      aspect_ratio: aspectRatio,
      resolution,
      ...(referenceImages.length ? { image_urls: referenceImages } : {}),
    }),
  });
  const directResult = findImageInPayload(payload);
  if (directResult) return directResult;

  const taskId = readTaskId(payload);
  if (taskId) {
    onTaskId?.(taskId);
    return pollImageTask(baseUrl, headers, taskId, payload, onStatus, signal);
  }
  throw new Error(`The image API response did not contain an image or task_id (${summarizePayloadShape(payload)}).`);
}

export async function generateImageWithProvider({
  provider,
  model,
  prompt,
  referenceImages = [],
  size,
  resolution = "1k",
  aspectRatio = "1:1",
  onStatus,
  onTaskId,
  signal,
}: ImageGenerationRequest): Promise<ImageGenerationResult> {
  const baseUrl = provider.baseUrl.trim();
  const modelName = model.trim();
  if (!baseUrl) throw new Error("API provider base URL is empty.");
  if (!modelName) throw new Error("No image model selected.");
  if (provider.protocol === "gemini") {
    throw new Error("Gemini native image generation is disabled because it uses base64 image payloads. Use an OpenAI-compatible image endpoint instead.");
  }
  if (/edit/i.test(modelName)) {
    throw new Error("Image editing endpoints are disabled. Only text-to-image and image-to-image generation are supported.");
  }
  const rule = modelRuleFor(provider, modelName);
  const mode = referenceImages.length ? "image_to_image" : "text_to_image";
  if (referenceImages.length && !rule.supportsReferenceImages) throw new Error(`${modelName} does not support reference images with the selected rule (${rule.label}).`);
  if (!rule.modes.includes(mode)) throw new Error(`${modelName} does not support ${mode} with the selected rule (${rule.label}).`);
  if (referenceImages.length > rule.maxReferenceImages) throw new Error(`${rule.label} supports up to ${rule.maxReferenceImages} reference image(s).`);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(provider.apiKey.trim() ? { Authorization: `Bearer ${provider.apiKey.trim()}` } : {}),
  };
  const uploadHeaders: Record<string, string> = provider.apiKey.trim() ? { Authorization: `Bearer ${provider.apiKey.trim()}` } : {};
  onStatus?.(referenceImages.length ? "Preparing reference images..." : "Preparing text-to-image request...");
  const refs = await normalizeReferenceImages(baseUrl, uploadHeaders, referenceImages, onStatus, signal);
  const requestSize = rule.sizeMode === "ratio" || provider.protocol === "async" ? aspectRatio : size || openAiSizeFor(resolution, aspectRatio);
  const requestResolution = rule.resolutionCase === "upper" ? resolution.toUpperCase() : resolution.toLowerCase();

  return submitImageGeneration(baseUrl, headers, modelName, prompt, requestSize, requestResolution, aspectRatio, refs, onStatus, onTaskId, signal);
}

export async function recoverImageGenerationTask({
  provider,
  taskId,
  onStatus,
  signal,
}: {
  provider: ApiProvider;
  taskId: string;
  onStatus?: (message: string) => void;
  signal?: AbortSignal;
}): Promise<ImageGenerationResult> {
  const baseUrl = provider.baseUrl.trim();
  if (!baseUrl) throw new Error("API provider base URL is empty.");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(provider.apiKey.trim() ? { Authorization: `Bearer ${provider.apiKey.trim()}` } : {}),
  };
  return pollImageTask(baseUrl, headers, taskId, {}, onStatus, signal);
}
