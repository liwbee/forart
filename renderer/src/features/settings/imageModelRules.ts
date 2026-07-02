export type ImageGenerationMode = "text_to_image" | "image_to_image";
export type ImageModelResolutionField = "resolution" | "size" | "none";

export interface ImageModelSizeRule {
  aspectRatios: string[];
  resolutions: string[];
  defaultAspectRatio: string;
  defaultResolution: string;
  allowAutoAspectRatio?: boolean;
  allowPixelSize?: boolean;
  resolutionField: ImageModelResolutionField;
}

export type ImageModelRuleId =
  | "generic-image"
  | "agnes-image"
  | "gpt-image-2"
  | "gpt-image-2-official"
  | "gpt-image-1"
  | "gemini-3.1-flash"
  | "gemini-3.1-flash-lite"
  | "gemini-3-pro"
  | "gemini-2.5-flash"
  | "seedream-4"
  | "seedream-4.5"
  | "seedream-5-lite"
  | "qwen-image"
  | "z-image-turbo"
  | "imagen-4"
  | "grok-imagine"
  | "wan-image"
  | "wan-image-pro";

export interface ImageModelRule {
  id: ImageModelRuleId;
  label: string;
  modes: ImageGenerationMode[];
  supportsReferenceImages: boolean;
  requiresPrompt: boolean;
  requiresReferenceImages: boolean;
  maxReferenceImages: number;
  referenceImageInput: "none" | "url";
  resolutionCase: "lower" | "upper";
  sizeMode: "ratio" | "pixel";
  requestFormat: "standard" | "openai-json-extra-body";
  sizeRule: ImageModelSizeRule;
}

interface RuleMatcher {
  ruleId: ImageModelRuleId;
  priority: number;
  all?: string[];
  any?: string[][];
  none?: string[];
  regex?: RegExp;
}

const BASIC_ASPECT_RATIOS = ["1:1", "2:3", "3:2", "4:3", "3:4", "16:9", "9:16"];
const GPT_IMAGE_1_ASPECT_RATIOS = ["1:1", "2:3", "3:2"];
const GPT_IMAGE_2_ASPECT_RATIOS = ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "2:1", "1:2", "3:1", "1:3", "21:9", "9:21"];
const GEMINI_ASPECT_RATIOS = ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "5:4", "4:5", "21:9"];
const GEMINI_EXTREME_ASPECT_RATIOS = [...GEMINI_ASPECT_RATIOS, "1:4", "4:1", "1:8", "8:1"];
const SEEDREAM_ASPECT_RATIOS = ["auto", "1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9", "9:21"];
const SEEDREAM_5_LITE_ASPECT_RATIOS = ["auto", "1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9"];
const IMAGEN_4_ASPECT_RATIOS = ["1:1", "4:3", "3:4", "16:9", "9:16"];
const GROK_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "3:2", "2:3"];

const GENERIC_SIZE_RULE: ImageModelSizeRule = {
  aspectRatios: BASIC_ASPECT_RATIOS,
  resolutions: ["1k", "2k", "4k"],
  defaultAspectRatio: "1:1",
  defaultResolution: "1k",
  resolutionField: "resolution",
};

function sizeRule(overrides: Partial<ImageModelSizeRule>): ImageModelSizeRule {
  return { ...GENERIC_SIZE_RULE, ...overrides };
}

