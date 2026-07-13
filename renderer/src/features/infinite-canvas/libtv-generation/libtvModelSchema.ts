import type { LibtvImageModelRecord } from "../../../app/appConfig";

export interface LibtvModelOption {
  label: string;
  value: string;
}

export interface LibtvModelCapabilities {
  aspectRatios: string[];
  aspectRatioOptions: LibtvModelOption[];
  defaultAspectRatio: string;
  defaultImageCount: string;
  defaultQuality: string;
  defaultResolution: string;
  maxReferenceImages: number;
  imageCounts: string[];
  imageCountOptions: LibtvModelOption[];
  qualities: string[];
  qualityOptions: LibtvModelOption[];
  resolutionField: "quality" | "resolution" | null;
  resolutions: string[];
  resolutionOptions: LibtvModelOption[];
  supportsReferenceImages: boolean;
}

export const DEFAULT_LIBTV_CAPABILITIES: LibtvModelCapabilities = {
  aspectRatios: ["1:1", "2:3", "3:2", "4:3", "3:4", "16:9", "9:16"],
  aspectRatioOptions: ["1:1", "2:3", "3:2", "4:3", "3:4", "16:9", "9:16"]
    .map((value) => ({ value, label: value })),
  defaultAspectRatio: "1:1",
  defaultImageCount: "1",
  defaultQuality: "",
  defaultResolution: "2K",
  maxReferenceImages: 7,
  imageCounts: ["1"],
  imageCountOptions: [{ value: "1", label: "1" }],
  qualities: [],
  qualityOptions: [],
  resolutionField: "quality",
  resolutions: ["1K", "2K", "4K"],
  resolutionOptions: ["1K", "2K", "4K"].map((value) => ({ value, label: value })),
  supportsReferenceImages: true,
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function modelOptions(value: unknown): LibtvModelOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string" || typeof item === "number") {
      const text = String(item);
      return [{ value: text, label: text }];
    }
    const itemRecord = record(item);
    const candidate = itemRecord.value ?? itemRecord.key ?? itemRecord.id ?? itemRecord.label;
    if (candidate === undefined) return [];
    const value = String(candidate);
    return [{
      value,
      label: String(itemRecord.displayName ?? itemRecord.label ?? candidate),
    }];
  }).filter((option) => option.value);
}

function propertyOptions(property: Record<string, unknown>) {
  return modelOptions(property.enum).length
    ? modelOptions(property.enum)
    : modelOptions(property.options).length
      ? modelOptions(property.options)
      : modelOptions(property.items).length
        ? modelOptions(property.items)
        : modelOptions(property.values);
}

function propertyDefault(property: Record<string, unknown>, options: LibtvModelOption[], fallback: string) {
  const value = String(property.default ?? property.defaultValue ?? property.value ?? "");
  const values = options.map((option) => option.value);
  return values.includes(value) ? value : values.includes(fallback) ? fallback : values[0] || fallback;
}

function qualityRepresentsResolution(property: Record<string, unknown>, options: LibtvModelOption[]) {
  const displayName = String(property.displayName || "").toLocaleLowerCase();
  return /分辨率|清晰度|resolution/.test(displayName)
    || (options.length > 0 && options.every((option) => /^\d+k$/i.test(option.value)));
}

export function normalizeLibtvModels(models: LibtvImageModelRecord[]) {
  return models.filter((model) => model.modelName || model.modelKey);
}

export function deriveLibtvModelCapabilities(input: unknown): LibtvModelCapabilities {
  const response = record(input);
  const schema = record(response.schema || response);
  const properties = record(schema.properties);
  const qualityProperty = record(properties.quality);
  const resolutionProperty = record(properties.resolution);
  const ratioProperty = record(properties.ratio || properties.aspectRatio);
  const countProperty = record(properties.count);
  const rawQualityOptions = propertyOptions(qualityProperty);
  const rawResolutionOptions = propertyOptions(resolutionProperty);
  const aspectRatioOptions = propertyOptions(ratioProperty);
  const imageCountOptions = Array.isArray(properties.count)
    ? modelOptions(properties.count)
    : propertyOptions(countProperty);
  const hasDedicatedResolution = rawResolutionOptions.length > 0;
  const qualityIsResolution = !hasDedicatedResolution && qualityRepresentsResolution(qualityProperty, rawQualityOptions);
  const resolutionField = hasDedicatedResolution ? "resolution" : qualityIsResolution ? "quality" : null;
  const resolutionOptions = hasDedicatedResolution
    ? rawResolutionOptions
    : qualityIsResolution ? rawQualityOptions : [];
  const qualityOptions = hasDedicatedResolution || !qualityIsResolution ? rawQualityOptions : [];
  const modeType = record(properties.modeType);
  const modeItems = record(modeType.items);
  const image2image = Array.isArray(modeItems.image2image) ? modeItems.image2image : null;
  const maxReferenceImages = image2image
    ? Math.max(0, Number(image2image[1] ?? image2image[0] ?? 0))
    : DEFAULT_LIBTV_CAPABILITIES.maxReferenceImages;
  const hasModelProperties = Object.keys(properties).length > 0;
  const resolvedResolutionOptions = resolutionOptions.length
    ? resolutionOptions
    : hasModelProperties ? [] : DEFAULT_LIBTV_CAPABILITIES.resolutionOptions;
  const resolvedResolutionField = resolutionOptions.length
    ? resolutionField
    : hasModelProperties ? null : DEFAULT_LIBTV_CAPABILITIES.resolutionField;
  const resolvedAspectRatioOptions = aspectRatioOptions.length
    ? aspectRatioOptions
    : DEFAULT_LIBTV_CAPABILITIES.aspectRatioOptions;
  const resolvedImageCountOptions = imageCountOptions.length
    ? imageCountOptions
    : hasModelProperties ? [] : DEFAULT_LIBTV_CAPABILITIES.imageCountOptions;
  return {
    resolutions: resolvedResolutionOptions.map((option) => option.value),
    resolutionOptions: resolvedResolutionOptions,
    resolutionField: resolvedResolutionField,
    qualities: qualityOptions.map((option) => option.value),
    qualityOptions,
    aspectRatios: resolvedAspectRatioOptions.map((option) => option.value),
    aspectRatioOptions: resolvedAspectRatioOptions,
    imageCounts: resolvedImageCountOptions.map((option) => option.value),
    imageCountOptions: resolvedImageCountOptions,
    defaultResolution: propertyDefault(
      resolvedResolutionField === "resolution" ? resolutionProperty : qualityProperty,
      resolvedResolutionOptions,
      DEFAULT_LIBTV_CAPABILITIES.defaultResolution,
    ),
    defaultQuality: qualityOptions.length ? propertyDefault(qualityProperty, qualityOptions, "") : "",
    defaultAspectRatio: propertyDefault(
      ratioProperty,
      resolvedAspectRatioOptions,
      DEFAULT_LIBTV_CAPABILITIES.defaultAspectRatio,
    ),
    defaultImageCount: propertyDefault(
      countProperty,
      resolvedImageCountOptions,
      DEFAULT_LIBTV_CAPABILITIES.defaultImageCount,
    ),
    supportsReferenceImages: maxReferenceImages > 0,
    maxReferenceImages,
  };
}
