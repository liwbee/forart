import type { CanvasDocument, CanvasDocumentRecord } from "./types";

export type CanvasTabSource = "local" | "remote";

export interface CanvasDocumentTab {
  id: string;
  title: string;
  icon?: string;
  canvasType?: "forart";
  source: CanvasTabSource;
  updatedAt: number;
}

export function normalizeCanvasTab(input: unknown): CanvasDocumentTab | null {
  const parsed = input as Partial<CanvasDocumentTab> | null;
  if (!parsed?.id) return null;
  return {
    id: String(parsed.id),
    title: String(parsed.title || "Untitled canvas"),
    icon: parsed.icon || "layers",
    canvasType: "forart",
    source: parsed.source === "remote" ? "remote" : "local",
    updatedAt: Number(parsed.updatedAt || 0),
  };
}

export function localCanvasTabFromRecord(record: CanvasDocumentRecord | CanvasDocument): CanvasDocumentTab {
  return {
    id: record.id,
    title: record.title || "Untitled canvas",
    icon: record.icon || "layers",
    canvasType: "forart",
    source: "local",
    updatedAt: Number(record.updatedAt || 0),
  };
}