export const IMAGE_MODEL_RULES: ImageModelRule[] = [
  {
    id: "generic-image",
    label: "Generic Image",
    modes: ["text_to_image", "image_to_image"],
    supportsReferenceImages: true,
    requiresPrompt: true,
    requiresReferenceImages: false,
    maxReferenceImages: 1,
    referenceImageInput: "url",
    resolutionCase: "lower",
    sizeMode: "ratio",
    requestFormat: "standard",
    sizeRule: GENERIC_SIZE_RULE,
  },
  {
    id: "agnes-image",
    label: "Agnes Image",
    modes: ["text_to_image", "image_to_image"],
    supportsReferenceImages: true,
    requiresPrompt: true,
    requiresReferenceImages: false,
    maxReferenceImages: 16,
    referenceImageInput: "url",
    resolutionCase: "lower",
    sizeMode: "pixel",
    requestFormat: "openai-json-extra-body",
    sizeRule: sizeRule({
      aspectRatios: BASIC_ASPECT_RATIOS,
      resolutions: ["1k", "2k", "4k"],
      allowPixelSize: true,
    }),
  },
  {
    id: "gpt-image-2",
    label: "GPT Image 2",
    modes: ["text_to_image", "image_to_image"],
    supportsReferenceImages: true,
    requiresPrompt: true,
    requiresReferenceImages: false,
    maxReferenceImages: 16,
    referenceImageInput: "url",
    resolutionCase: "lower",
    sizeMode: "ratio",
    requestFormat: "standard",
    sizeRule: sizeRule({
      aspectRatios: GPT_IMAGE_2_ASPECT_RATIOS,
      resolutions: ["1k", "2k", "4k"],
      allowAutoAspectRatio: true,
      allowPixelSize: true,
    }),
  },
  {
    id: "gpt-image-2-official",
    label: "GPT Image 2 Official",
    modes: ["text_to_image", "image_to_image"],
    supportsReferenceImages: true,
    requiresPrompt: true,
    requiresReferenceImages: false,
    maxReferenceImages: 16,
    referenceImageInput: "url",
    resolutionCase: "lower",
    sizeMode: "ratio",
    requestFormat: "standard",
    sizeRule: sizeRule({
      aspectRatios: GPT_IMAGE_2_ASPECT_RATIOS,
      resolutions: ["1k", "2k", "4k"],
      allowAutoAspectRatio: true,
      allowPixelSize: true,
    }),
  },
  {
    id: "gpt-image-1",
    label: "GPT Image 1 / 1.5",
    modes: ["text_to_image", "image_to_image"],
    supportsReferenceImages: true,
    requiresPrompt: true,
    requiresReferenceImages: false,
    maxReferenceImages: 15,
    referenceImageInput: "url",
    resolutionCase: "lower",
    sizeMode: "ratio",
    requestFormat: "standard",
    sizeRule: sizeRule({
      aspectRatios: GPT_IMAGE_1_ASPECT_RATIOS,
      resolutions: [],
      defaultResolution: "",
      resolutionField: "none",
    }),
  },
  {
    id: "gemini-3.1-flash",
    label: "Gemini 3.1 Flash Image",
    modes: ["text_to_image", "image_to_image"],
    supportsReferenceImages: true,
    requiresPrompt: true,
    requiresReferenceImages: false,
    maxReferenceImages: 14,
    referenceImageInput: "url",
    resolutionCase: "upper",
    sizeMode: "ratio",
    requestFormat: "standard",
    sizeRule: sizeRule({
      aspectRatios: GEMINI_EXTREME_ASPECT_RATIOS,
      resolutions: ["1K", "2K", "4K"],
      allowAutoAspectRatio: true,
      defaultResolution: "1K",
    }),
  },
  {
    id: "gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash Lite Image",
    modes: ["text_to_image", "image_to_image"],
    supportsReferenceImages: true,
    requiresPrompt: true,
    requiresReferenceImages: false,
    maxReferenceImages: 14,
    referenceImageInput: "url",
    resolutionCase: "upper",
    sizeMode: "ratio",
    requestFormat: "standard",
    sizeRule: sizeRule({
      aspectRatios: GEMINI_ASPECT_RATIOS,
      resolutions: ["1K"],
      allowAutoAspectRatio: true,
      defaultResolution: "1K",
    }),
  },
  {
    id: "gemini-3-pro",
    label: "Gemini 3 Pro Image",
    modes: ["text_to_image", "image_to_image"],
    supportsReferenceImages: true,
    requiresPrompt: true,
    requiresReferenceImages: false,
    maxReferenceImages: 14,
    referenceImageInput: "url",
    resolutionCase: "upper",
    sizeMode: "ratio",
    requestFormat: "standard",
    sizeRule: sizeRule({
      aspectRatios: GEMINI_ASPECT_RATIOS,
      resolutions: ["1K", "2K", "4K"],
      allowAutoAspectRatio: true,
      defaultResolution: "1K",
    }),
  },
  {
    id: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash Image",
    modes: ["text_to_image", "image_to_image"],
    supportsReferenceImages: true,
    requiresPrompt: true,
    requiresReferenceImages: false,
    maxReferenceImages: 14,
    referenceImageInput: "url",
    resolutionCase: "upper",
    sizeMode: "ratio",
    requestFormat: "standard",
    sizeRule: sizeRule({
      aspectRatios: GEMINI_ASPECT_RATIOS,
      resolutions: ["1K"],
      allowAutoAspectRatio: true,
      defaultResolution: "1K",
    }),
  },
  {
    id: "seedream-4",
    label: "Seedream 4.0",
    modes: ["text_to_image", "image_to_image"],
    supportsReferenceImages: true,
    requiresPrompt: true,
    requiresReferenceImages: false,
    maxReferenceImages: 14,
    referenceImageInput: "url",
    resolutionCase: "upper",
    sizeMode: "ratio",
    requestFormat: "standard",
    sizeRule: sizeRule({
      aspectRatios: SEEDREAM_ASPECT_RATIOS,
      resolutions: ["1K", "2K", "4K"],
      allowAutoAspectRatio: true,
      defaultResolution: "2K",
    }),
  },
  {
    id: "seedream-4.5",
    label: "Seedream 4.5",
    modes: ["text_to_image", "image_to_image"],
    supportsReferenceImages: true,
    requiresPrompt: true,
    requiresReferenceImages: false,
    maxReferenceImages: 14,
    referenceImageInput: "url",
    resolutionCase: "upper",
    sizeMode: "ratio",
    requestFormat: "standard",
    sizeRule: sizeRule({
      aspectRatios: SEEDREAM_ASPECT_RATIOS,
      resolutions: ["2K", "4K"],
      allowAutoAspectRatio: true,
      defaultResolution: "2K",
    }),
  },
  {
    id: "seedream-5-lite",
    label: "Seedream 5 Lite",
    modes: ["text_to_image", "image_to_image"],
    supportsReferenceImages: true,
    requiresPrompt: true,
    requiresReferenceImages: false,
    maxReferenceImages: 14,
    referenceImageInput: "url",
    resolutionCase: "upper",
    sizeMode: "ratio",
    requestFormat: "standard",
    sizeRule: sizeRule({
      aspectRatios: SEEDREAM_5_LITE_ASPECT_RATIOS,
      resolutions: ["2K", "3K", "4K"],
      allowAutoAspectRatio: true,
      defaultResolution: "2K",
    }),
  },
  {
    id: "qwen-image",
    label: "Qwen Image",
    modes: ["text_to_image", "image_to_image"],
    supportsReferenceImages: true,
    requiresPrompt: true,
    requiresReferenceImages: false,
    maxReferenceImages: 1,
    referenceImageInput: "url",
    resolutionCase: "upper",
    sizeMode: "ratio",
    requestFormat: "standard",
    sizeRule: sizeRule({
      aspectRatios: BASIC_ASPECT_RATIOS,
      resolutions: ["1K", "2K"],
      defaultResolution: "1K",
    }),
  },
  {
    id: "z-image-turbo",
    label: "Z-Image Turbo",
    modes: ["text_to_image"],
    supportsReferenceImages: false,
    requiresPrompt: true,
    requiresReferenceImages: false,
    maxReferenceImages: 0,
    referenceImageInput: "none",
    resolutionCase: "upper",
    sizeMode: "ratio",
    requestFormat: "standard",
    sizeRule: sizeRule({
      aspectRatios: BASIC_ASPECT_RATIOS,
      resolutions: ["1K", "2K"],
      defaultResolution: "1K",
    }),
  },
  {
    id: "imagen-4",
    label: "Imagen 4",
    modes: ["text_to_image"],
    supportsReferenceImages: false,
    requiresPrompt: true,
    requiresReferenceImages: false,
    maxReferenceImages: 0,
    referenceImageInput: "none",
    resolutionCase: "upper",
    sizeMode: "ratio",
    requestFormat: "standard",
    sizeRule: sizeRule({
      aspectRatios: IMAGEN_4_ASPECT_RATIOS,
      resolutions: [],
      defaultAspectRatio: "16:9",
      defaultResolution: "",
      resolutionField: "none",
    }),
  },
  {
    id: "grok-imagine",
    label: "Grok Imagine",
    modes: ["text_to_image"],
    supportsReferenceImages: false,
    requiresPrompt: true,
    requiresReferenceImages: false,
    maxReferenceImages: 0,
    referenceImageInput: "none",
    resolutionCase: "lower",
    sizeMode: "ratio",
    requestFormat: "standard",
    sizeRule: sizeRule({
      aspectRatios: GROK_ASPECT_RATIOS,
      resolutions: [],
      defaultResolution: "",
      resolutionField: "none",
    }),
  },
  {
    id: "wan-image",
    label: "Wan 2.7 Image",
    modes: ["text_to_image", "image_to_image"],
    supportsReferenceImages: true,
    requiresPrompt: true,
    requiresReferenceImages: false,
    maxReferenceImages: 9,
    referenceImageInput: "url",
    resolutionCase: "upper",
    sizeMode: "ratio",
    requestFormat: "standard",
    sizeRule: sizeRule({
      aspectRatios: BASIC_ASPECT_RATIOS,
      resolutions: ["1K", "2K"],
      defaultResolution: "2K",
      resolutionField: "resolution",
      allowPixelSize: true,
    }),
  },
  {
    id: "wan-image-pro",
    label: "Wan 2.7 Image Pro",
    modes: ["text_to_image", "image_to_image"],
    supportsReferenceImages: true,
    requiresPrompt: true,
    requiresReferenceImages: false,
    maxReferenceImages: 9,
    referenceImageInput: "url",
    resolutionCase: "upper",
    sizeMode: "ratio",
    requestFormat: "standard",
    sizeRule: sizeRule({
      aspectRatios: BASIC_ASPECT_RATIOS,
      resolutions: ["1K", "2K", "4K"],
      defaultResolution: "2K",
      resolutionField: "resolution",
      allowPixelSize: true,
    }),
  },
];

