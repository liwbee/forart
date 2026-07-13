import { apiRequest } from "../../lib/apiClient";
import { EMPTY_LIBRARY_TAG_FILTER, libraryTagFilterKey, type LibraryTagFilter } from "../library-tags";
import { LibraryBulkEntriesPayload, LibraryBulkEntriesResult, OutfitEntry, OutfitFilters, OutfitImportEntry, OutfitImportResult, OutfitProject, OutfitTag, StorageSettings } from "./types";

export const outfitLibraryKeys = {
  projects: ["outfitProjects"] as const,
  tagRoot: ["outfitTags"] as const,
  tags: (projectId: string) => ["outfitTags", projectId] as const,
  outfits: (projectId: string, tagFilter: LibraryTagFilter = EMPTY_LIBRARY_TAG_FILTER) => ["outfits", projectId, libraryTagFilterKey(tagFilter)] as const,
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

export function listOutfitProjects() {
  return apiRequest<{ projects: OutfitProject[] }>("/api/outfit-projects");
}

export function createOutfitProject(name: string) {
  return apiRequest<OutfitProject>("/api/outfit-projects", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function updateOutfitProject(projectId: string, payload: Partial<Pick<OutfitProject, "name" | "cover_asset_id" | "sort_order">>) {
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

export function listOutfits({ projectId, tagFilter = EMPTY_LIBRARY_TAG_FILTER }: OutfitFilters) {
  return apiRequest<{ outfits: OutfitEntry[] }>(
    `/api/outfit-projects/${encodeURIComponent(projectId)}/outfits${queryString({ tag_id: tagFilter.includeTagIds, exclude_tag_id: tagFilter.excludeTagIds, untagged: tagFilter.untaggedOnly ? "1" : "" })}`
  );
}

export function importOutfitEntries(projectId: string, entries: OutfitImportEntry[]) {
  return apiRequest<OutfitImportResult>(`/api/outfit-projects/${encodeURIComponent(projectId)}/outfits/import-entries`, {
    method: "POST",
    body: JSON.stringify({ entries }),
  });
}

export function updateOutfit(outfitId: string, payload: Partial<Pick<OutfitEntry, "name" | "tags">>) {
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

export function bulkOutfitEntries(payload: LibraryBulkEntriesPayload) {
  return apiRequest<LibraryBulkEntriesResult>("/api/libraries/outfit/entries/bulk", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listOutfitTags(projectId: string) {
  return apiRequest<{ tags: OutfitTag[] }>(`/api/libraries/outfit/tags${queryString({ project_id: projectId })}`);
}

export function createOutfitTag(projectId: string, name: string, color?: OutfitTag["color"]) {
  return apiRequest<OutfitTag>(`/api/libraries/outfit/tags${queryString({ project_id: projectId })}`, {
    method: "POST",
    body: JSON.stringify({ name, ...(color ? { color } : {}) }),
  });
}

export function updateOutfitTag(projectId: string, tagId: string, payload: Partial<Pick<OutfitTag, "name" | "sort_order" | "color">>) {
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
