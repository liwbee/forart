import type { LibraryTagFilter } from "../library-tags";

export interface OutfitProject {
  id: string;
  name: string;
  cover_asset_id: string | null;
  cover_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface OutfitEntry {
  id: string;
  project_id: string;
  name: string;
  asset_id: string;
  asset_url: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface OutfitTag {
  id: string;
  kind: "outfit";
  project_id: string;
  name: string;
  sort_order: number;
  usage_count: number;
  created_at: string;
  updated_at: string;
}

export interface AssetUploadPayload {
  filename: string;
  mime_type: string;
  data: string;
}

export interface OutfitImportEntry {
  id?: string;
  stem?: string;
  name?: string;
  filename: string;
  relative_path?: string;
  mime_type: string;
  data: string;
  tags?: string[];
  warnings?: Array<{ code: string; message: string }>;
  thumbnail_url?: string;
}

export interface OutfitImportResultRow {
  id: string;
  stem: string;
  filename: string;
  relative_path: string;
  image_path: null;
  text_path: null;
  proposed_name: string;
  thumbnail_url: string;
  selectable: true;
  selected: true;
  status: "ready";
  errors: Array<{ code: string; message: string }>;
  warnings: Array<{ code: string; message: string }>;
  final_status: "imported" | "failed" | "warning";
  outfit_id?: string;
}

export interface OutfitImportResult {
  imported_count: number;
  failed_count: number;
  imported: OutfitEntry[];
  not_selected: [];
  failed: OutfitImportResultRow[];
  rows: OutfitImportResultRow[];
}

export interface OutfitFilters {
  projectId: string;
  tagFilter?: LibraryTagFilter;
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
  kind: "outfit";
  operation: LibraryBulkOperation;
  project_id: string;
  requested: number;
  updated: number;
  deleted: number;
  skipped: string[];
  tags?: OutfitTag[];
}