const RULE_BY_ID = new Map(IMAGE_MODEL_RULES.map((rule) => [rule.id, rule]));

const RULE_MATCHERS: RuleMatcher[] = [
  { ruleId: "agnes-image", priority: 130, all: ["agnes", "image"], none: ["video"] },
  { ruleId: "gpt-image-2-official", priority: 120, all: ["gpt", "image", "official"], any: [["2", "v2"]], none: ["video", "audio"] },
  { ruleId: "gpt-image-2", priority: 110, all: ["gpt", "image"], any: [["2", "v2"]], none: ["video", "audio"], regex: /gpt[-_. ]?image[-_. ]?(?:v)?2/i },
  { ruleId: "gpt-image-1", priority: 100, all: ["gpt", "image"], any: [["1", "v1", "1.5"]], none: ["video", "audio"] },
  { ruleId: "seedream-4.5", priority: 97, any: [["seedream", "seeddream", "doubao"], ["4.5"]], none: ["video", "seedance"], regex: /(?:seedream|seeddream|doubao).*4[-_. ]?5/i },
  { ruleId: "seedream-5-lite", priority: 95, all: ["seedream", "lite"], any: [["5", "5.0", "v5"]], none: ["video"] },
  { ruleId: "seedream-4", priority: 90, any: [["seedream", "seeddream", "doubao"]], none: ["video", "seedance"] },
  { ruleId: "gemini-3.1-flash-lite", priority: 89, all: ["gemini", "flash", "lite"], any: [["3.1"]], none: ["video", "chat"] },
  { ruleId: "gemini-3.1-flash", priority: 88, all: ["gemini", "flash"], any: [["3.1"]], none: ["video", "chat", "lite"] },
  { ruleId: "gemini-3-pro", priority: 87, all: ["gemini", "pro"], any: [["3"]], none: ["video", "chat"] },
  { ruleId: "gemini-2.5-flash", priority: 86, all: ["gemini", "flash"], any: [["2.5"]], none: ["video", "chat"] },
  { ruleId: "qwen-image", priority: 75, all: ["qwen", "image"], none: ["video", "chat"] },
  { ruleId: "z-image-turbo", priority: 70, all: ["z", "image"], any: [["turbo"]], none: ["video"] },
  { ruleId: "imagen-4", priority: 65, all: ["imagen"], any: [["4", "4.0", "v4"]], none: ["video"] },
  { ruleId: "grok-imagine", priority: 60, any: [["grok"], ["imagine"]], none: ["video"] },
  { ruleId: "wan-image-pro", priority: 56, all: ["image", "pro"], any: [["wan", "wan2.7", "2.7", "27"]], none: ["video"], regex: /wan[-_. ]?2\.?7[-_. ]?image[-_. ]?pro/i },
  { ruleId: "wan-image", priority: 55, all: ["image"], any: [["wan", "wan2.7", "2.7", "27"]], none: ["video"], regex: /wan[-_. ]?2\.?7[-_. ]?image/i },
];

