import type { ImageGeneratorReferenceInput } from "../generation/imageGenerationInputs";
import type { ActionFissionRow } from "./actionFissionTypes";

export interface ActionFissionAgentReference {
  /** 稳定 id：主参考与附加参考分别编号，与传给模型的图片顺序一致。 */
  id: string;
  imageUrl: string;
  title: string;
  role: "primary" | "additional";
}

export interface ActionFissionAgentRowInput {
  rowId: string;
  /** 该行开关打开的附加参考图 id；关掉时为空数组。 */
  additionalReferenceIds: string[];
}

export interface ActionFissionAgentPromptContext {
  instruction?: string;
  referenceImages: ActionFissionAgentReference[];
  rows: ActionFissionAgentRowInput[];
}

export interface ActionFissionAgentPromptPatch {
  rowId: string;
  agentPrompt: string;
  agentPromptLabel?: string;
  agentWarnings?: string[];
}

export interface ActionFissionAgentPromptResult {
  patches: ActionFissionAgentPromptPatch[];
  /** 模型没有返回提示词的行，用于提示用户重试。 */
  missingRowIds: string[];
}

function primaryReferenceId(index: number) {
  return `primary_${index + 1}`;
}

function additionalReferenceId(index: number) {
  return `additional_${index + 1}`;
}

/**
 * 摘要规范：「动作·构图或角度」，例如「单手插兜·全身侧面」。
 * 统一分隔符并去掉多余空白与句末标点，避免卡片上出现「单手插兜 · 全身侧面。」这类写法。
 */
export function normalizeActionFissionAgentPromptLabel(value: unknown) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*[·•・]\s*/g, "·")
    .replace(/^[·•・。.，,；;\s]+/, "")
    .replace(/[·•・。.，,；;\s]+$/, "")
    .trim();
}

/**
 * 组装 Agent 模式生成提示词的上下文。
 *
 * 参考图全部传给模型（不做数量截断），同时把每一行用到的附加参考图 id 一并带上，
 * 让模型知道「第 3 行只用了 @图四」这类关系。空 URL 的参考会被丢弃，
 * 保证这里的顺序与主进程 `resolveImageParts` 发送图片的顺序一致。
 */
export function buildActionFissionAgentPromptContext({
  rows,
  primaryReferences,
  additionalReferences,
  instruction,
}: {
  rows: readonly ActionFissionRow[];
  primaryReferences: readonly ImageGeneratorReferenceInput[];
  additionalReferences: readonly ImageGeneratorReferenceInput[];
  instruction?: string;
}): ActionFissionAgentPromptContext {
  const toReference = (
    reference: ImageGeneratorReferenceInput,
    index: number,
    role: ActionFissionAgentReference["role"],
  ): ActionFissionAgentReference | null => {
    const imageUrl = String(reference.imageUrl || "").trim();
    if (!imageUrl) return null;
    return {
      id: role === "primary" ? primaryReferenceId(index) : additionalReferenceId(index),
      imageUrl,
      title: String(reference.title || "").trim(),
      role,
    };
  };
  const referenceImages = [
    ...primaryReferences.map((reference, index) => toReference(reference, index, "primary")),
    ...additionalReferences.map((reference, index) => toReference(reference, index, "additional")),
  ].filter((reference): reference is ActionFissionAgentReference => Boolean(reference));
  const additionalReferenceIds = referenceImages
    .filter((reference) => reference.role === "additional")
    .map((reference) => reference.id);
  const normalizedInstruction = String(instruction || "").trim();
  return {
    ...(normalizedInstruction ? { instruction: normalizedInstruction } : {}),
    referenceImages,
    rows: rows.map((row) => ({
      rowId: row.id,
      additionalReferenceIds: row.useAdditionalReferences ? additionalReferenceIds : [],
    })),
  };
}

/**
 * 校验并归一化模型返回的提示词结果。
 *
 * 只接受请求过的行 id、非空提示词；重复行只取第一次出现的结果。
 */
export function normalizeActionFissionAgentPromptResult(
  raw: unknown,
  requestedRowIds: readonly string[],
): ActionFissionAgentPromptResult {
  const requested = requestedRowIds.map((rowId) => String(rowId));
  const requestedSet = new Set(requested);
  const source = raw && typeof raw === "object" ? (raw as { prompts?: unknown }).prompts : null;
  const patchesByRowId = new Map<string, ActionFissionAgentPromptPatch>();
  for (const item of Array.isArray(source) ? source : []) {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const rowId = String(record.rowId || "").trim();
    const agentPrompt = String(record.prompt || "").trim();
    if (!requestedSet.has(rowId) || !agentPrompt || patchesByRowId.has(rowId)) continue;
    const agentPromptLabel = normalizeActionFissionAgentPromptLabel(record.label);
    const agentWarnings = Array.isArray(record.warnings)
      ? record.warnings.map((warning) => String(warning || "").trim()).filter(Boolean)
      : [];
    patchesByRowId.set(rowId, {
      rowId,
      agentPrompt,
      ...(agentPromptLabel ? { agentPromptLabel } : {}),
      ...(agentWarnings.length ? { agentWarnings } : {}),
    });
  }
  return {
    patches: requested.flatMap((rowId) => {
      const patch = patchesByRowId.get(rowId);
      return patch ? [patch] : [];
    }),
    missingRowIds: requested.filter((rowId) => !patchesByRowId.has(rowId)),
  };
}
