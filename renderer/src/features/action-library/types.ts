import type { LibraryTagColor, LibraryTagFilter } from "../library-tags";

export interface ActionProject {
  id: string;
  name: string;
  cover_asset_id: string | null;
  cover_url: string | null;
  cover_thumbnail_url?: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ActionEntry {
  id: string;
  project_id: string;
  name: string;
  asset_id: string;
  asset_url: string | null;
  thumbnail_url?: string | null;
  prompt: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface ActionTag {
  id: string;
  kind: "action";
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
}

export interface ActionFilters {
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
  kind: "action";
  operation: LibraryBulkOperation;
  project_id: string;
  requested: number;
  updated: number;
  deleted: number;
  skipped: string[];
  tags?: ActionTag[];
}