export function tokenizeModelId(modelId: string) {
  const normalized = modelId.toLowerCase();
  const tokens = new Set<string>();
  normalized.match(/\d+(?:\.\d+)+/g)?.forEach((token) => tokens.add(token));
  normalized
    .split(/[^a-z0-9.]+/i)
    .map((token) => token.trim().replace(/^v(?=\d)/, "v"))
    .filter(Boolean)
    .forEach((token) => {
      tokens.add(token);
      if (/^v\d+(?:\.\d+)?$/.test(token)) tokens.add(token.slice(1));
      if (/^\d+\.\d+$/.test(token)) token.split(".").forEach((part) => tokens.add(part));
    });
  return tokens;
}

function hasToken(tokens: Set<string>, token: string) {
  return tokens.has(token.toLowerCase());
}

function matchesRule(modelId: string, tokens: Set<string>, matcher: RuleMatcher) {
  if (matcher.none?.some((token) => hasToken(tokens, token))) return false;
  if (matcher.regex?.test(modelId)) return true;
  if (matcher.all?.some((token) => !hasToken(tokens, token))) return false;
  if (matcher.any?.some((group) => !group.some((token) => hasToken(tokens, token)))) return false;
  return Boolean(matcher.all?.length || matcher.any?.length);
}

export function detectImageModelRuleId(modelId: string): ImageModelRuleId {
  const tokens = tokenizeModelId(modelId);
  const match = [...RULE_MATCHERS]
    .sort((a, b) => b.priority - a.priority)
    .find((matcher) => matchesRule(modelId, tokens, matcher));
  return match?.ruleId || "generic-image";
}

