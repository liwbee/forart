export const MAX_ACTION_FISSION_ROWS = 15;
export const DEFAULT_ACTION_FISSION_ROWS = 4;
export const MAX_ACTION_FISSION_CATEGORY_GROUPS = 10;

export type ActionFissionLayout = "list" | "grid";

export interface ActionFissionCategoryGroup {
  id: string;
  name?: string;
  actionProjectId: string;
  includeActionTagIds: string[];
  excludeActionTagIds: string[];
}

export interface ActionFissionRow {
  id: string;
  categoryGroups: ActionFissionCategoryGroup[];
  selectedCategoryGroupId?: string;
  useAdditionalReferences?: boolean;
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
  latestGenerationTaskId?: string;
}

export interface ActionFissionState {
  rows: ActionFissionRow[];
  layout?: ActionFissionLayout;
  apiType?: "third-party-api" | "libtv-api";
  providerId?: string;
  model?: string;
  libtvModelName?: string;
  resolution?: string;
  aspectRatio?: string;
}

export function actionFissionRowTaskId(row: ActionFissionRow) {
  return String(row.latestGenerationTaskId || "");
}
