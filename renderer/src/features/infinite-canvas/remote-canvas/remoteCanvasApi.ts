import { getApiBaseUrl } from "../../../data-source/runtime";
import { apiRequest } from "../../../lib/apiClient";
import type { RemoteCanvasListOptions, RemoteCanvasManifest, RemoteCanvasProject, RemoteCanvasUploadResult, RemoteCanvasWarning, ServerCanvasDocument } from "./remoteCanvasTypes";

function buildQuery(params: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  const text = query.toString();
  return text ? `?${text}` : "";
}

function resolveApiUrl(path: string) {
  const apiBaseUrl = getApiBaseUrl();
  if (!apiBaseUrl) return path;
  return `${apiBaseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cloneWithResolvedRemoteAssetUrls<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneWithResolvedRemoteAssetUrls(item)) as T;
  if (!isRecord(value)) {
    if (typeof value === "string" && value.startsWith("/api/canvas-exchange/")) {
      return resolveApiUrl(value) as T;
    }
    return value;
  }
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    next[key] = cloneWithResolvedRemoteAssetUrls(item);
  }
  return next as T;
}

export async function listRemoteCanvasProjects(): Promise<RemoteCanvasProject[]> {
  const result = await apiRequest<{ projects: RemoteCanvasProject[] }>("/api/canvas-exchange/projects");
  return result.projects || [];
}

export async function createRemoteCanvasProject(title: string): Promise<RemoteCanvasProject> {
  const result = await apiRequest<{ project: RemoteCanvasProject }>("/api/canvas-exchange/projects", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
  return result.project;
}

export async function renameRemoteCanvasProject(projectId: string, title: string): Promise<RemoteCanvasProject> {
  const result = await apiRequest<{ project: RemoteCanvasProject }>(`/api/canvas-exchange/projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
  return result.project;
}

export async function deleteRemoteCanvasProject(projectId: string): Promise<{ deletedCanvasIds: string[] }> {
  return apiRequest(`/api/canvas-exchange/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
}

export async function listRemoteCanvases(options: RemoteCanvasListOptions = {}): Promise<RemoteCanvasManifest[]> {
  const result = await apiRequest<{ canvases: RemoteCanvasManifest[] }>(`/api/canvas-exchange/canvases${buildQuery({
    project_id: options.projectId,
    search: options.search,
    sort: options.sort,
  })}`);
  return result.canvases || [];
}

export async function loadRemoteCanvas(remoteCanvasId: string): Promise<ServerCanvasDocument> {
  const canvas = await apiRequest<ServerCanvasDocument>(`/api/canvas-exchange/canvases/${encodeURIComponent(remoteCanvasId)}`);
  return cloneWithResolvedRemoteAssetUrls(canvas);
}

export async function uploadRemoteCanvasPackage(packageFilePath: string, projectId: string): Promise<RemoteCanvasUploadResult> {
  if (!window.easyTool?.uploadCanvasPackageToRemote) throw new Error("Remote package upload bridge is unavailable.");
  const result = await window.easyTool.uploadCanvasPackageToRemote({
    filePath: packageFilePath,
    uploadUrl: resolveApiUrl(`/api/canvas-exchange/canvases${buildQuery({ project_id: projectId })}`),
  }) as { canvas: RemoteCanvasManifest; warnings?: unknown[] };
  return {
    canvas: result.canvas,
    warnings: Array.isArray(result.warnings) ? result.warnings as RemoteCanvasWarning[] : [],
  };
}

export async function downloadRemoteCanvasPackage(remoteCanvasId: string): Promise<{ filePath: string }> {
  if (!window.easyTool?.downloadCanvasPackageFromRemote) throw new Error("Remote package download bridge is unavailable.");
  return window.easyTool.downloadCanvasPackageFromRemote({
    downloadUrl: resolveApiUrl(`/api/canvas-exchange/canvases/${encodeURIComponent(remoteCanvasId)}/package`),
  });
}

export async function deleteRemoteCanvas(remoteCanvasId: string): Promise<void> {
  await apiRequest(`/api/canvas-exchange/canvases/${encodeURIComponent(remoteCanvasId)}`, { method: "DELETE" });
}
