import { apiRequest } from "../../lib/apiClient";
import { EMPTY_LIBRARY_TAG_FILTER, libraryTagFilterKey, type LibraryTagFilter } from "../library-tags";
import { AssetUploadPayload, ModelEntry, ModelFilters, ModelImage, ModelProject, ModelTag, StorageSettings } from "./types";

export const modelLibraryKeys = {
  projects: ["modelProjects"] as const,
  tagRoot: ["modelTags"] as const,
  tags: (projectId: string) => ["modelTags", projectId] as const,
  models: (projectId: string, tagFilter: LibraryTagFilter = EMPTY_LIBRARY_TAG_FILTER, gender = "") => ["models", projectId, libraryTagFilterKey(tagFilter), gender] as const,
  images: (modelId: string) => ["modelImages", modelId] as const,
  storageSettings: ["storageSettings"] as const,
};

function isStringArray(value: string | readonly string[] | undefined): value is readonly string[] {
  return Array.isArray(value);
}

function queryString(params: Record<string, string | readonly string[] | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (isStringArray(value)) {
      for (const item of value) {
        if (item) search.append(key, item);
      }
    } else if (value) {
      search.set(key, value);
    }
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export function listModelProjects() {
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

export function listModels({ projectId, tagFilter = EMPTY_LIBRARY_TAG_FILTER, gender = "" }: ModelFilters) {
  return apiRequest<{ models: ModelEntry[] }>(
    `/api/model-projects/${encodeURIComponent(projectId)}/models${queryString({ tag_id: tagFilter.includeTagIds, exclude_tag_id: tagFilter.excludeTagIds, gender })}`
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

export function listModelTags(projectId: string) {
  return apiRequest<{ tags: ModelTag[] }>(`/api/libraries/model/tags${queryString({ project_id: projectId })}`);
}

export function createModelTag(projectId: string, name: string) {
  return apiRequest<ModelTag>(`/api/libraries/model/tags${queryString({ project_id: projectId })}`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function updateModelTag(projectId: string, tagId: string, payload: Partial<Pick<ModelTag, "name" | "sort_order">>) {
  return apiRequest<ModelTag>(`/api/libraries/model/tags/${encodeURIComponent(tagId)}${queryString({ project_id: projectId })}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteModelTag(projectId: string, tagId: string) {
  return apiRequest<{ ok: true }>(`/api/libraries/model/tags/${encodeURIComponent(tagId)}${queryString({ project_id: projectId })}`, {
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
