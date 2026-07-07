import type { ActionEntry } from "./types";

export interface ActionFolderImportIssue {
  code: string;
  message: string;
}

export type ActionFolderImportRowStatus =
  | "ready"
  | "missing_image"
  | "missing_text"
  | "duplicate_name"
  | "invalid_name"
  | "ambiguous_image"
  | "unreadable"
  | "warning";

export type ActionFolderImportFinalStatus = "imported" | "not_selected" | "failed" | "warning";

export interface ActionFolderImportRow {
  id: string;
  stem: string;
  filename: string;
  relative_path: string;
  image_path: string | null;
  text_path: string | null;
  proposed_name: string;
  thumbnail_url?: string;
  selectable: boolean;
  selected: boolean;
  status: ActionFolderImportRowStatus;
  errors: ActionFolderImportIssue[];
  warnings: ActionFolderImportIssue[];
}

export interface ActionFolderImportPreview {
  preview_id: string;
  source_path: string;
  project_id: string;
  total_images: number;
  total_text_files: number;
  ready_count: number;
  selected_count: number;
  blocking_error_count: number;
  warning_count: number;
  rows: ActionFolderImportRow[];
}

export interface ActionFolderImportResultRow extends ActionFolderImportRow {
  final_status: ActionFolderImportFinalStatus;
  action_id?: string;
}

export interface ActionFolderImportResult {
  imported_count: number;
  failed_count: number;
  imported: ActionEntry[];
  not_selected: ActionFolderImportResultRow[];
  failed: ActionFolderImportResultRow[];
  rows: ActionFolderImportResultRow[];
}

export interface ActionFolderImportUploadEntry {
  id?: string;
  stem?: string;
  name?: string;
  filename: string;
  relative_path: string;
  mime_type: string;
  data: string;
  prompt: string;
  tags?: string[];
  warnings: ActionFolderImportIssue[];
  thumbnail_url?: string;
}
