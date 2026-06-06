import { apiRequest } from "../../lib/apiClient";
import { AssetUploadPayload, ModelEntry, ModelFilters, ModelImage, ModelProject, ModelTag, StorageSettings } from "./types";

const LEGACY_STORAGE_KEY = "forart_model_library_v1";
const LEGACY_MIGRATION_KEY = "forart_model_library_v1_migrated_to_disk";
let legacyMigrationPromise: Promise<void> | null = null;

export const modelLibraryKeys = {
  projects: ["modelProjects"] as const,
  tags: ["modelTags"] as const,
  models: (projectId: string, tagId = "", gender = "") => ["models", projectId, tagId, gender] as const,
  images: (modelId: string) => ["modelImages", modelId] as const,
  storageSettings: ["storageSettings"] as const,
};

function queryString(params: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

async function ensureLegacyMigration() {
  if (typeof window === "undefined") return;
  const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!legacy || window.localStorage.getItem(LEGACY_MIGRATION_KEY)) return;
  legacyMigrationPromise ??= apiRequest<{ ok: true }>("/api/model-library/import-legacy", {
    method: "POST",
    body: legacy,
  }).then(() => {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    window.localStorage.setItem(LEGACY_MIGRATION_KEY, new Date().toISOString());
  });
  await legacyMigrationPromise;
}

export async function listModelProjects() {
  await ensureLegacyMigration();
  return apiRequest<{ projects: ModelProject[] }>("/api/model-projects");
}

export function createModelProject(name: string) {
  return apiRequest<ModelProject>("/api/model-projects", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function updateModelProject(projectId: string, payload: Partial<Pick<ModelProject, "name" | "cover_asset_id">>) {
  return apiRequest<ModelProject>(`/api/model-projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteModelProject(projectId: string) {
  return apiRequest<{ ok: true }>(`/api/model-projects/${encodeURIComponent(projectId)}`, {
    method: "DELETE",
  });
}

export function uploadModelProjectCover(projectId: string, payload: AssetUploadPayload) {
  return apiRequest<ModelProject>(`/api/model-projects/${encodeURIComponent(projectId)}/cover/upload`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listModels({ projectId, tagId = "", gender = "" }: ModelFilters) {
  return apiRequest<{ models: ModelEntry[] }>(
    `/api/model-projects/${encodeURIComponent(projectId)}/models${queryString({ tag_id: tagId, gender })}`
  );
}

export function createModel(projectId: string, payload: Pick<ModelEntry, "name" | "gender">) {
  return apiRequest<ModelEntry>(`/api/model-projects/${encodeURIComponent(projectId)}/models`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateModel(modelId: string, payload: Partial<Pick<ModelEntry, "name" | "tags" | "cover_image_id">>) {
  return apiRequest<ModelEntry>(`/api/models/${encodeURIComponent(modelId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteModel(modelId: string) {
  return apiRequest<{ ok: true }>(`/api/models/${encodeURIComponent(modelId)}`, {
    method: "DELETE",
  });
}

export async function listModelTags() {
  await ensureLegacyMigration();
  return apiRequest<{ tags: ModelTag[] }>("/api/libraries/model/tags");
}

export function createModelTag(name: string) {
  return apiRequest<ModelTag>("/api/libraries/model/tags", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function updateModelTag(tagId: string, payload: Partial<Pick<ModelTag, "name" | "sort_order">>) {
  return apiRequest<ModelTag>(`/api/libraries/model/tags/${encodeURIComponent(tagId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteModelTag(tagId: string) {
  return apiRequest<{ ok: true }>(`/api/libraries/model/tags/${encodeURIComponent(tagId)}`, {
    method: "DELETE",
  });
}

export function listModelImages(modelId: string) {
  return apiRequest<{ images: ModelImage[] }>(`/api/models/${encodeURIComponent(modelId)}/images`);
}

export function uploadModelImage(modelId: string, payload: AssetUploadPayload) {
  return apiRequest<{ image: ModelImage; asset: { id: string } }>(`/api/models/${encodeURIComponent(modelId)}/images/upload`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function addModelImage(modelId: string, payload: Pick<ModelImage, "asset_id" | "caption" | "sort_order">) {
  return apiRequest<ModelImage>(`/api/models/${encodeURIComponent(modelId)}/images`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteModelImage(imageId: string) {
  return apiRequest<{ ok: true }>(`/api/model-images/${encodeURIComponent(imageId)}`, {
    method: "DELETE",
  });
}

export function getStorageSettings() {
  return apiRequest<StorageSettings>("/api/settings/storage");
}
