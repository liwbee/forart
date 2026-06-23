import { geminiChatAdapter } from "./geminiChatAdapter";
import { openAiChatAdapter } from "./openAiChatAdapter";
import type { ChatAdapter, ChatGenerationRequest } from "./chatTypes";

export function createChatAdapter(request: ChatGenerationRequest): ChatAdapter {
  if (request.provider.protocol === "gemini") return geminiChatAdapter;
  return openAiChatAdapter;
}

export async function generateChatWithProvider(request: ChatGenerationRequest) {
  const baseUrl = request.provider.baseUrl.trim();
  if (!baseUrl) throw new Error("API provider base URL is empty.");
  if (!request.model.trim()) throw new Error("No chat model selected.");
  return createChatAdapter(request).generate(request);
}
