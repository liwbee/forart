import { apiRequest } from "../../lib/apiClient";
import type { ActionFolderImportPreview, ActionFolderImportResult, ActionFolderImportUploadEntry } from "./actionFolderImportTypes";

export function previewActionFolderImport(projectId: string, sourcePath: string) {
  return apiRequest<ActionFolderImportPreview>(`/api/action-projects/${encodeURIComponent(projectId)}/actions/import-folder/preview`, {
    method: "POST",
    body: JSON.stringify({ source_path: sourcePath }),
  });
}

export function importActionFolder(projectId: string, sourcePath: string, selectedRows: string[]) {
  return apiRequest<ActionFolderImportResult>(`/api/action-projects/${encodeURIComponent(projectId)}/actions/import-folder`, {
    method: "POST",
    body: JSON.stringify({ source_path: sourcePath, selected_rows: selectedRows }),
  });
}

export function importActionEntries(projectId: string, entries: ActionFolderImportUploadEntry[]) {
  return apiRequest<ActionFolderImportResult>(`/api/action-projects/${encodeURIComponent(projectId)}/actions/import-entries`, {
    method: "POST",
    body: JSON.stringify({ entries }),
  });
}
