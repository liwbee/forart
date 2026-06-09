import type { ApiProvider } from "../../settings/apiProviders";

export interface ImageGenerationRequest {
  provider: ApiProvider;
  model: string;
  prompt: string;
  referenceImages?: string[];
  size?: string;
  resolution?: "1k" | "2k" | "4k";
  aspectRatio?: string;
  onStatus?: (message: string) => void;
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

function openAiImagesUrl(baseUrl: string) {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (/\/images\/generations$/i.test(normalized)) return normalized;
  for (const prefix of ["/api/v3", "/v1beta", "/v1", "/v2"]) {
    if (normalized.endsWith(prefix)) return joinApiPath(normalized, "images/generations");
  }
  return joinApiPath(normalized, "v1/images/generations");
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

function geminiGenerateContentUrl(baseUrl: string, model: string, apiKey: string) {
  const normalized = baseUrl.replace(/\/+$/, "");
  const modelPath = model.replace(/^models\//, "");
  const path = /\/models$/i.test(normalized)
    ? `${encodeURIComponent(modelPath)}:generateContent`
    : `models/${encodeURIComponent(modelPath)}:generateContent`;
  return joinApiPath(normalized, `${path}${apiKey ? `?key=${encodeURIComponent(apiKey)}` : ""}`);
}

function imageDataUrl(mimeType: string, data: string) {
  return `data:${mimeType || "image/png"};base64,${data}`;
}

function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && Boolean(value.trim())) || "";
}

function isLikelyBase64Image(value: string) {
  const text = value.trim();
  return text.length > 180 && /^[A-Za-z0-9+/=\r\n]+$/.test(text);
}

function isLikelyImageUrl(value: string) {
  return /^data:image\//i.test(value) || /^https?:\/\/\S+/i.test(value) || /^blob:/i.test(value);
}

function valueToImage(value: unknown, key = ""): ImageGenerationResult | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  if (/^data:image\//i.test(text) || /^https?:\/\/\S+/i.test(text) || /^blob:/i.test(text)) {
    return { url: text, fileName: "generated-image.png" };
  }
  if (/(b64|base64|image|artifact|data)/i.test(key) && isLikelyBase64Image(text)) {
    return { url: imageDataUrl("image/png", text), fileName: "generated-image.png" };
  }
  return null;
}

function findImageInPayload(payload: unknown): ImageGenerationResult | null {
  const queue: Array<{ value: unknown; key: string }> = [{ value: payload, key: "" }];
  const seen = new Set<unknown>();
  while (queue.length) {
    const { value, key } = queue.shift() as { value: unknown; key: string };
    const image = valueToImage(value, key);
    if (image) return image;
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((item) => queue.push({ value: item, key }));
      continue;
    }
    const record = value as Record<string, unknown>;
    const imageUrl = record.image_url;
    if (typeof imageUrl === "string" && isLikelyImageUrl(imageUrl)) return { url: imageUrl, fileName: "generated-image.png" };
    if (imageUrl && typeof imageUrl === "object") {
      const nestedUrl = firstString((imageUrl as Record<string, unknown>).url);
      if (nestedUrl && isLikelyImageUrl(nestedUrl)) return { url: nestedUrl, fileName: "generated-image.png" };
    }
    Object.entries(record).forEach(([childKey, childValue]) => queue.push({ value: childValue, key: childKey }));
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
  const taskId = firstString(record.task_id, record.taskId, record.id, record.request_id);
  if (taskId && /(pending|queued|running|processing|submitted|created)/i.test(status || "")) hints.push("this looks like an async task response");
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

function readOpenAiCompatibleImage(payload: unknown): ImageGenerationResult | null {
  return findImageInPayload(payload);
}

function readGeminiImage(payload: unknown): ImageGenerationResult | null {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
  const candidates = Array.isArray(record?.candidates) ? record.candidates : [];
  for (const candidate of candidates) {
    const candidateRecord = candidate && typeof candidate === "object" ? candidate as Record<string, unknown> : null;
    const content = candidateRecord?.content && typeof candidateRecord.content === "object" ? candidateRecord.content as Record<string, unknown> : null;
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    for (const part of parts) {
      const partRecord = part && typeof part === "object" ? part as Record<string, unknown> : null;
      const inlineData = partRecord?.inlineData || partRecord?.inline_data;
      const inlineRecord = inlineData && typeof inlineData === "object" ? inlineData as Record<string, unknown> : null;
      const data = firstString(inlineRecord?.data);
      if (data) return { url: imageDataUrl(firstString(inlineRecord?.mimeType, inlineRecord?.mime_type) || "image/png", data), fileName: "generated-image.png" };
    }
  }
  return null;
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

function splitDataUrl(value: string) {
  const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s);
  return match ? { mimeType: match[1], data: match[2] } : null;
}

async function imageUrlToDataUrl(url: string, signal?: AbortSignal) {
  if (/^data:image\//i.test(url)) return url;
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) return url;
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || url));
      reader.onerror = () => reject(reader.error || new Error("Failed to read reference image."));
      reader.readAsDataURL(blob);
    });
  } catch {
    return url;
  }
}

