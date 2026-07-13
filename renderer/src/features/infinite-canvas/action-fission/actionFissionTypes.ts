import type { NativeGenerationTask } from "../nativeCanvas";
import type { LibtvGenerationTask } from "../../../app/appConfig";

export const MAX_ACTION_FISSION_ROWS = 15;
export const DEFAULT_ACTION_FISSION_ROWS = 4;

export type ActionFissionLayout = "list" | "grid";

export interface ActionFissionRow {
  id: string;
  actionProjectId: string;
  includeActionTagIds: string[];
  excludeActionTagIds: string[];
  selectedActionId?: string;
  selectedActionName?: string;
  selectedActionPrompt?: string;
  selectedActionTags?: string[];
  selectedActionAssetUrl?: string | null;
  selectedActionThumbUrl?: string | null;
  resultUrl?: string;
  resultThumbUrl?: string;
  resultFileName?: string;
  resultWidth?: number;
  resultHeight?: number;
  resultDownloadState?: "pending" | "downloaded";
  resultDownloadedAt?: number;
  error?: string;
  libtvQueued?: boolean;
  libtvRunning?: boolean;
  libtvTask?: LibtvGenerationTask;
  generationTask?: NativeGenerationTask;
  generationTaskId?: string;
  generationRemoteTaskId?: string;
  libtvTaskId?: string;
  libtvProjectUuid?: string;
  libtvRemoteNodeId?: string;
}

export interface ActionFissionState {
  rows: ActionFissionRow[];
  layout?: ActionFissionLayout;
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
  resolution?: string;
  aspectRatio?: string;
  status?: string;
  error?: string;
}
