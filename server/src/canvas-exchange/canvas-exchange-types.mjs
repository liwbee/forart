export const CANVAS_ASSETS_DIR_NAME = "CanvasAssests";
export const CANVAS_INDEX_FILENAME = "canvas-index.json";
export const PACKAGE_FORMAT = "forart.canvas.package";
export const PACKAGE_VERSION = 1;
export const PACKAGE_URL_PREFIX = "forart-package://asset/";
export const DEFAULT_PROJECT_ID = "project_default";
export const DEFAULT_PROJECT_TITLE = "Default project";
export const SCHEMA_VERSION = 1;

export function nowIso() {
  return new Date().toISOString();
}

export function nowMs() {
  return Date.now();
}