export function getImageModelRule(ruleId: string | undefined): ImageModelRule {
  return RULE_BY_ID.get(normalizeImageModelRuleId(ruleId))!;
}

export function getImageModelSizeRule(ruleId: string | undefined): ImageModelSizeRule {
  return getImageModelRule(ruleId).sizeRule;
}

export function normalizeImageModelSizeSelection(rule: ImageModelRule, resolution: string | undefined, aspectRatio: string | undefined) {
  const sizeRule = rule.sizeRule;
  return {
    resolution: sizeRule.resolutions.includes(resolution || "") ? resolution || "" : sizeRule.defaultResolution,
    aspectRatio: sizeRule.aspectRatios.includes(aspectRatio || "") ? aspectRatio || "" : sizeRule.defaultAspectRatio,
  };
}

export function imageModelRuleSupportsReferenceImages(ruleId: string | undefined) {
  return getImageModelRule(ruleId).supportsReferenceImages;
}

export function normalizeImageModelRuleId(ruleId: unknown): ImageModelRuleId {
  if (ruleId === "generic-apimart-image") return "generic-image";
  if (ruleId === "gemini-apimart-image" || ruleId === "gemini-image") return "generic-image";
  if (ruleId === "seedream") return "seedream-4";
  if (ruleId === "wan2.7-image") return "wan-image";
  if (ruleId === "wan2.7-image-pro") return "wan-image-pro";
  return RULE_BY_ID.has(ruleId as ImageModelRuleId) ? ruleId as ImageModelRuleId : "generic-image";
}
