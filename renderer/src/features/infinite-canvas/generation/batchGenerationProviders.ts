import type { TFunction } from "i18next";
import type { GenerationTaskDto } from "../../../app/appConfig";
import { isImageProviderConfigured, loadApiSettings, orderedApiProviders } from "../../settings/apiProviders";
import {
  detectImageModelRuleId,
  getImageModelRule,
  normalizeImageModelCustomSize,
  normalizeImageModelSizeSelection,
} from "../../settings/imageModelRules";
import { deriveLibtvModelCapabilities } from "../libtv-generation/libtvModelSchema";
import type { NativeCanvasNode } from "../nativeCanvas";
import { validateImageGeneratorReferences } from "./imageGenerationInputs";

export interface BatchGenerationInput {
  target: Record<string, unknown>;
  prompt: string;
  referenceImages: string[];
  nodeTitle: string;
}

interface StartBatchGenerationOptions {
  canvasId: string;
  node: NativeCanvasNode;
  inputs: BatchGenerationInput[];
  signal: AbortSignal;
  t: TFunction;
}

function abortError() {
  return new DOMException("Aborted", "AbortError");
}

async function stopStartedTasks(tasks: GenerationTaskDto[]) {
  await Promise.allSettled(tasks.map((task) => window.forartGenerationTasks?.stop(task.id)));
}

async function startTasks(
  executorKind: "api" | "libtv",
  payloads: unknown[],
  signal: AbortSignal,
) {
  const taskApi = window.forartGenerationTasks;
  if (!taskApi?.startMany) throw new Error("Generation task service is unavailable.");
  if (signal.aborted) throw abortError();
  const tasks = await taskApi.startMany(executorKind, payloads);
  if (!signal.aborted) return tasks;
  await stopStartedTasks(tasks);
  throw abortError();
}

async function startApiBatchGeneration({ canvasId, node, inputs, signal, t }: StartBatchGenerationOptions) {
  const settings = await loadApiSettings();
  if (signal.aborted) throw abortError();
  const providers = orderedApiProviders(settings.providers, settings.providerOrder).filter(isImageProviderConfigured);
  const provider = providers.find((item) => item.id === node.data.imageProviderId)
    || providers.find((item) => item.id === settings.defaultImageProviderId)
    || providers[0];
  const model = provider?.imageModels.includes(String(node.data.imageModel || ""))
    ? String(node.data.imageModel)
    : provider?.imageModels[0] || "";
  if (!provider || !model) throw new Error(t("infiniteCanvas:noImageApiConfigured"));

  const rule = getImageModelRule(provider.modelRules.image[model] || detectImageModelRuleId(model));
  const size = normalizeImageModelSizeSelection(rule, node.data.imageResolution, node.data.imageAspectRatio);
  const customSize = normalizeImageModelCustomSize(rule, node.data.imageCustomSize);
  if (rule.sizeRule.pixelSizeConstraints && node.data.imageCustomSize && !customSize) {
    throw new Error(t("infiniteCanvas:invalidCustomPixelSize", {
      min: rule.sizeRule.pixelSizeConstraints.minDimension,
      max: rule.sizeRule.pixelSizeConstraints.maxDimension,
    }));
  }

  const payloads = inputs.map((input) => {
    const referenceError = validateImageGeneratorReferences(rule, input.referenceImages.length);
    if (referenceError === "unsupported") throw new Error(t("infiniteCanvas:imageGenerationReferenceNotSupported"));
    if (referenceError === "required") throw new Error(t("infiniteCanvas:imageGenerationMissingReferenceImage"));
    if (referenceError === "tooMany") {
      throw new Error(t("infiniteCanvas:imageGenerationTooManyReferenceImages", { count: rule.maxReferenceImages }));
    }
    if (!input.prompt.trim()) throw new Error(t("infiniteCanvas:promptRequired"));
    return {
      canvasId,
      nodeId: node.id,
      target: input.target,
      kind: "image",
      providerId: provider.id,
      model,
      modelRule: rule,
      prompt: input.prompt,
      referenceImages: input.referenceImages,
      resolution: size.resolution,
      aspectRatio: size.aspectRatio,
      customSize: customSize || undefined,
      quality: node.data.imageQuality,
      imageCount: 1,
      negativePrompt: String(node.data.imageNegativePrompt || "").trim() || undefined,
      promptExtend: Boolean(node.data.imagePromptExtend),
      promptExtendMode: node.data.imagePromptExtendMode,
      status: "submitting",
    };
  });
  return startTasks("api", payloads, signal);
}

