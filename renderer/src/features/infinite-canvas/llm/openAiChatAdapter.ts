import { imageUrlToOpenAiContentPart, joinApiPath, readOpenAiSseText, readOpenAiText, requestText } from "./chatAdapterShared";
import type { ChatAdapter, ChatGenerationRequest } from "./chatTypes";

function openAiChatUrl(baseUrl: string) {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(normalized)) return normalized;
  for (const prefix of ["/api/v3", "/v1beta", "/v1", "/v2"]) {
    if (normalized.endsWith(prefix)) return joinApiPath(normalized, "chat/completions");
  }
  return joinApiPath(normalized, "v1/chat/completions");
}

export const openAiChatAdapter: ChatAdapter = {
  async generate({ provider, model, prompt, referenceImages = [], signal }: ChatGenerationRequest) {
    const imageParts = (await Promise.all(referenceImages.map((url) => imageUrlToOpenAiContentPart(url, signal)))).filter(Boolean);
    const content = imageParts.length ? [{ type: "text", text: prompt }, ...imageParts] : prompt;
    const responseText = await requestText(openAiChatUrl(provider.baseUrl), {
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
    const streamText = readOpenAiSseText(responseText);
    if (streamText) return streamText;

    const payload = JSON.parse(responseText) as unknown;
    const text = readOpenAiText(payload);
    if (text) return text;
    throw new Error("The chat API response did not contain text.");
  },
};
