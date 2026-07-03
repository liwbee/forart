import type { CanvasDocument, CanvasDocumentRecord } from "../types";

export interface RemoteCanvasWarning {
  source?: string;
  url?: string;
  message: string;
}

export interface RemoteCanvasProject {
  id: string;
  title: string;
  color?: string;
  updatedAt: number | string;
  createdAt: number | string;
}

export interface RemoteCanvasManifest {
  id: string;
  projectId: string;
  title: string;
  uploadedAt: string;
  updatedAt: string;
  createdAt?: string;
  nodeCount: number;
  assetCount: number;
  packageBytes: number;
  warnings?: RemoteCanvasWarning[];
  schemaVersion: number;
}

export type RemoteCanvasSortMode = "uploadedAt" | "name";

export interface RemoteCanvasListOptions {
  projectId?: string;
  search?: string;
  sort?: RemoteCanvasSortMode;
}

export interface RemoteCanvasUploadResult {
  canvas: RemoteCanvasManifest;
  warnings: RemoteCanvasWarning[];
}

export type ServerCanvasDocument = CanvasDocument;

export type LocalCanvasImportRecord = CanvasDocumentRecord;
