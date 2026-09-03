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

function lexicalTextNode(text: string): NativeImagePromptSerializedNode {
  return {
    type: "text",
    version: 1,
    text,
    detail: 0,
    format: 0,
    mode: "normal",
    style: "",
  };
}

function lexicalParagraphNode(children: NativeImagePromptSerializedNode[]): NativeImagePromptSerializedNode {
  return {
    type: "paragraph",
    version: 1,
    children,
    direction: null,
    format: "",
    indent: 0,
    textFormat: 0,
    textStyle: "",
  };
}

function lexicalRootNode(children: NativeImagePromptSerializedNode[]): NativeImagePromptSerializedNode {
  return {
    type: "root",
    version: 1,
    children,
    direction: null,
    format: "",
    indent: 0,
  };
}

function referenceAliases(index: number) {
  const ordinal = Math.max(0, index) + 1;
  const chinese = formatImageReferenceLabel(index, "zh-CN");
  return new Set([
    `@${chinese}`,
    `@图${ordinal}`,
    `@Image ${ordinal}`,
    `@image${ordinal}`,
  ].map((value) => value.toLowerCase()));
}

/** Convert Agent-emitted @图一/@图二 tokens into durable Lexical image refs. */
export function imagePromptDocumentFromReferenceText(
  prompt: string,
  references: ImageGeneratorReferenceInput[],
) {
  const source = String(prompt || "");
  if (!references.length || !source) return undefined;
  const aliases = references.map((_, index) => referenceAliases(index));
  const tokenPattern = /@(图(?:[零一二三四五六七八九十百]+|\d+)|Image\s+\d+|image\d+)/gi;
  let found = false;
  const children = source.split(/\n/).map((line) => {
    const paragraphChildren: NativeImagePromptSerializedNode[] = [];
    let cursor = 0;
    for (const match of line.matchAll(tokenPattern)) {
      const token = match[0];
      const start = match.index || 0;
      if (start > cursor) paragraphChildren.push(lexicalTextNode(line.slice(cursor, start)));
      const referenceIndex = aliases.findIndex((set) => set.has(token.toLowerCase()));
      if (referenceIndex < 0) {
        paragraphChildren.push(lexicalTextNode(token));
      } else {
        paragraphChildren.push({ type: "image-reference", version: 1, edgeId: references[referenceIndex].edgeId });
        found = true;
      }
      cursor = start + token.length;
    }
    if (cursor < line.length) paragraphChildren.push(lexicalTextNode(line.slice(cursor)));
    return lexicalParagraphNode(paragraphChildren);
  });
  return found ? { root: lexicalRootNode(children) } : undefined;
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

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeSerializedNode(value: unknown): NativeImagePromptSerializedNode | undefined {
  if (!isSerializedNode(value)) return undefined;
  const source = value as NativeImagePromptSerializedNode;
  const children = Array.isArray(source.children)
    ? source.children.map(normalizeSerializedNode).filter((node): node is NativeImagePromptSerializedNode => Boolean(node))
    : [];
  if (source.type === "root") {
    return {
      ...source,
      type: "root",
      version: 1,
      children,
      direction: source.direction === "ltr" || source.direction === "rtl" ? source.direction : null,
      format: typeof source.format === "string" ? source.format : "",
      indent: finiteNumber(source.indent, 0),
    };
  }
  if (source.type === "paragraph") {
    return {
      ...source,
      type: "paragraph",
      version: 1,
      children,
      direction: source.direction === "ltr" || source.direction === "rtl" ? source.direction : null,
      format: typeof source.format === "string" ? source.format : "",
      indent: finiteNumber(source.indent, 0),
      textFormat: finiteNumber(source.textFormat, 0),
      textStyle: typeof source.textStyle === "string" ? source.textStyle : "",
    };
  }
  if (source.type === "text") {
    return {
      ...source,
      type: "text",
      version: 1,
      text: String(source.text || ""),
      detail: finiteNumber(source.detail, 0),
      format: finiteNumber(source.format, 0),
      mode: source.mode === "token" || source.mode === "segmented" ? source.mode : "normal",
      style: typeof source.style === "string" ? source.style : "",
    };
  }
  if (source.type === "image-reference") {
    return { ...source, type: "image-reference", version: 1, edgeId: String(source.edgeId || "") };
  }
  return { ...source, version: finiteNumber(source.version, 1), ...(Array.isArray(source.children) ? { children } : {}) };
}

export function normalizeImagePromptDocument(value: unknown): NativeImagePromptDocument | undefined {
  if (!value || typeof value !== "object") return undefined;
  const root = normalizeSerializedNode((value as { root?: unknown }).root);
  return root?.type === "root" ? { root } : undefined;
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
