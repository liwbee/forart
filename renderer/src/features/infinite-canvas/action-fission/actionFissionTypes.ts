import type { CanvasGenerationTask, CanvasNode } from "../types";

export const MAX_ACTION_FISSION_ROWS = 15;
export const DEFAULT_ACTION_FISSION_VISIBLE_ROWS = 4;
export const BASE_PUBLIC_REFERENCE_LIMIT = 6;

export type ActionFissionResolution = NonNullable<CanvasNode["imageResolution"]>;
export type ActionFissionAspectRatio = NonNullable<CanvasNode["imageAspectRatio"]>;

export interface ActionFissionRow {
  id: string;
  actionProjectId: string;
  actionTagIds: string[];
  selectedActionId?: string;
  selectedActionName?: string;
  selectedActionPrompt?: string;
  selectedActionTags?: string[];
  selectedActionAssetUrl?: string | null;
  resultUrl?: string;
  resultFileName?: string;
  resultWidth?: number;
  resultHeight?: number;
  resultDownloadState?: "pending" | "downloaded";
  resultDownloadedAt?: number;
  error?: string;
  libtvQueued?: boolean;
  libtvRunning?: boolean;
  generationTask?: CanvasGenerationTask;
}

export interface ActionFissionState {
  rows: ActionFissionRow[];
  apiType?: "third-party-api" | "libtv-api";
  providerId?: string;
  model?: string;
  libtvWorkspaceId?: string;
  libtvWorkspaceName?: string;
  libtvModelName?: string;
  libtvProjectUuid?: string;
  libtvProjectName?: string;
  libtvGroupNodeId?: string;
  libtvGroupTitle?: string;
  resolution?: ActionFissionResolution;
  aspectRatio?: ActionFissionAspectRatio;
  running?: boolean;
  status?: string;
  error?: string;
}
