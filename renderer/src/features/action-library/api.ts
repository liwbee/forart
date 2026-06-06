import { apiRequest } from "../../lib/apiClient";
import { ActionEntry, ActionFilters, ActionProject, ActionTag, AssetUploadPayload, StorageSettings } from "./types";

export const actionLibraryKeys = {
  projects: ["actionProjects"] as const,
  tags: ["actionTags"] as const,
  actions: (projectId: string, tagId = "") => ["actions", projectId, tagId] as const,
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

export function listActionProjects() {
  return apiRequest<{ projects: ActionProject[] }>("/api/action-projects");
}

export function createActionProject(name: string) {
  return apiRequest<ActionProject>("/api/action-projects", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function updateActionProject(projectId: string, payload: Partial<Pick<ActionProject, "name" | "cover_asset_id">>) {
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

export function listActions({ projectId, tagId = "" }: ActionFilters) {
  return apiRequest<{ actions: ActionEntry[] }>(
    `/api/action-projects/${encodeURIComponent(projectId)}/actions${queryString({ tag_id: tagId })}`
  );
}

export function createAction(projectId: string, payload: AssetUploadPayload) {
  return apiRequest<ActionEntry>(`/api/action-projects/${encodeURIComponent(projectId)}/actions`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateAction(actionId: string, payload: Partial<Pick<ActionEntry, "prompt" | "tags">>) {
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

export function replaceActionImage(actionId: string, payload: AssetUploadPayload) {
  return apiRequest<ActionEntry>(`/api/actions/${encodeURIComponent(actionId)}/image/upload`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listActionTags() {
  return apiRequest<{ tags: ActionTag[] }>("/api/libraries/action/tags");
}

export function createActionTag(name: string) {
  return apiRequest<ActionTag>("/api/libraries/action/tags", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function updateActionTag(tagId: string, payload: Partial<Pick<ActionTag, "name" | "sort_order">>) {
  return apiRequest<ActionTag>(`/api/libraries/action/tags/${encodeURIComponent(tagId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteActionTag(tagId: string) {
  return apiRequest<{ ok: true }>(`/api/libraries/action/tags/${encodeURIComponent(tagId)}`, {
    method: "DELETE",
  });
}

export function getStorageSettings() {
  return apiRequest<StorageSettings>("/api/settings/storage");
}
