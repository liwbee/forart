import type { LibraryTagFilter } from "../library-tags";

export interface ActionProject {
  id: string;
  name: string;
  cover_asset_id: string | null;
  cover_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface ActionEntry {
  id: string;
  project_id: string;
  name: string;
  asset_id: string;
  asset_url: string | null;
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
