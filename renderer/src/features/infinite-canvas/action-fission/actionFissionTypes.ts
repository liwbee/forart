import { MAX_BATCH_NODE_ITEMS, type BatchNodeItemBase } from "../batch/batchNodeTypes";

export const MAX_ACTION_FISSION_ROWS = MAX_BATCH_NODE_ITEMS;
export const DEFAULT_ACTION_FISSION_ROWS = 4;
export const MAX_ACTION_FISSION_CATEGORY_GROUPS = 10;
/** Agent 模式专用的 Canvas Agent 任务名。 */
export const ACTION_FISSION_AGENT_TASK = "generate-action-fission-prompts";

/** 动作库模式（默认）与 Agent 模式。 */
export type ActionFissionMode = "library" | "agent";

export type ActionFissionAgentReasoning =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export const DEFAULT_ACTION_FISSION_AGENT_REASONING: ActionFissionAgentReasoning = "medium";
export const ACTION_FISSION_AGENT_REASONING_LEVELS: readonly ActionFissionAgentReasoning[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export interface ActionFissionCategoryGroup {
  id: string;
  name?: string;
  actionProjectId: string;
  includeActionTagIds: string[];
  excludeActionTagIds: string[];
}

export interface ActionFissionRow extends BatchNodeItemBase {
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
  /** Agent 模式：LLM 生成的完整提示词。 */
  agentPrompt?: string;
  /** Agent 模式：LLM 给出的差异摘要，卡片正面显示。 */
  agentPromptLabel?: string;
  /** Agent 模式：LLM 返回的提醒信息。 */
  agentWarnings?: string[];
}

export interface ActionFissionState {
  rows: ActionFissionRow[];
  /** 缺省视为 "library"，旧画布不需要迁移。 */
  mode?: ActionFissionMode;
  apiType?: "third-party-api" | "libtv-api";
  providerId?: string;
  model?: string;
  libtvModelName?: string;
  resolution?: string;
  aspectRatio?: string;
  /** Agent 模式：节点内选择的 LLM 平台与模型。 */
  agentProviderId?: string;
  agentModel?: string;
  agentReasoning?: ActionFissionAgentReasoning;
}

export function actionFissionRowTaskId(row: ActionFissionRow) {
  return String(row.latestGenerationTaskId || "");
}
