export type FreeCanvasResolution = "1K" | "2K" | "4K";

const RESOLUTION_LONG_EDGES: Record<FreeCanvasResolution, number> = {
  "1K": 1024,
  "2K": 2048,
  "4K": 4096,
};

const ASPECT_RATIOS = ["3:4", "1:1", "4:3", "9:16", "16:9"] as const;

export function freeCanvasSizeFor(resolution: FreeCanvasResolution, aspectRatio: string) {
  const [rawWidth, rawHeight] = aspectRatio.split(":").map(Number);
  const ratioWidth = rawWidth > 0 ? rawWidth : 1;
  const ratioHeight = rawHeight > 0 ? rawHeight : 1;
  const longEdge = RESOLUTION_LONG_EDGES[resolution];
  if (ratioWidth >= ratioHeight) {
    return {
      width: longEdge,
      height: Math.round(longEdge * ratioHeight / ratioWidth),
    };
  }
  return {
    width: Math.round(longEdge * ratioWidth / ratioHeight),
    height: longEdge,
  };
}

export const FREE_CANVAS_RESOLUTIONS = Object.keys(RESOLUTION_LONG_EDGES) as FreeCanvasResolution[];

export const FREE_CANVAS_PRESETS = ASPECT_RATIOS.map((aspectRatio) => ({
  key: aspectRatio,
  label: aspectRatio,
  sizes: FREE_CANVAS_RESOLUTIONS.map((resolution) => ({
    resolution,
    label: resolution,
    ...freeCanvasSizeFor(resolution, aspectRatio),
  })),
}));
