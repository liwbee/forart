import type { LibraryTagColor, LibraryTagFilter } from "../library-tags";

export type ModelGender = "female" | "male" | "unknown";

export interface ModelProject {
  id: string;
  name: string;
  cover_asset_id: string | null;
  cover_url: string | null;
  cover_thumbnail_url?: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ModelEntry {
  id: string;
  project_id: string;
  name: string;
  code: string;
  gender: ModelGender;
  tags: string[];
  cover_image_id: string | null;
  cover_asset_id: string | null;
  cover_url: string | null;
  cover_thumbnail_url?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ModelImage {
  id: string;
  model_id: string;
  asset_id: string;
  asset_url: string | null;
  thumbnail_url?: string | null;
  caption: string;
  sort_order: number;
  created_at: string;
  mime_type?: string | null;
  filename?: string | null;
}

export interface ModelTag {
  id: string;
  kind: "model";
  project_id: string;
  name: string;
  color: LibraryTagColor;
  sort_order: number;
  usage_count: number;
  created_at: string;
  updated_at: string;
}

export interface AssetUploadPayload {
  filename: string;
  mime_type: string;
  data: string;
  thumbnail_data_url?: string;
}

export interface ModelImportImage {
  filename: string;
  mime_type: string;
  data: string;
  thumbnail_data_url?: string;
  caption?: string;
  sort_order?: number;
}

export interface ModelImportEntry {
  id?: string;
  stem?: string;
  name?: string;
  gender?: ModelGender;
  tags?: string[];
  images?: ModelImportImage[];
  cover_index?: number;
  filename?: string;
  relative_path?: string;
  mime_type?: string;
  data?: string;
  caption?: string;
  warnings?: Array<{ code: string; message: string }>;
  thumbnail_url?: string;
}

export interface ModelImportResultRow {
  id: string;
  stem: string;
  filename: string;
  relative_path: string;
  proposed_name: string;
  gender: ModelGender;
  thumbnail_url: string;
  selectable: true;
  selected: true;
  status: "ready";
  errors: Array<{ code: string; message: string }>;
  warnings: Array<{ code: string; message: string }>;
  final_status: "imported" | "failed" | "warning";
  model_id?: string;
}

export interface ModelImportResult {
  imported_count: number;
  failed_count: number;
  imported: ModelEntry[];
  not_selected: [];
  failed: ModelImportResultRow[];
  rows: ModelImportResultRow[];
}

export interface ModelFilters {
  projectId: string;
  tagFilter?: LibraryTagFilter;
  gender?: Exclude<ModelGender, "unknown"> | "";
}

export interface StorageSettings {
  configured: boolean;
}

export type LibraryBulkOperation = "delete" | "add_tags" | "remove_tags";

export interface LibraryBulkEntriesPayload {
  project_id: string;
  entry_ids: string[];
  operation: LibraryBulkOperation;
  tags?: string[];
}

export interface LibraryBulkEntriesResult {
  ok: true;
  kind: "model";
  operation: LibraryBulkOperation;
  project_id: string;
  requested: number;
  updated: number;
  deleted: number;
  skipped: string[];
  tags?: ModelTag[];
}
