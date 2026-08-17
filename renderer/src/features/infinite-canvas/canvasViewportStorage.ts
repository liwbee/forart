import type { Viewport } from "@xyflow/react";

export const CANVAS_VIEWPORT_STORAGE_KEY = "forart_infinite_canvas_viewports_v1";

interface StoredCanvasViewport extends Viewport {
  updatedAt: number;
}

const MAX_STORED_VIEWPORTS = 200;

function normalizedViewport(value: unknown, fallback: Viewport): Viewport {
  const candidate = value && typeof value === "object" ? value as Partial<Viewport> : {};
  const x = Number(candidate.x);
  const y = Number(candidate.y);
  const zoom = Number(candidate.zoom);
  return {
    x: Number.isFinite(x) ? x : fallback.x,
    y: Number.isFinite(y) ? y : fallback.y,
    zoom: Number.isFinite(zoom) && zoom > 0 ? Math.min(6, Math.max(0.1, zoom)) : fallback.zoom,
  };
}

function readViewportMap(): Record<string, StoredCanvasViewport> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CANVAS_VIEWPORT_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, StoredCanvasViewport>
      : {};
  } catch {
    return {};
  }
}

export function readCanvasViewport(canvasId: string, fallback: Viewport): Viewport {
  if (!canvasId) return fallback;
  const stored = readViewportMap();
  return Object.prototype.hasOwnProperty.call(stored, canvasId)
    ? normalizedViewport(stored[canvasId], fallback)
    : fallback;
}

export function writeCanvasViewport(canvasId: string, viewport: Viewport) {
  if (!canvasId) return;
  try {
    const stored = readViewportMap();
    const nextEntries = Object.entries({
      ...stored,
      [canvasId]: { ...normalizedViewport(viewport, viewport), updatedAt: Date.now() },
    })
      .sort((left, right) => Number(right[1].updatedAt || 0) - Number(left[1].updatedAt || 0))
      .slice(0, MAX_STORED_VIEWPORTS);
    window.localStorage.setItem(CANVAS_VIEWPORT_STORAGE_KEY, JSON.stringify(Object.fromEntries(nextEntries)));
  } catch {
    // Viewport persistence is best-effort and must never interrupt canvas interaction.
  }
}
