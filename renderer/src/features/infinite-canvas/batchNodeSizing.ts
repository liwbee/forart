import { ASSET_LOADER_DEFAULT_SIZE } from "./imageNodeSizing";

export const BATCH_NODE_GRID_PREVIEW_WIDTH = ASSET_LOADER_DEFAULT_SIZE.width;
export const BATCH_NODE_GRID_PREVIEW_HEIGHT = ASSET_LOADER_DEFAULT_SIZE.height;
export const BATCH_NODE_GRID_CARD_WIDTH = BATCH_NODE_GRID_PREVIEW_WIDTH;
export const BATCH_NODE_GRID_GAP = 8;
export const BATCH_NODE_WIDTH_STEP = BATCH_NODE_GRID_CARD_WIDTH + BATCH_NODE_GRID_GAP;
export const BATCH_NODE_MIN_VISIBLE_COLUMNS = 3;
export const BATCH_NODE_DEFAULT_VISIBLE_COLUMNS = 4;

// The node frame's two 1px borders plus the viewport's 12px side paddings.
export const BATCH_NODE_WIDTH_CHROME = 26;

export function batchNodeWidthForGridColumns(columns: number) {
  return BATCH_NODE_WIDTH_CHROME
    + columns * BATCH_NODE_GRID_CARD_WIDTH
    + (columns - 1) * BATCH_NODE_GRID_GAP;
}

export const BATCH_NODE_MIN_WIDTH = batchNodeWidthForGridColumns(BATCH_NODE_MIN_VISIBLE_COLUMNS);
export const BATCH_NODE_DEFAULT_WIDTH = batchNodeWidthForGridColumns(BATCH_NODE_DEFAULT_VISIBLE_COLUMNS);

// Each visible row keeps the 86px slot plus 14px gap the removed list layout
// used, so existing canvases keep the same frame sizes and height snapping.
export const BATCH_NODE_ROW_HEIGHT = 86;
export const BATCH_NODE_ROW_GAP = 14;
export const BATCH_NODE_HEIGHT_STEP = BATCH_NODE_ROW_HEIGHT + BATCH_NODE_ROW_GAP;
export const BATCH_NODE_DEFAULT_VISIBLE_ROWS = 4;

// Node border/header and the two nested scroll paddings total 92px.
export const BATCH_NODE_HEIGHT_CHROME = 92;

export function batchNodeHeightForRows(rows: number) {
  return BATCH_NODE_HEIGHT_CHROME
    + rows * BATCH_NODE_ROW_HEIGHT
    + (rows - 1) * BATCH_NODE_ROW_GAP;
}

export const BATCH_NODE_DEFAULT_HEIGHT = batchNodeHeightForRows(BATCH_NODE_DEFAULT_VISIBLE_ROWS);

export const BATCH_NODE_DEFAULT_SIZE = {
  width: BATCH_NODE_DEFAULT_WIDTH,
  height: BATCH_NODE_DEFAULT_HEIGHT,
} as const;

export const BATCH_NODE_RESIZE_CONFIG = {
  minWidth: BATCH_NODE_MIN_WIDTH,
  minHeight: BATCH_NODE_DEFAULT_HEIGHT,
  widthStep: BATCH_NODE_WIDTH_STEP,
  heightStep: BATCH_NODE_HEIGHT_STEP,
  widthSnapOrigin: BATCH_NODE_DEFAULT_WIDTH,
  heightSnapOrigin: BATCH_NODE_DEFAULT_HEIGHT,
} as const;

export function snapResizeDimension(
  value: number,
  step: number | undefined,
  origin: number,
  min: number,
  max = Number.MAX_VALUE,
) {
  if (!Number.isFinite(value)) return min;
  const bounded = Math.min(max, Math.max(min, value));
  if (!(step && step > 0)) return bounded;
  const snapped = origin + Math.round((bounded - origin) / step) * step;
  return Math.min(max, Math.max(min, snapped));
}

export function snapBatchNodeSize(width: number, height: number) {
  return {
    width: snapResizeDimension(
      width,
      BATCH_NODE_WIDTH_STEP,
      BATCH_NODE_DEFAULT_WIDTH,
      BATCH_NODE_MIN_WIDTH,
    ),
    height: snapResizeDimension(
      height,
      BATCH_NODE_HEIGHT_STEP,
      BATCH_NODE_DEFAULT_HEIGHT,
      BATCH_NODE_DEFAULT_HEIGHT,
    ),
  };
}
