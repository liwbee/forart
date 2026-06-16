export type ImageGenerationMode = "text_to_image" | "image_to_image";

export type ImageModelRuleId =
  | "generic-image"
  | "gpt-image-2"
  | "gpt-image-2-official"
  | "gpt-image-1"
  | "gemini-image"
  | "seedream"
  | "seedream-5-lite"
  | "qwen-image"
  | "z-image-turbo"
  | "imagen-4"
  | "grok-imagine";

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
}

interface RuleMatcher {
  ruleId: ImageModelRuleId;
  priority: number;
  all?: string[];
  any?: string[][];
  none?: string[];
  regex?: RegExp;
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
  },
  {
    id: "gemini-image",
    label: "Gemini Image",
    modes: ["text_to_image", "image_to_image"],
    supportsReferenceImages: true,
    requiresPrompt: true,
    requiresReferenceImages: false,
    maxReferenceImages: 14,
    referenceImageInput: "url",
    resolutionCase: "upper",
    sizeMode: "ratio",
  },
  {
    id: "seedream",
    label: "Seedream",
    modes: ["text_to_image", "image_to_image"],
    supportsReferenceImages: true,
    requiresPrompt: true,
    requiresReferenceImages: false,
    maxReferenceImages: 10,
    referenceImageInput: "url",
    resolutionCase: "upper",
    sizeMode: "ratio",
  },
  {
    id: "seedream-5-lite",
    label: "Seedream 5 Lite",
    modes: ["text_to_image", "image_to_image"],
    supportsReferenceImages: true,
    requiresPrompt: true,
    requiresReferenceImages: false,
    maxReferenceImages: 10,
    referenceImageInput: "url",
    resolutionCase: "upper",
    sizeMode: "ratio",
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
  },
];

const RULE_BY_ID = new Map(IMAGE_MODEL_RULES.map((rule) => [rule.id, rule]));

const RULE_MATCHERS: RuleMatcher[] = [
  { ruleId: "gpt-image-2-official", priority: 120, all: ["gpt", "image", "official"], any: [["2", "v2"]], none: ["video", "audio"] },
  { ruleId: "gpt-image-2", priority: 110, all: ["gpt", "image"], any: [["2", "v2"]], none: ["video", "audio"], regex: /gpt[-_. ]?image[-_. ]?(?:v)?2/i },
  { ruleId: "gpt-image-1", priority: 100, all: ["gpt", "image"], any: [["1", "v1", "1.5"]], none: ["video", "audio"] },
  { ruleId: "seedream-5-lite", priority: 95, all: ["seedream", "lite"], any: [["5", "5.0", "v5"]], none: ["video"] },
  { ruleId: "seedream", priority: 90, any: [["seedream", "seeddream"], ["doubao"]], none: ["video", "seedance"] },
  { ruleId: "gemini-image", priority: 80, any: [["gemini", "nano"], ["image", "banana"]], none: ["video", "chat"] },
  { ruleId: "qwen-image", priority: 75, all: ["qwen", "image"], none: ["video", "chat"] },
  { ruleId: "z-image-turbo", priority: 70, all: ["z", "image"], any: [["turbo"]], none: ["video"] },
  { ruleId: "imagen-4", priority: 65, all: ["imagen"], any: [["4", "4.0", "v4"]], none: ["video"] },
  { ruleId: "grok-imagine", priority: 60, any: [["grok"], ["imagine"]], none: ["video"] },
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
  if (matcher.regex?.test(modelId)) return true;
  if (matcher.none?.some((token) => hasToken(tokens, token))) return false;
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

export function imageModelRuleSupportsReferenceImages(ruleId: string | undefined) {
  return getImageModelRule(ruleId).supportsReferenceImages;
}

export function normalizeImageModelRuleId(ruleId: unknown): ImageModelRuleId {
  if (ruleId === "generic-apimart-image") return "generic-image";
  if (ruleId === "gemini-apimart-image") return "gemini-image";
  return RULE_BY_ID.has(ruleId as ImageModelRuleId) ? ruleId as ImageModelRuleId : "generic-image";
}
