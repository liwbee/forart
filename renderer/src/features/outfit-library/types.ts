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

export interface OutfitFilters {
  projectId: string;
  tagIds?: string[];
}

export interface StorageSettings {
  configured: boolean;
}
