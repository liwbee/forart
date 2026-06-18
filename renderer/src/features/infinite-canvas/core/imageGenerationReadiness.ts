import type { ImageModelRule } from "../../settings/imageModelRules";

export type ImageGenerationReadinessReason =
  | ""
  | "missing_prompt"
  | "missing_reference_image"
  | "reference_not_supported"
  | "too_many_reference_images";

export interface ImageGenerationReadiness {
  canRun: boolean;
  reason: ImageGenerationReadinessReason;
  message: string;
  maxReferenceImages?: number;
}

export interface ImageGenerationReadinessInput {
  prompt: string;
  referenceImageCount: number;
  rule: ImageModelRule | null;
}

export function getImageGenerationReadiness({ prompt, referenceImageCount, rule }: ImageGenerationReadinessInput): ImageGenerationReadiness {
  if (!prompt.trim()) {
    return {
      canRun: false,
      reason: "missing_prompt",
      message: "",
    };
  }

  if (!rule) {
    return { canRun: true, reason: "", message: "" };
  }

  if (rule.requiresReferenceImages && referenceImageCount <= 0) {
    return {
      canRun: false,
      reason: "missing_reference_image",
      message: "",
    };
  }

  if (referenceImageCount > 0 && !rule.supportsReferenceImages) {
    return {
      canRun: false,
      reason: "reference_not_supported",
      message: "",
    };
  }

  if (referenceImageCount > rule.maxReferenceImages) {
    return {
      canRun: false,
      reason: "too_many_reference_images",
      message: "",
      maxReferenceImages: rule.maxReferenceImages,
    };
  }

  return { canRun: true, reason: "", message: "" };
}
