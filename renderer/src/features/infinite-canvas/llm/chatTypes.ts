import type { ApiProvider } from "../../settings/apiProviders";

export interface ChatGenerationRequest {
  provider: ApiProvider;
  model: string;
  prompt: string;
  referenceImages?: string[];
  signal?: AbortSignal;
}

export interface ChatAdapter {
  generate(request: ChatGenerationRequest): Promise<string>;
}
