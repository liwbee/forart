import { apiRequest } from "../../lib/apiClient";
import { EMPTY_LIBRARY_TAG_FILTER, libraryTagFilterKey, type LibraryTagFilter } from "../library-tags";
import { ActionEntry, ActionFilters, ActionProject, ActionTag, AssetUploadPayload, LibraryBulkEntriesPayload, LibraryBulkEntriesResult, StorageSettings } from "./types";
import type { ActionFolderImportResult, ActionFolderImportUploadEntry } from "./actionFolderImportTypes";

export const actionLibraryKeys = {
  projects: ["actionProjects"] as const,
  tagRoot: ["actionTags"] as const,
  tags: (projectId: string) => ["actionTags", projectId] as const,
  actions: (projectId: string, tagFilter: LibraryTagFilter = EMPTY_LIBRARY_TAG_FILTER) => ["actions", projectId, libraryTagFilterKey(tagFilter)] as const,
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

export function listActionProjects() {
  return apiRequest<{ projects: ActionProject[] }>("/api/action-projects");
}

export function createActionProject(name: string) {
  return apiRequest<ActionProject>("/api/action-projects", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function updateActionProject(projectId: string, payload: Partial<Pick<ActionProject, "name" | "cover_asset_id" | "sort_order">>) {
  return apiRequest<ActionProject>(`/api/action-projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteActionProject(projectId: string) {
  return apiRequest<{ ok: true }>(`/api/action-projects/${encodeURIComponent(projectId)}`, {
    method: "DELETE",
  });
}

export function uploadActionProjectCover(projectId: string, payload: AssetUploadPayload) {
  return apiRequest<ActionProject>(`/api/action-projects/${encodeURIComponent(projectId)}/cover/upload`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listActions({ projectId, tagFilter = EMPTY_LIBRARY_TAG_FILTER }: ActionFilters) {
  return apiRequest<{ actions: ActionEntry[] }>(
    `/api/action-projects/${encodeURIComponent(projectId)}/actions${queryString({ tag_id: tagFilter.includeTagIds, exclude_tag_id: tagFilter.excludeTagIds, untagged: tagFilter.untaggedOnly ? "1" : "" })}`
  );
}

export function importActionEntries(projectId: string, entries: ActionFolderImportUploadEntry[]) {
  return apiRequest<ActionFolderImportResult>(`/api/action-projects/${encodeURIComponent(projectId)}/actions/import-entries`, {
    method: "POST",
    body: JSON.stringify({ entries }),
  });
}

export function updateAction(actionId: string, payload: Partial<Pick<ActionEntry, "name" | "prompt" | "tags">>) {
  return apiRequest<ActionEntry>(`/api/actions/${encodeURIComponent(actionId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteAction(actionId: string) {
  return apiRequest<{ ok: true }>(`/api/actions/${encodeURIComponent(actionId)}`, {
    method: "DELETE",
  });
}

export function bulkActionEntries(payload: LibraryBulkEntriesPayload) {
  return apiRequest<LibraryBulkEntriesResult>("/api/libraries/action/entries/bulk", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function replaceActionImage(actionId: string, payload: AssetUploadPayload) {
  return apiRequest<ActionEntry>(`/api/actions/${encodeURIComponent(actionId)}/image/upload`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listActionTags(projectId: string) {
  return apiRequest<{ tags: ActionTag[] }>(`/api/libraries/action/tags${queryString({ project_id: projectId })}`);
}

export function createActionTag(projectId: string, name: string, color?: ActionTag["color"]) {
  return apiRequest<ActionTag>(`/api/libraries/action/tags${queryString({ project_id: projectId })}`, {
    method: "POST",
    body: JSON.stringify({ name, ...(color ? { color } : {}) }),
  });
}

export function updateActionTag(projectId: string, tagId: string, payload: Partial<Pick<ActionTag, "name" | "sort_order" | "color">>) {
  return apiRequest<ActionTag>(`/api/libraries/action/tags/${encodeURIComponent(tagId)}${queryString({ project_id: projectId })}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteActionTag(projectId: string, tagId: string) {
  return apiRequest<{ ok: true }>(`/api/libraries/action/tags/${encodeURIComponent(tagId)}${queryString({ project_id: projectId })}`, {
    method: "DELETE",
  });
}

export function getStorageSettings() {
  return apiRequest<StorageSettings>("/api/settings/storage");
}
