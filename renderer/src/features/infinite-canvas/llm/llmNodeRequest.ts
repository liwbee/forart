import type { TFunction } from "i18next";
import { collectReferenceImages, collectUpstreamPrompt } from "../core/workflow";
import type { CanvasConnection, CanvasNode } from "../types";

export interface LlmNodeRequestInput {
  node: CanvasNode;
  nodes: CanvasNode[];
  connections: CanvasConnection[];
  t: TFunction;
}

export interface LlmNodeRequest {
  prompt: string;
  referenceImages: string[];
  hasInput: boolean;
}

export function buildLlmNodeRequest({ node, nodes, connections, t }: LlmNodeRequestInput): LlmNodeRequest {
  const userInput = (node.variablePrompt || "").trim();
  const upstreamPrompt = collectUpstreamPrompt(node, nodes, connections).trim();
  const referenceImages = collectReferenceImages(node, nodes, connections);
  const instruction = (node.fixedPrompt || t("infiniteCanvas:llmDefaultInstruction")).trim();

  const prompt = [
    instruction,
    userInput ? `${t("infiniteCanvas:llmUserInputLabel")}\n${userInput}` : "",
    upstreamPrompt ? `${t("infiniteCanvas:llmInputLabel")}\n${upstreamPrompt}` : "",
    referenceImages.length ? t("infiniteCanvas:llmImageInputHint") : "",
  ].filter(Boolean).join("\n\n");

  return {
    prompt,
    referenceImages,
    hasInput: Boolean(userInput || upstreamPrompt || referenceImages.length),
  };
}