async function normalizeReferenceImages(referenceImages: string[] = [], signal?: AbortSignal) {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const image of referenceImages) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const value = String(image || "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(await imageUrlToDataUrl(value, signal));
    if (normalized.length >= 16) break;
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

async function pollImageTask(
  baseUrl: string,
  headers: Record<string, string>,
  taskId: string,
  initialPayload: unknown,
  onStatus?: (message: string) => void,
  signal?: AbortSignal,
) {
  let lastPayload = initialPayload;
  onStatus?.("等待生成结果...");
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
    if (status) onStatus?.(`生成中：${status}`);
    if (/(failure|failed|fail|error|errored|cancelled|canceled|rejected|expired|timeout)/i.test(status)) {
      throw new Error(readTaskError(payload) || `Image generation task failed (${summarizePayloadShape(payload)}).`);
    }
    await wait(4000, signal);
  }

  throw new Error(`Image generation task timed out (${summarizePayloadShape(lastPayload)}).`);
}

async function generateAsyncImage(
  baseUrl: string,
  headers: Record<string, string>,
  model: string,
  prompt: string,
  resolution: string,
  aspectRatio: string,
  referenceImages: string[],
  onStatus?: (message: string) => void,
  signal?: AbortSignal,
) {
  onStatus?.("提交生成任务...");
  const submitPayload = await requestJson(openAiImagesUrl(baseUrl), {
    method: "POST",
    headers,
    signal,
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
      size: aspectRatio,
      aspect_ratio: aspectRatio,
      resolution,
      ...(referenceImages.length ? { image_urls: referenceImages } : {}),
    }),
  });
  const directResult = findImageInPayload(submitPayload);
  if (directResult) return directResult;

  const taskId = readTaskId(submitPayload);
  if (!taskId) throw new Error(`The async image API did not return a task_id (${summarizePayloadShape(submitPayload)}).`);
  return pollImageTask(baseUrl, headers, taskId, submitPayload, onStatus, signal);
}

export async function generateImageWithProvider({ provider, model, prompt, referenceImages = [], size, resolution = "1k", aspectRatio = "1:1", onStatus, signal }: ImageGenerationRequest): Promise<ImageGenerationResult> {
  const baseUrl = provider.baseUrl.trim();
  if (!baseUrl) throw new Error("API provider base URL is empty.");
  if (!model.trim()) throw new Error("No image model selected.");
  const requestSize = size || openAiSizeFor(resolution, aspectRatio);
  onStatus?.("正在处理参考图...");
  const refs = await normalizeReferenceImages(referenceImages, signal);

  if (provider.protocol === "gemini") {
    onStatus?.("请求生成服务...");
    const apiKey = provider.apiKey.trim();
    const url = geminiGenerateContentUrl(baseUrl, model, apiKey);
    const payload = await requestJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(apiKey ? { "x-goog-api-key": apiKey } : {}) },
      signal,
      body: JSON.stringify({
        contents: [{ role: "user",
          parts: [
            { text: prompt },
            ...refs
              .map((ref) => splitDataUrl(ref))
              .filter(Boolean)
              .map((ref) => ({ inlineData: { mimeType: ref?.mimeType || "image/png", data: ref?.data || "" } })),
          ],
        }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio, imageSize: resolution.toUpperCase() } },
      }),
    });
    const result = readGeminiImage(payload);
    if (result) return result;
    throw new Error(`The Gemini response did not contain image data (${summarizePayloadShape(payload)}).`);
  }

  const headers = {
    "Content-Type": "application/json",
    ...(provider.apiKey.trim() ? { Authorization: `Bearer ${provider.apiKey.trim()}` } : {}),
  };
  if (provider.protocol === "async") {
    return generateAsyncImage(baseUrl, headers, model, prompt, resolution, aspectRatio, refs, onStatus, signal);
  }

  onStatus?.("请求生成服务...");
  const body = { model, prompt, n: 1, size: requestSize, resolution, aspect_ratio: aspectRatio, response_format: "b64_json", ...(refs.length ? { image_urls: refs } : {}) };
  let payload: unknown;
  try {
    payload = await requestJson(openAiImagesUrl(baseUrl), {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify(body),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/response_format|unknown parameter|unsupported/i.test(message)) throw error;
    payload = await requestJson(openAiImagesUrl(baseUrl), {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify({ model, prompt, n: 1, size: requestSize, ...(refs.length ? { image_urls: refs } : {}) }),
    }).catch((fallbackError) => {
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      if (!refs.length || !/image_urls|image|unknown parameter|unsupported/i.test(fallbackMessage)) throw fallbackError;
      return requestJson(openAiImagesUrl(baseUrl), {
        method: "POST",
        headers,
        signal,
        body: JSON.stringify({ model, prompt, n: 1, size: requestSize }),
      });
    });
  }
  const result = readOpenAiCompatibleImage(payload);
  if (result) return result;
  const taskId = readTaskId(payload);
  if (taskId) return pollImageTask(baseUrl, headers, taskId, payload, onStatus, signal);
  throw new Error(`The image API response did not contain an image (${summarizePayloadShape(payload)}).`);
}
