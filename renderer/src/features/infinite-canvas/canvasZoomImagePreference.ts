import { useEffect, useState } from "react";

export const CANVAS_ORIGINAL_ZOOM_IN = 4.1;
export const CANVAS_ORIGINAL_ZOOM_OUT = 3.9;

export function nextCanvasOriginalImagePreference(current: boolean, zoom: number) {
  const normalizedZoom = Number.isFinite(zoom) ? zoom : 1;
  return current
    ? normalizedZoom > CANVAS_ORIGINAL_ZOOM_OUT
    : normalizedZoom > CANVAS_ORIGINAL_ZOOM_IN;
}

/** Adds a small hysteresis band so images do not swap repeatedly around 400%. */
export function useCanvasOriginalImagePreference(zoom: number) {
  const [preferOriginal, setPreferOriginal] = useState(() => nextCanvasOriginalImagePreference(false, zoom));

  useEffect(() => {
    setPreferOriginal((current) => {
      const next = nextCanvasOriginalImagePreference(current, zoom);
      return next === current ? current : next;
    });
  }, [zoom]);

  return preferOriginal;
}
