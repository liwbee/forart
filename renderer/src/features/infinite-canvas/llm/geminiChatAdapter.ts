import { imageUrlToGeminiPart, joinApiPath, readGeminiText, requestJson } from "./chatAdapterShared";
import type { ChatAdapter, ChatGenerationRequest } from "./chatTypes";

function geminiGenerateContentUrl(baseUrl: string, model: string, apiKey: string) {
  const normalized = baseUrl.replace(/\/+$/, "");
  const modelPath = model.replace(/^models\//, "");
  const path = /\/models$/i.test(normalized)
    ? `${encodeURIComponent(modelPath)}:generateContent`
    : `models/${encodeURIComponent(modelPath)}:generateContent`;
  return joinApiPath(normalized, `${path}${apiKey ? `?key=${encodeURIComponent(apiKey)}` : ""}`);
}

export const geminiChatAdapter: ChatAdapter = {
  async generate({ provider, model, prompt, referenceImages = [], signal }: ChatGenerationRequest) {
    const apiKey = provider.apiKey.trim();
    const imageParts = (await Promise.all(referenceImages.map((url) => imageUrlToGeminiPart(url, signal)))).filter(Boolean);
    const payload = await requestJson(geminiGenerateContentUrl(provider.baseUrl, model, apiKey), {
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
  },
};
