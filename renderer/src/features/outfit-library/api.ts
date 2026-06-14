import { apiRequest } from "../../lib/apiClient";
import { AssetUploadPayload, OutfitEntry, OutfitFilters, OutfitProject, OutfitTag, StorageSettings } from "./types";

export const outfitLibraryKeys = {
  projects: ["outfitProjects"] as const,
  tagRoot: ["outfitTags"] as const,
  tags: (projectId: string) => ["outfitTags", projectId] as const,
  outfits: (projectId: string, tagId = "") => ["outfits", projectId, tagId] as const,
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

export function listOutfitProjects() {
  return apiRequest<{ projects: OutfitProject[] }>("/api/outfit-projects");
}

export function createOutfitProject(name: string) {
  return apiRequest<OutfitProject>("/api/outfit-projects", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function updateOutfitProject(projectId: string, payload: Partial<Pick<OutfitProject, "name" | "cover_asset_id">>) {
  return apiRequest<OutfitProject>(`/api/outfit-projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteOutfitProject(projectId: string) {
  return apiRequest<{ ok: true }>(`/api/outfit-projects/${encodeURIComponent(projectId)}`, {
    method: "DELETE",
  });
}

export function uploadOutfitProjectCover(projectId: string, payload: AssetUploadPayload) {
  return apiRequest<OutfitProject>(`/api/outfit-projects/${encodeURIComponent(projectId)}/cover/upload`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listOutfits({ projectId, tagId = "" }: OutfitFilters) {
  return apiRequest<{ outfits: OutfitEntry[] }>(
    `/api/outfit-projects/${encodeURIComponent(projectId)}/outfits${queryString({ tag_id: tagId })}`
  );
}

export function createOutfit(projectId: string, payload: AssetUploadPayload) {
  return apiRequest<OutfitEntry>(`/api/outfit-projects/${encodeURIComponent(projectId)}/outfits`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateOutfit(outfitId: string, payload: Partial<Pick<OutfitEntry, "tags">>) {
  return apiRequest<OutfitEntry>(`/api/outfits/${encodeURIComponent(outfitId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteOutfit(outfitId: string) {
  return apiRequest<{ ok: true }>(`/api/outfits/${encodeURIComponent(outfitId)}`, {
    method: "DELETE",
  });
}

export function replaceOutfitImage(outfitId: string, payload: AssetUploadPayload) {
  return apiRequest<OutfitEntry>(`/api/outfits/${encodeURIComponent(outfitId)}/image/upload`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listOutfitTags(projectId: string) {
  return apiRequest<{ tags: OutfitTag[] }>(`/api/libraries/outfit/tags${queryString({ project_id: projectId })}`);
}

export function createOutfitTag(projectId: string, name: string) {
  return apiRequest<OutfitTag>(`/api/libraries/outfit/tags${queryString({ project_id: projectId })}`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function updateOutfitTag(projectId: string, tagId: string, payload: Partial<Pick<OutfitTag, "name" | "sort_order">>) {
  return apiRequest<OutfitTag>(`/api/libraries/outfit/tags/${encodeURIComponent(tagId)}${queryString({ project_id: projectId })}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteOutfitTag(projectId: string, tagId: string) {
  return apiRequest<{ ok: true }>(`/api/libraries/outfit/tags/${encodeURIComponent(tagId)}${queryString({ project_id: projectId })}`, {
    method: "DELETE",
  });
}

export function getStorageSettings() {
  return apiRequest<StorageSettings>("/api/settings/storage");
}
