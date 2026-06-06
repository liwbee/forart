export type ModelGender = "female" | "male" | "unknown";

export interface ModelProject {
  id: string;
  name: string;
  cover_asset_id: string | null;
  cover_url: string | null;
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
  created_at: string;
  updated_at: string;
}

export interface ModelImage {
  id: string;
  model_id: string;
  asset_id: string;
  asset_url: string | null;
  caption: string;
  sort_order: number;
  created_at: string;
  mime_type?: string | null;
  filename?: string | null;
}

export interface ModelTag {
  id: string;
  kind: "model";
  project_id: string | null;
  name: string;
  color: string;
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

export interface ModelFilters {
  projectId: string;
  tagId?: string;
  gender?: Exclude<ModelGender, "unknown"> | "";
}

export interface StorageSettings {
  configured: boolean;
  data_dir: string;
  database_path: string;
  library_dir: string;
  config_path: string;
}
