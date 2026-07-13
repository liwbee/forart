import type { Viewport } from "@xyflow/react";
import {
  createNativeCanvasNode,
  NATIVE_CANVAS_NODE_DEFINITIONS,
  type NativeCanvasEdge,
  type NativeCanvasNode,
  type NativeCanvasNodeKind,
} from "./nativeCanvas";

export interface CanvasRecord {
  id: string;
  title: string;
  projectId: string;
  createdAt: number;
  updatedAt: number;
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

export interface NativeCanvasDocument extends CanvasRecord, NativeCanvasSnapshot {}

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

function normalizeGeneratedImages(data: Record<string, unknown>, fallbackUrl = "") {
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
  if (images.length) return images;
  const legacyUrl = String(data.imageUrl || fallbackUrl || "");
  if (!legacyUrl) return [];
  return [{
    localUrl: legacyUrl,
    thumbUrl: String(data.thumbUrl || "") || undefined,
    fileName: String(data.label || "") || undefined,
    width: Number(data.imageNaturalWidth || 0) || undefined,
    height: Number(data.imageNaturalHeight || 0) || undefined,
    downloadState: data.outputDownloadState === "downloaded" ? "downloaded" as const : "pending" as const,
    downloadedAt: Number(data.outputDownloadedAt || 0) || undefined,
  }];
}

function normalizeCurrentNodeData(data: Record<string, unknown>, kind: NativeCanvasNodeKind) {
  const normalized = { ...data, kind } as NativeCanvasNode["data"];
  if (kind !== "imageGenerator") return normalized;
  normalized.generatedImages = normalizeGeneratedImages(data);
  delete normalized.imageUrl;
  delete normalized.thumbUrl;
  delete normalized.outputDownloadState;
  delete normalized.outputDownloadedAt;
  return normalized;
}

function normalizeNode(input: unknown): NativeCanvasNode | null {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const data = value.data && typeof value.data === "object" ? value.data as Record<string, unknown> : {};
  const kindValue = data.kind || value.type;
  const kind = kindValue === "image" ? "imageLoader" : kindValue;
  if (!isNodeKind(kind)) return null;

  if (value.type === "canvasNode" && value.position && data.kind) {
    return {
      ...(value as unknown as NativeCanvasNode),
      type: "canvasNode",
      data: normalizeCurrentNodeData(data, kind),
      selected: false,
    };
  }

  const positionValue = value.position && typeof value.position === "object"
    ? value.position as Record<string, unknown>
    : null;
  const node = createNativeCanvasNode(kind, {
    x: Number(positionValue?.x ?? value.x ?? 0),
    y: Number(positionValue?.y ?? value.y ?? 0),
  }, {
    label: String(data.label || value.title || ""),
    imageUrl: kind === "imageLoader" ? String(data.imageUrl || value.url || "") || undefined : undefined,
    thumbUrl: kind === "imageLoader" ? String(data.thumbUrl || value.thumbUrl || "") || undefined : undefined,
    text: String(data.text ?? value.text ?? ""),
    imageProviderId: String(data.imageProviderId || value.imageProviderId || "") || undefined,
    imageModel: String(data.imageModel || value.imageModel || "") || undefined,
    imageResolution: String(data.imageResolution || value.imageResolution || "") || undefined,
    imageAspectRatio: String(data.imageAspectRatio || value.imageAspectRatio || "") || undefined,
    imageQuality: String(data.imageQuality || value.imageQuality || "") || undefined,
    imageCount: Number(data.imageCount || value.imageCount || 0) || undefined,
    generatedImages: kind === "imageGenerator" ? normalizeGeneratedImages(data, String(value.url || "")) : undefined,
    multiImageExpanded: data.multiImageExpanded === true,
    multiImageCollapsedSize: data.multiImageCollapsedSize && typeof data.multiImageCollapsedSize === "object"
      ? data.multiImageCollapsedSize as NativeCanvasNode["data"]["multiImageCollapsedSize"]
      : undefined,
    imageNaturalWidth: Number(data.imageNaturalWidth || value.imageNaturalWidth || 0) || undefined,
    imageNaturalHeight: Number(data.imageNaturalHeight || value.imageNaturalHeight || 0) || undefined,
    generationError: String(data.generationError || value.generationError || "") || undefined,
    generationRemoteTaskId: String(
      data.generationRemoteTaskId
      || (data.generationTask && typeof data.generationTask === "object"
        ? (data.generationTask as Record<string, unknown>).upstreamTaskId
        : ""),
    ) || undefined,
    actionFission: (data.actionFission || value.actionFission) as NativeCanvasNode["data"]["actionFission"],
  });
  const width = Number(value.width ?? value.w ?? 0);
  const height = Number(value.height ?? value.h ?? 0);
  return {
    ...node,
    id: String(value.id || node.id),
    style: width > 0 && height > 0 ? { ...node.style, width, height } : node.style,
  };
}

function normalizeEdge(input: unknown): NativeCanvasEdge | null {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const source = String(value.source || value.from || "");
  const target = String(value.target || value.to || "");
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
      inputKind: data.inputKind === "prompt" || data.inputKind === "referenceImage" ? data.inputKind : undefined,
      referenceOrder: data.inputKind === "referenceImage" ? Number(data.referenceOrder || 0) || undefined : undefined,
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
  const rawViewport = value.viewport && typeof value.viewport === "object"
    ? value.viewport as Record<string, unknown>
    : {};
  const nodes = (Array.isArray(value.nodes) ? value.nodes : []).map(normalizeNode).filter((node): node is NativeCanvasNode => Boolean(node));
  const edges = (Array.isArray(value.edges) ? value.edges : Array.isArray(value.connections) ? value.connections : [])
    .map(normalizeEdge)
    .filter((edge): edge is NativeCanvasEdge => Boolean(edge));
  return {
    ...record,
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
  return {
    nodes: snapshot.nodes.map((node) => {
      const data = { ...node.data };
      delete data.generationTask;
      return { ...node, data, selected: false };
    }),
    connections: snapshot.edges.map((edge) => ({ ...edge, selected: false })),
    groups: [],
    viewport: { x: snapshot.viewport.x, y: snapshot.viewport.y, scale: snapshot.viewport.zoom },
  };
}
