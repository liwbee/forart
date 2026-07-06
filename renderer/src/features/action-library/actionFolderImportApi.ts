import { apiRequest } from "../../lib/apiClient";
import type { ActionFolderImportPreview, ActionFolderImportResult, ActionFolderImportUploadEntry } from "./actionFolderImportTypes";
export { importActionEntries } from "./api";

export function previewActionFolderImport(projectId: string, sourcePath: string) {
  return apiRequest<ActionFolderImportPreview>(`/api/action-projects/${encodeURIComponent(projectId)}/actions/import-folder/preview`, {
    method: "POST",
    body: JSON.stringify({ source_path: sourcePath }),
  });
}
