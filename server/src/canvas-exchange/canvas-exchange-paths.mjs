import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { CANVAS_ASSETS_DIR_NAME, CANVAS_INDEX_FILENAME } from "./canvas-exchange-types.mjs";

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

export function isInsideOrEqual(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function safeDecode(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return "";
  }
}

export function safePathPart(value, fallback) {
  return String(value || fallback)
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[ .]+$/g, "")
    .slice(0, 80) || fallback;
}

export function safeRelativePath(value) {
  const normalized = String(value || "").replace(/\\/g, "/");
  const clean = path.posix.normalize(normalized);
  if (!clean || clean.startsWith("../") || clean.includes("/../") || clean.startsWith("/") || /^[a-zA-Z]:/.test(clean)) return "";
  return clean;
}

export function createCanvasExchangePaths({ getStorageRoot }) {
  function canvasAssetsRoot() {
    const root = path.join(getStorageRoot(), CANVAS_ASSETS_DIR_NAME);
    ensureDir(root);
    return root;
  }

  function indexPath() {
    return path.join(canvasAssetsRoot(), CANVAS_INDEX_FILENAME);
  }

  function jsonRoot() {
    const dir = path.join(canvasAssetsRoot(), "json");
    ensureDir(dir);
    return dir;
  }

  function inputRoot() {
    const dir = path.join(canvasAssetsRoot(), "input");
    ensureDir(dir);
    return dir;
  }

  function outputRoot() {
    const dir = path.join(canvasAssetsRoot(), "output");
    ensureDir(dir);
    return dir;
  }

  function projectsRoot() {
    const dir = path.join(canvasAssetsRoot(), "projects");
    ensureDir(dir);
    return dir;
  }

  function manifestsRoot() {
    const dir = path.join(canvasAssetsRoot(), "manifests");
    ensureDir(dir);
    return dir;
  }

  function tempRoot() {
    const dir = path.join(canvasAssetsRoot(), "tmp");
    ensureDir(dir);
    return dir;
  }

  function canvasJsonPath(canvasId) {
    return path.join(jsonRoot(), `${safePathPart(canvasId, "canvas")}.json`);
  }

  function manifestPath(canvasId) {
    return path.join(manifestsRoot(), `${safePathPart(canvasId, "canvas")}.json`);
  }

  function projectPath(projectId) {
    return path.join(projectsRoot(), `${safePathPart(projectId, "project")}.json`);
  }

  function assetRootForKind(kind) {
    return kind === "output" ? outputRoot() : inputRoot();
  }

  function assetAbsolutePath(relativePath) {
    const safe = safeRelativePath(relativePath);
    if (!safe) return "";
    const target = path.resolve(canvasAssetsRoot(), safe);
    return isInsideOrEqual(canvasAssetsRoot(), target) ? target : "";
  }

  function assetRelativePath(filePath) {
    return path.relative(canvasAssetsRoot(), filePath).replace(/\\/g, "/");
  }

  function ensureAll() {
    [
      canvasAssetsRoot(),
      jsonRoot(),
      inputRoot(),
      outputRoot(),
      projectsRoot(),
      manifestsRoot(),
      tempRoot(),
    ].forEach((dir) => {
      if (!existsSync(dir)) ensureDir(dir);
    });
  }

  return {
    assetAbsolutePath,
    assetRelativePath,
    assetRootForKind,
    canvasAssetsRoot,
    canvasJsonPath,
    ensureAll,
    indexPath,
    inputRoot,
    jsonRoot,
    manifestPath,
    manifestsRoot,
    outputRoot,
    projectPath,
    projectsRoot,
    tempRoot,
  };
}

