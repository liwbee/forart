import type { NativeImagePromptDocument, NativeImagePromptSerializedNode } from "../nativeCanvas";
import type { ImageGeneratorReferenceInput } from "./imageGenerationInputs";

export interface ImagePromptReferenceLabels {
  instruction: (images: string) => string;
  requestHeader: string;
}

export interface ImageReferenceMentionQuery {
  start: number;
  length: number;
  query: string;
}

interface SerializePromptOptions {
  document?: NativeImagePromptDocument;
  fallbackPrompt?: string;
  references: ImageGeneratorReferenceInput[];
  referenceLabel: (index: number) => string;
  missingReferenceLabel?: string;
}

interface BuildRemotePromptOptions {
  document?: NativeImagePromptDocument;
  fallbackPrompt?: string;
  additionalPrompt?: string;
  references: ImageGeneratorReferenceInput[];
  labels: ImagePromptReferenceLabels;
}

function chineseOrdinal(value: number) {
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (value <= 10) return value === 10 ? "十" : digits[value];
  if (value < 20) return `十${digits[value % 10]}`;
  if (value < 100) return `${digits[Math.floor(value / 10)]}十${value % 10 ? digits[value % 10] : ""}`;
  return String(value);
}

export function formatImageReferenceLabel(index: number, language: string) {
  const ordinal = Math.max(0, index) + 1;
  return language.toLowerCase().startsWith("zh") ? `图${chineseOrdinal(ordinal)}` : `Image ${ordinal}`;
}

export function findImageReferenceMentionQuery(prefix: string): ImageReferenceMentionQuery | null {
  const match = String(prefix || "").match(/@([^@\s]*)$/);
  if (!match) return null;
  return {
    start: prefix.length - match[0].length,
    length: match[0].length,
    query: match[1],
  };
}

function isSerializedNode(value: unknown): value is NativeImagePromptSerializedNode {
  return Boolean(value && typeof value === "object" && typeof (value as { type?: unknown }).type === "string");
}

export function normalizeImagePromptDocument(value: unknown): NativeImagePromptDocument | undefined {
  if (!value || typeof value !== "object") return undefined;
  const root = (value as { root?: unknown }).root;
  return isSerializedNode(root) && root.type === "root" ? { root } : undefined;
}

function serializeChildren(
  children: NativeImagePromptSerializedNode[],
  serializeNode: (node: NativeImagePromptSerializedNode) => string,
  separator: string,
) {
  return children.map(serializeNode).join(separator);
}

function serializeDocument(
  document: NativeImagePromptDocument,
  resolveReference: (edgeId: string) => string,
) {
  const serializeNode = (node: NativeImagePromptSerializedNode): string => {
    if (node.type === "text") return String(node.text || "");
    if (node.type === "linebreak") return "\n";
    if (node.type === "image-reference") return resolveReference(String(node.edgeId || ""));
    const children = Array.isArray(node.children) ? node.children.filter(isSerializedNode) : [];
    return serializeChildren(children, serializeNode, node.type === "root" ? "\n" : "");
  };
  return serializeNode(document.root);
}

export function serializeImagePromptForDisplay({
  document,
  fallbackPrompt = "",
  references,
  referenceLabel,
  missingReferenceLabel = "",
}: SerializePromptOptions) {
  if (!document) return String(fallbackPrompt || "");
  const referenceIndexByEdgeId = new Map(references.map((reference, index) => [reference.edgeId, index]));
  return serializeDocument(document, (edgeId) => {
    const index = referenceIndexByEdgeId.get(edgeId);
    return index === undefined
      ? missingReferenceLabel ? `@${missingReferenceLabel}` : ""
      : `@${referenceLabel(index)}`;
  });
}

export function buildPromptWithImageReferenceDocument({
  document,
  fallbackPrompt = "",
  additionalPrompt = "",
  references,
  labels,
}: BuildRemotePromptOptions) {
  let hasReferenceToken = false;
  const referenceIndexByEdgeId = new Map(references.map((reference, index) => [reference.edgeId, index]));
  const prompt = document
    ? serializeDocument(document, (edgeId) => {
      const index = referenceIndexByEdgeId.get(edgeId);
      if (index === undefined) return "";
      hasReferenceToken = true;
      return `image${index + 1}`;
    })
    : String(fallbackPrompt || "");
  const userPrompt = [prompt.trim(), String(additionalPrompt || "").trim()].filter(Boolean).join("\n\n");
  if (!hasReferenceToken) return userPrompt;
  const imageIdentifiers = references.map((_, index) => `image${index + 1}`).join("、");
  return `${labels.instruction(imageIdentifiers)}\n\n${labels.requestHeader}\n${userPrompt}`;
}
