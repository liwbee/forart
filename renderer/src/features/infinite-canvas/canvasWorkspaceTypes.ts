import type { Viewport } from "@xyflow/react";
import {
  NATIVE_CANVAS_NODE_DEFINITIONS,
  type NativeCanvasEdge,
  type NativeCanvasNode,
  type NativeCanvasNodeKind,
} from "./nativeCanvas";
import { canvasSnapshotForStorage } from "./canvasSnapshotSemantics";

export interface CanvasRecord {
  id: string;
  title: string;
  projectId: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
  nodeCount: number;
}

export interface CanvasProjectRecord {
  id: string;
  title: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface CanvasDocumentTab {
  id: string;
  title: string;
  updatedAt: number;
  readOnly?: boolean;
  remoteCanvasId?: string;
}

export interface NativeCanvasSnapshot {
  nodes: NativeCanvasNode[];
  edges: NativeCanvasEdge[];
  viewport: Viewport;
}

export interface NativeCanvasDocument extends CanvasRecord, NativeCanvasSnapshot {
  canvasSchemaVersion: 2;
}

function timestampOf(value: unknown) {
  const numeric = Number(value || 0);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function recordOf(input: unknown): CanvasRecord | null {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const id = String(value.id || "");
  if (!id) return null;
  return {
    id,
    title: String(value.title || "Untitled canvas"),
    projectId: String(value.projectId || ""),
    createdAt: timestampOf(value.createdAt),
    updatedAt: timestampOf(value.updatedAt || value.uploadedAt || value.createdAt),
    revision: Math.max(1, Number(value.revision || 1)),
    nodeCount: Number(value.nodeCount || 0),
  };
}

export function normalizeCanvasRecord(input: unknown) {
  return recordOf(input);
}

export function normalizeCanvasProject(input: unknown): CanvasProjectRecord | null {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const id = String(value.id || "");
  if (!id) return null;
  return {
    id,
    title: String(value.title || "Untitled project"),
    sortOrder: Number(value.sortOrder || 0),
    createdAt: timestampOf(value.createdAt),
    updatedAt: timestampOf(value.updatedAt || value.createdAt),
  };
}

export function tabFromRecord(record: CanvasRecord): CanvasDocumentTab {
  return { id: record.id, title: record.title, updatedAt: record.updatedAt };
}

function isNodeKind(value: unknown): value is NativeCanvasNodeKind {
  return typeof value === "string" && value in NATIVE_CANVAS_NODE_DEFINITIONS;
}

function normalizeGeneratedImages(data: Record<string, unknown>) {
  const images = Array.isArray(data.generatedImages)
    ? data.generatedImages.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const result = item as Record<string, unknown>;
        const localUrl = String(result.localUrl || "");
        const url = String(result.url || "");
        if (!localUrl && !url) return [];
        return [{
          localUrl: localUrl || undefined,
          url: url || undefined,
          thumbUrl: String(result.thumbUrl || "") || undefined,
          fileName: String(result.fileName || "") || undefined,
          width: Number(result.width || 0) || undefined,
          height: Number(result.height || 0) || undefined,
          downloadState: result.downloadState === "downloaded" ? "downloaded" as const : "pending" as const,
          downloadedAt: Number(result.downloadedAt || 0) || undefined,
        }];
      })
    : [];
  return images;
}

function normalizeLibtvImageGeneration(input: unknown): NativeCanvasNode["data"]["libtvImageGeneration"] {
  if (!input || typeof input !== "object") return undefined;
  const source = input as Record<string, unknown>;
  const count = Number(source.count || 0);
  const normalized = {
    aspectRatio: String(source.aspectRatio || "") || undefined,
    count: count > 0 ? count : undefined,
    modelKey: String(source.modelKey || "") || undefined,
    modelName: String(source.modelName || "") || undefined,
    quality: String(source.quality || "") || undefined,
    resolution: String(source.resolution || "") || undefined,
  };
  return Object.values(normalized).some((value) => value !== undefined) ? normalized : undefined;
}

function normalizeCurrentNodeData(data: Record<string, unknown>, kind: NativeCanvasNodeKind) {
  const normalized = { ...data, kind } as NativeCanvasNode["data"];
  normalized.latestGenerationTaskId = String(data.latestGenerationTaskId || "") || undefined;
  if (kind !== "imageGenerator") return normalized;
  normalized.libtvImageGeneration = normalizeLibtvImageGeneration(data.libtvImageGeneration);
  normalized.generatedImages = normalizeGeneratedImages(data);
  return normalized;
}

function normalizeNode(input: unknown): NativeCanvasNode | null {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const data = value.data && typeof value.data === "object" ? value.data as Record<string, unknown> : {};
  const kind = data.kind;
  if (value.type !== "canvasNode" || !value.position || !isNodeKind(kind)) return null;
  return {
    ...(value as unknown as NativeCanvasNode),
    type: "canvasNode",
    data: normalizeCurrentNodeData(data, kind),
    selected: false,
  };
}

function normalizeEdge(input: unknown): NativeCanvasEdge | null {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const source = String(value.source || "");
  const target = String(value.target || "");
  const data = value.data && typeof value.data === "object" ? value.data as Record<string, unknown> : {};
  if (!source || !target) return null;
  return {
    id: String(value.id || `edge_${crypto.randomUUID()}`),
    type: "default",
    source,
    target,
    sourceHandle: typeof value.sourceHandle === "string" ? value.sourceHandle : "output",
    targetHandle: typeof value.targetHandle === "string" ? value.targetHandle : "input",
    data: {
      inputKind: data.inputKind === "prompt"
        || data.inputKind === "referenceImage"
        || data.inputKind === "additionalReferenceImage"
        || data.inputKind === "additionalReferencePrompt"
        ? data.inputKind
        : undefined,
      referenceOrder: data.inputKind === "referenceImage" || data.inputKind === "additionalReferenceImage"
        ? Number(data.referenceOrder || 0) || undefined
        : undefined,
    },
    selected: false,
  };
}

export function emptyCanvasSnapshot(): NativeCanvasSnapshot {
  return { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
}

export function normalizeCanvasDocument(input: unknown): NativeCanvasDocument | null {
  const record = recordOf(input);
  if (!record) return null;
  const value = input as Record<string, unknown>;
  if (Number(value.canvasSchemaVersion) !== 2) return null;
  const rawViewport = value.viewport && typeof value.viewport === "object"
    ? value.viewport as Record<string, unknown>
    : {};
  const nodes = (Array.isArray(value.nodes) ? value.nodes : []).map(normalizeNode).filter((node): node is NativeCanvasNode => Boolean(node));
  const edges = (Array.isArray(value.edges) ? value.edges : Array.isArray(value.connections) ? value.connections : [])
    .map(normalizeEdge)
    .filter((edge): edge is NativeCanvasEdge => Boolean(edge));
  return {
    ...record,
    canvasSchemaVersion: 2,
    nodeCount: nodes.length,
    nodes,
    edges,
    viewport: {
      x: Number(rawViewport.x || 0),
      y: Number(rawViewport.y || 0),
      zoom: Number(rawViewport.zoom || rawViewport.scale || 1),
    },
  };
}

export function snapshotForStorage(snapshot: NativeCanvasSnapshot) {
  return canvasSnapshotForStorage(snapshot);
}
