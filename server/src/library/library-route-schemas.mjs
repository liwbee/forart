import { z } from "zod";

const BULK_ENTRY_LIMIT = 500;
const BULK_OPERATIONS = ["delete", "add_tags", "remove_tags"];
const LIBRARY_TAG_COLORS = ["default", "red", "yellow", "brown", "blue", "green", "purple"];
const LIBRARY_TAG_COLOR_SET = new Set(LIBRARY_TAG_COLORS);

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeLibraryRouteTagName(value) {
  return normalizeText(value).slice(0, 24);
}

function normalizeLibraryRouteTagColor(value) {
  const next = String(value || "").trim();
  return LIBRARY_TAG_COLOR_SET.has(next) ? next : "default";
}

function normalizeLibraryRouteSortOrder(value) {
  return Number(value || 0);
}

function normalizeLibraryRouteOptionalAssetId(value) {
  if (value === undefined) return undefined;
  return value ? String(value) : null;
}

function defaultUploadFilename(value) {
  return String(value || "image");
}

function defaultUploadMimeType(value) {
  return String(value || "image/png");
}

function normalizeOptionalString(value) {
  if (value === undefined) return undefined;
  return String(value || "");
}

function normalizePrompt(value) {
  if (value === undefined) return undefined;
  return String(value || "").slice(0, 4000);
}

function uniqueTexts(values) {
  const output = [];
  for (const value of values || []) {
    const text = normalizeText(value);
    if (text && !output.includes(text)) output.push(text);
  }
  return output;
}

function normalizeLibraryRouteTags(values) {
  return uniqueTexts(values).map((tag) => tag.slice(0, 24));
}

function normalizeLibraryRouteEntryIds(values) {
  return uniqueTexts(values);
}

export const libraryBulkEntriesPayloadSchema = z.object({
  project_id: z.string().transform(normalizeText).pipe(z.string().min(1, "project_id is required")),
  entry_ids: z.array(z.string()).default([])
    .transform(normalizeLibraryRouteEntryIds)
    .pipe(z.array(z.string()).min(1, "No entries selected").max(BULK_ENTRY_LIMIT, `Bulk operation is limited to ${BULK_ENTRY_LIMIT} entries`)),
  operation: z.string().transform(normalizeText).pipe(z.enum(BULK_OPERATIONS, { message: "Unsupported bulk operation" })),
  tags: z.array(z.string()).optional().default([]).transform(normalizeLibraryRouteTags),
}).strict().superRefine((payload, context) => {
  if ((payload.operation === "add_tags" || payload.operation === "remove_tags") && !payload.tags.length) {
    context.addIssue({
      code: "custom",
      path: ["tags"],
      message: "At least one tag is required",
    });
  }
});

export const libraryTagProjectQuerySchema = z.object({
  project_id: z.string().transform(normalizeText).pipe(z.string().min(1, "project_id is required")),
}).passthrough();

export const libraryTagRouteParamsSchema = libraryTagProjectQuerySchema.extend({
  tag_id: z.string().transform(normalizeText).pipe(z.string().min(1, "tagId is required")),
});

export const libraryCreateTagPayloadSchema = z.object({
  name: z.any()
    .transform(normalizeLibraryRouteTagName)
    .pipe(z.string().min(1, "Tag name is required")),
  color: z.any().optional().transform((value) => (
    value === undefined ? undefined : normalizeLibraryRouteTagColor(value)
  )),
}).strict();

export const libraryUpdateTagPayloadSchema = z.object({
  name: z.any().optional()
    .transform((value) => (value === undefined ? undefined : normalizeLibraryRouteTagName(value)))
    .pipe(z.union([z.undefined(), z.string().min(1, "Tag name is required")])),
  color: z.any().optional().transform((value) => (
    value === undefined ? undefined : normalizeLibraryRouteTagColor(value)
  )),
  sort_order: z.any().optional().transform((value) => (
    value === undefined ? undefined : normalizeLibraryRouteSortOrder(value)
  )),
}).strict();

export const libraryCreateProjectPayloadSchema = z.object({
  name: z.any().optional(),
}).strict();

export const libraryUpdateProjectPayloadSchema = z.object({
  name: z.any().optional(),
  cover_asset_id: z.any().optional().transform(normalizeLibraryRouteOptionalAssetId),
  sort_order: z.any().optional().transform((value) => (
    value === undefined ? undefined : normalizeLibraryRouteSortOrder(value)
  )),
}).strict();

export const libraryAssetUploadPayloadSchema = z.object({
  filename: z.any().optional().transform(defaultUploadFilename),
  mime_type: z.any().optional().transform(defaultUploadMimeType),
  data: z.string().min(1, "Invalid upload data"),
}).strict();

export const libraryCreateModelPayloadSchema = z.object({
  name: z.any().optional(),
  gender: z.any().optional().transform((value) => (
    value === "female" || value === "male" ? value : "unknown"
  )),
}).strict();

export const libraryUpdateModelPayloadSchema = z.object({
  name: z.any().optional(),
  tags: z.array(z.string()).optional().transform((value) => (
    value === undefined ? undefined : normalizeLibraryRouteTags(value)
  )),
  cover_image_id: z.any().optional().transform(normalizeLibraryRouteOptionalAssetId),
}).strict();

export const libraryAddModelImagePayloadSchema = z.object({
  asset_id: z.any().transform((value) => String(value || "")).pipe(z.string().min(1, "asset_id is required")),
  caption: z.any().optional().transform(normalizeOptionalString),
  sort_order: z.any().optional().transform((value) => (
    value === undefined ? undefined : normalizeLibraryRouteSortOrder(value)
  )),
}).strict();

export const libraryUpdateOutfitPayloadSchema = z.object({
  name: z.any().optional(),
  tags: z.array(z.string()).optional().transform((value) => (
    value === undefined ? undefined : normalizeLibraryRouteTags(value)
  )),
}).strict();

export const libraryUpdateActionPayloadSchema = z.object({
  name: z.any().optional(),
  tags: z.array(z.string()).optional().transform((value) => (
    value === undefined ? undefined : normalizeLibraryRouteTags(value)
  )),
  prompt: z.any().optional().transform(normalizePrompt),
}).strict();

export const libraryImportEntriesPayloadSchema = z.object({
  entries: z.array(z.any()).min(1, "No rows selected for import"),
}).strict();

export const libraryActionImportPreviewPayloadSchema = z.object({
  source_path: z.string().transform((value) => String(value || "").trim()).pipe(z.string().min(1, "source_path is required")),
}).strict();