async function startLibtvBatchGeneration({ canvasId, node, inputs, signal, t }: StartBatchGenerationOptions) {
  const libtvApi = window.libtv;
  if (!libtvApi) throw new Error(t("infiniteCanvas:libtvUnavailable"));
  const status = await libtvApi.status();
  if (signal.aborted) throw abortError();
  if (!status.available) throw new Error(status.error || t("infiniteCanvas:libtvUnavailable"));
  const account = await libtvApi.account();
  if (signal.aborted) throw abortError();
  if (!account.loggedIn) throw new Error(account.error || t("infiniteCanvas:libtvNotLoggedIn"));

  const state = node.data.libtvImageGeneration || {};
  const modelName = String(state.modelName || "").trim();
  if (!modelName) throw new Error(t("infiniteCanvas:libtvModelRequired"));
  const capabilities = deriveLibtvModelCapabilities(await libtvApi.imageModelSchema({ model: modelName }));
  if (signal.aborted) throw abortError();
  if (!capabilities.supportsReferenceImages) {
    throw new Error(t("infiniteCanvas:imageGenerationReferenceNotSupported"));
  }

  const storedResolution = capabilities.resolutionField === "resolution"
    ? String(state.resolution || "")
    : String(state.quality || "");
  const selectedResolution = capabilities.resolutions.includes(storedResolution)
    ? storedResolution
    : capabilities.defaultResolution;
  const quality = capabilities.resolutionField === "quality"
    ? selectedResolution
    : capabilities.qualities.includes(String(state.quality || ""))
      ? String(state.quality)
      : capabilities.defaultQuality;
  const resolution = capabilities.resolutionField === "resolution" ? selectedResolution : "";
  const aspectRatio = capabilities.aspectRatios.includes(String(state.aspectRatio || ""))
    ? String(state.aspectRatio)
    : capabilities.defaultAspectRatio;

  const payloads = inputs.map((input) => {
    if (input.referenceImages.length > capabilities.maxReferenceImages) {
      throw new Error(t("infiniteCanvas:imageGenerationTooManyReferenceImages", { count: capabilities.maxReferenceImages }));
    }
    if (!input.prompt.trim()) throw new Error(t("infiniteCanvas:promptRequired"));
    return {
      canvasId,
      nodeId: node.id,
      target: input.target,
      queueKey: `${canvasId}:${node.id}`,
      prompt: input.prompt,
      modelName,
      count: 1,
      quality,
      resolution,
      aspectRatio,
      referenceImages: input.referenceImages,
      nodeTitle: input.nodeTitle,
      x: Math.round(node.position.x),
      y: Math.round(node.position.y),
    };
  });
  return startTasks("libtv", payloads, signal);
}

/** Provider seam for item-based image generation. Node adapters supply only
 * domain inputs; provider selection, validation and payloads stay here. */
export function startBatchGeneration(options: StartBatchGenerationOptions) {
  if (!window.forartGenerationTasks?.startMany) {
    throw new Error(options.t(options.node.data.imageGenerationBackend === "libtv"
      ? "infiniteCanvas:libtvUnavailable"
      : "infiniteCanvas:canvasDesktopRequired"));
  }
  return options.node.data.imageGenerationBackend === "libtv"
    ? startLibtvBatchGeneration(options)
    : startApiBatchGeneration(options);
}
