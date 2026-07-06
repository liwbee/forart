import { createReadStream, existsSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ensureDir, safePathPart } from "./canvas-exchange-paths.mjs";
import { DEFAULT_PROJECT_ID, DEFAULT_PROJECT_TITLE, SCHEMA_VERSION, nowIso } from "./canvas-exchange-types.mjs";

const RESERVED_FILE_NAMES = new Set(["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"]);

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

function validateName(value, label) {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  if (!name) throw new Error(`${label} is required`);
  if (name.length > 80) throw new Error(`${label} must be 80 characters or fewer`);
  if (/[<>:"/\\|?*\x00-\x1f]/.test(name)) throw new Error(`${label} cannot contain Windows or Linux filename characters: < > : " / \\ | ? *`);
  if (name === "." || name === ".." || /[ .]$/.test(name)) throw new Error(`${label} cannot end with a space or period, and cannot be . or ..`);
  if (RESERVED_FILE_NAMES.has(name.split(".")[0].toUpperCase())) throw new Error(`${label} cannot use a Windows reserved name`);
  return name;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  writeFileSync(filePath, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

function unlinkIfExists(filePath) {
  if (filePath && existsSync(filePath)) unlinkSync(filePath);
}

export function createCanvasExchangeStore({ paths, index, packages }) {
  function ensureDefaultProject() {
    const projects = index.listProjects();
    const existing = projects.find((project) => project.id === DEFAULT_PROJECT_ID);
    if (existing) return existing;
    const timestamp = nowIso();
    const project = {
      id: DEFAULT_PROJECT_ID,
      title: DEFAULT_PROJECT_TITLE,
      color: "",
      sortOrder: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    writeJson(paths.projectPath(project.id), project);
    return index.upsertProject(project);
  }

  function listProjects() {
    ensureDefaultProject();
    return index.listProjects();
  }

  function createProject(payload = {}) {
    const timestamp = nowIso();
    const sortOrder = Number.isFinite(Number(payload.sortOrder))
      ? Number(payload.sortOrder)
      : Math.min(0, ...listProjects().map((project) => Number(project.sortOrder || 0))) - 1;
    const project = {
      id: newId("project"),
      title: validateName(payload.title || DEFAULT_PROJECT_TITLE, "project name"),
      color: String(payload.color || ""),
      sortOrder,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    writeJson(paths.projectPath(project.id), project);
    return { ok: true, project: index.upsertProject(project) };
  }

  function updateProject(projectId, patch = {}) {
    const projects = listProjects();
    const existing = projects.find((project) => project.id === projectId);
    if (!existing) throw new Error("Canvas project not found");
    const project = {
      ...existing,
      title: patch.title !== undefined ? validateName(patch.title, "project name") : existing.title,
      color: patch.color !== undefined ? String(patch.color || "") : existing.color,
      sortOrder: patch.sortOrder !== undefined ? Number(patch.sortOrder || 0) : existing.sortOrder,
      updatedAt: nowIso(),
    };
    writeJson(paths.projectPath(project.id), project);
    return { ok: true, project: index.upsertProject(project) };
  }

  function deleteCanvas(canvasId) {
    const manifestPath = paths.manifestPath(canvasId);
    const manifest = existsSync(manifestPath) ? readJson(manifestPath) : null;
    if (manifest?.assets) {
      for (const asset of manifest.assets) {
        const target = paths.assetAbsolutePath(asset.relativePath);
        unlinkIfExists(target);
      }
    }
    unlinkIfExists(paths.canvasJsonPath(canvasId));
    unlinkIfExists(manifestPath);
    index.removeCanvas(canvasId);
    return { ok: true };
  }

  function deleteProject(projectId) {
    const canvases = index.listCanvases({ projectId });
    for (const canvas of canvases) deleteCanvas(canvas.id);
    unlinkIfExists(paths.projectPath(projectId));
    index.removeProject(projectId);
    ensureDefaultProject();
    return { ok: true, deletedCanvasIds: canvases.map((canvas) => canvas.id) };
  }

  function listCanvases(options = {}) {
    ensureDefaultProject();
    return index.listCanvases(options);
  }

  function loadCanvas(canvasId) {
    const filePath = paths.canvasJsonPath(canvasId);
    if (!existsSync(filePath)) return null;
    return readJson(filePath);
  }

  function loadManifest(canvasId) {
    const filePath = paths.manifestPath(canvasId);
    if (!existsSync(filePath)) return null;
    return readJson(filePath);
  }

  function uploadCanvasPackage({ packagePath, projectId }) {
    ensureDefaultProject();
    const targetProjectId = index.listProjects().some((project) => project.id === projectId) ? projectId : DEFAULT_PROJECT_ID;
    const canvasId = newId("remote_canvas");
    const unpacked = packages.unpackPackageToServer({ packagePath, canvasId });
    const timestamp = nowIso();
    const canvas = {
      ...unpacked.canvas,
      id: canvasId,
      projectId: targetProjectId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const title = String(unpacked.packageManifest?.canvas?.title || canvas.title || "Untitled canvas").slice(0, 80);
    canvas.title = title;
    const manifest = {
      id: canvasId,
      projectId: targetProjectId,
      title,
      uploadedAt: timestamp,
      updatedAt: timestamp,
      nodeCount: Array.isArray(canvas.nodes) ? canvas.nodes.length : 0,
      assetCount: unpacked.assets.length,
      packageBytes: statSync(packagePath).size,
      assets: unpacked.assets,
      warnings: unpacked.warnings,
      schemaVersion: SCHEMA_VERSION,
    };
    writeJson(paths.canvasJsonPath(canvasId), canvas);
    writeJson(paths.manifestPath(canvasId), manifest);
    const record = index.upsertCanvas(manifest);
    return { ok: true, canvas: record, warnings: unpacked.warnings };
  }

  function createPackageForCanvas(canvasId) {
    const canvas = loadCanvas(canvasId);
    const manifest = loadManifest(canvasId);
    if (!canvas || !manifest) throw new Error("Canvas not found");
    const fileName = `${safePathPart(manifest.title || canvas.title, "canvas")}-${canvasId}.forartcanvas`;
    const outputPath = path.join(paths.tempRoot(), fileName);
    packages.createPackageFromServer({ canvasId, canvas, manifest, outputPath });
    return { filePath: outputPath, fileName };
  }

  function readAsset(relativePath) {
    const filePath = paths.assetAbsolutePath(relativePath);
    if (!filePath || !existsSync(filePath)) return null;
    return { filePath, stream: createReadStream(filePath) };
  }

  paths.ensureAll();
  ensureDefaultProject();

  return {
    createPackageForCanvas,
    createProject,
    deleteCanvas,
    deleteProject,
    listCanvases,
    listProjects,
    loadCanvas,
    readAsset,
    updateProject,
    uploadCanvasPackage,
  };
}
