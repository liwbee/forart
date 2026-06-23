function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && Boolean(value.trim())) || "";
}

export function joinApiPath(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export async function readErrorMessage(response: Response) {
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

export async function requestJson(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(await readErrorMessage(response));
  return response.json() as Promise<unknown>;
}

export async function requestText(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(await readErrorMessage(response));
  return response.text();
}

export function readOpenAiText(payload: unknown) {
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

export function readOpenAiSseText(text: string) {
  const chunks = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== "[DONE]");

  const parts: string[] = [];
  for (const chunk of chunks) {
    try {
      const payload = JSON.parse(chunk) as Record<string, unknown>;
      const choices = Array.isArray(payload.choices) ? payload.choices : [];
      for (const choice of choices) {
        const choiceRecord = choice && typeof choice === "object" ? choice as Record<string, unknown> : null;
        const delta = choiceRecord?.delta && typeof choiceRecord.delta === "object" ? choiceRecord.delta as Record<string, unknown> : null;
        const message = choiceRecord?.message && typeof choiceRecord.message === "object" ? choiceRecord.message as Record<string, unknown> : null;
        const textPart = firstString(delta?.content, message?.content, choiceRecord?.text);
        if (textPart) parts.push(textPart);
      }

      const responseText = firstString(
        payload.delta,
        payload.text,
        payload.output_text,
      );
      if (responseText) parts.push(responseText);
    } catch {
      // Ignore malformed stream fragments and let the caller report an empty response if nothing parsed.
    }
  }
  return parts.join("").trim();
}

export function readGeminiText(payload: unknown) {
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

export async function imageUrlToOpenAiContentPart(url: string, signal?: AbortSignal) {
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

export async function imageUrlToGeminiPart(url: string, signal?: AbortSignal) {
  const contentPart = await imageUrlToOpenAiContentPart(url, signal);
  const dataUrl = contentPart?.image_url.url || "";
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) return null;
  return { inlineData: { mimeType: match[1] || "image/png", data: match[2] || "" } };
}
