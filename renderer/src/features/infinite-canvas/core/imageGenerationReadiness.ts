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
      message: "请输入提示词",
    };
  }

  if (!rule) {
    return { canRun: true, reason: "", message: "" };
  }

  if (rule.requiresReferenceImages && referenceImageCount <= 0) {
    return {
      canRun: false,
      reason: "missing_reference_image",
      message: "请传入参考图",
    };
  }

  if (referenceImageCount > 0 && !rule.supportsReferenceImages) {
    return {
      canRun: false,
      reason: "reference_not_supported",
      message: "该模型不支持传入参考图",
    };
  }

  if (referenceImageCount > rule.maxReferenceImages) {
    return {
      canRun: false,
      reason: "too_many_reference_images",
      message: `该模型最多支持 ${rule.maxReferenceImages} 张参考图`,
    };
  }

  return { canRun: true, reason: "", message: "" };
}
