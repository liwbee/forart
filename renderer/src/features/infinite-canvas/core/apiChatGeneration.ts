import type { ApiProvider } from "../../settings/apiProviders";

export interface ChatGenerationRequest {
  provider: ApiProvider;
  model: string;
  prompt: string;
  referenceImages?: string[];
  signal?: AbortSignal;
}

function joinApiPath(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function openAiChatUrl(baseUrl: string) {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(normalized)) return normalized;
  for (const prefix of ["/api/v3", "/v1beta", "/v1", "/v2"]) {
    if (normalized.endsWith(prefix)) return joinApiPath(normalized, "chat/completions");
  }
  return joinApiPath(normalized, "v1/chat/completions");
}

function geminiGenerateContentUrl(baseUrl: string, model: string, apiKey: string) {
  const normalized = baseUrl.replace(/\/+$/, "");
  const modelPath = model.replace(/^models\//, "");
  const path = /\/models$/i.test(normalized)
    ? `${encodeURIComponent(modelPath)}:generateContent`
    : `models/${encodeURIComponent(modelPath)}:generateContent`;
  return joinApiPath(normalized, `${path}${apiKey ? `?key=${encodeURIComponent(apiKey)}` : ""}`);
}

function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && Boolean(value.trim())) || "";
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

function readOpenAiText(payload: unknown) {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
  const choices = Array.isArray(record?.choices) ? record.choices : [];
  for (const choice of choices) {
    const choiceRecord = choice && typeof choice === "object" ? choice as Record<string, unknown> : null;
    const message = choiceRecord?.message && typeof choiceRecord.message === "object" ? choiceRecord.message as Record<string, unknown> : null;
    const content = message?.content;
    if (typeof content === "string" && content.trim()) return content.trim();
    if (Array.isArray(content)) {
      const text = content.map((part) => {
        const partRecord = part && typeof part === "object" ? part as Record<string, unknown> : null;
        return firstString(partRecord?.text, partRecord?.content);
      }).filter(Boolean).join("\n").trim();
      if (text) return text;
    }
    const text = firstString(choiceRecord?.text);
    if (text) return text.trim();
  }
  return "";
}

function readGeminiText(payload: unknown) {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
  const candidates = Array.isArray(record?.candidates) ? record.candidates : [];
  for (const candidate of candidates) {
    const candidateRecord = candidate && typeof candidate === "object" ? candidate as Record<string, unknown> : null;
    const content = candidateRecord?.content && typeof candidateRecord.content === "object" ? candidateRecord.content as Record<string, unknown> : null;
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    const text = parts.map((part) => {
      const partRecord = part && typeof part === "object" ? part as Record<string, unknown> : null;
      return firstString(partRecord?.text);
    }).filter(Boolean).join("\n").trim();
    if (text) return text;
  }
  return "";
}

async function imageUrlToContentPart(url: string, signal?: AbortSignal) {
  if (/^data:image\//i.test(url)) return { type: "image_url", image_url: { url } };
  if (/^https?:\/\//i.test(url)) return { type: "image_url", image_url: { url } };
  if (!/^blob:|^forart-asset:/i.test(url)) return null;
  const response = await fetch(url, { signal });
  if (!response.ok) return null;
  const blob = await response.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read image."));
    reader.readAsDataURL(blob);
  });
  return { type: "image_url", image_url: { url: dataUrl } };
}

async function imageUrlToGeminiPart(url: string, signal?: AbortSignal) {
  const contentPart = await imageUrlToContentPart(url, signal);
  const dataUrl = contentPart?.image_url.url || "";
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) return null;
  return { inlineData: { mimeType: match[1] || "image/png", data: match[2] || "" } };
}

export async function generateChatWithProvider({ provider, model, prompt, referenceImages = [], signal }: ChatGenerationRequest) {
  const baseUrl = provider.baseUrl.trim();
  if (!baseUrl) throw new Error("API provider base URL is empty.");
  if (!model.trim()) throw new Error("No chat model selected.");

  if (provider.protocol === "gemini") {
    const apiKey = provider.apiKey.trim();
    const imageParts = (await Promise.all(referenceImages.map((url) => imageUrlToGeminiPart(url, signal)))).filter(Boolean);
    const payload = await requestJson(geminiGenerateContentUrl(baseUrl, model, apiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(apiKey ? { "x-goog-api-key": apiKey } : {}) },
      signal,
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }, ...imageParts] }],
      }),
    });
    const text = readGeminiText(payload);
    if (text) return text;
    throw new Error("The Gemini response did not contain text.");
  }

  const imageParts = (await Promise.all(referenceImages.map((url) => imageUrlToContentPart(url, signal)))).filter(Boolean);
  const content = imageParts.length ? [{ type: "text", text: prompt }, ...imageParts] : prompt;
  const payload = await requestJson(openAiChatUrl(baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(provider.apiKey.trim() ? { Authorization: `Bearer ${provider.apiKey.trim()}` } : {}),
    },
    signal,
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content }],
      temperature: 0.4,
    }),
  });
  const text = readOpenAiText(payload);
  if (text) return text;
  throw new Error("The chat API response did not contain text.");
}
