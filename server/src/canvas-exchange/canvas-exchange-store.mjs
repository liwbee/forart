import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ensureDir, safePathPart } from "./canvas-exchange-paths.mjs";
import { DEFAULT_PROJECT_ID, DEFAULT_PROJECT_TITLE, PACKAGE_FORMAT, SCHEMA_VERSION, nowIso } from "./canvas-exchange-types.mjs";

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

function receiveStreamToFile(stream, filePath, expectedSize = 0) {
  return new Promise((resolve, reject) => {
    ensureDir(path.dirname(filePath));
    const output = createWriteStream(filePath);
    const hash = createHash("sha256");
    let bytes = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      output.destroy();
      unlinkIfExists(filePath);
      reject(error);
    };
    stream.on("data", (chunk) => {
      bytes += chunk.length;
      hash.update(chunk);
      if (expectedSize > 0 && bytes > expectedSize) fail(new Error("Canvas resource exceeds its declared size"));
    });
    stream.on("error", fail);
    output.on("error", fail);
    output.on("finish", () => {
      if (settled) return;
      settled = true;
      if (expectedSize > 0 && bytes !== expectedSize) {
        unlinkIfExists(filePath);
        reject(new Error("Canvas resource size does not match its declaration"));
        return;
      }
      resolve({ bytes, sha256: hash.digest("hex") });
    });
    stream.pipe(output);
  });
}

export function createCanvasExchangeStore({ paths, index, packages, uploadSessionMaxAgeMs = 24 * 60 * 60 * 1000 }) {
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

  function updateCanvas(canvasId, patch = {}) {
    const canvas = loadCanvas(canvasId);
    const manifest = loadManifest(canvasId);
    if (!canvas || !manifest) throw new Error("Canvas not found");
    const title = patch.title !== undefined ? validateName(patch.title, "canvas name") : manifest.title;
    const timestamp = nowIso();
    const nextCanvas = { ...canvas, title, updatedAt: Date.now() };
    const nextManifest = { ...manifest, title, updatedAt: timestamp };
    writeJson(paths.canvasJsonPath(canvasId), nextCanvas);
    writeJson(paths.manifestPath(canvasId), nextManifest);
    return { ok: true, canvas: index.upsertCanvas(nextManifest) };
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

  function uploadSessionPath(canvasId) {
    return path.join(paths.tempRoot(), `upload-${safePathPart(canvasId, "canvas")}`);
  }

  function uploadSessionFile(canvasId) {
    return path.join(uploadSessionPath(canvasId), "session.json");
  }

  function readUploadSession(canvasId) {
    const filePath = uploadSessionFile(canvasId);
    if (!existsSync(filePath)) throw new Error("Canvas upload session not found");
    return readJson(filePath);
  }

  function beginCanvasUpload({ projectId, canvas, manifest } = {}) {
    ensureDefaultProject();
    if (!canvas || typeof canvas !== "object") throw new Error("Canvas document is required");
    if (!manifest || manifest.format !== PACKAGE_FORMAT) throw new Error("Invalid canvas upload manifest");
    const targetProjectId = index.listProjects().some((project) => project.id === projectId) ? projectId : DEFAULT_PROJECT_ID;
    const canvasId = newId("remote_canvas");
    const sessionRoot = uploadSessionPath(canvasId);
    ensureDir(path.join(sessionRoot, "assets"));
    writeJson(uploadSessionFile(canvasId), {
      canvasId,
      projectId: targetProjectId,
      canvas,
      manifest: { ...manifest, assets: Array.isArray(manifest.assets) ? manifest.assets : [] },
      createdAt: nowIso(),
    });
    return {
      ok: true,
      canvasId,
      assetCount: Array.isArray(manifest.assets) ? manifest.assets.length : 0,
      assetUploadUrl: `/api/canvas-exchange/canvases/${encodeURIComponent(canvasId)}/assets`,
      completeUrl: `/api/canvas-exchange/canvases/${encodeURIComponent(canvasId)}/complete`,
    };
  }

  async function receiveCanvasAsset(canvasId, assetId, stream, expectedContentLength = 0) {
    const session = readUploadSession(canvasId);
    const asset = session.manifest.assets.find((item) => String(item.id || "") === String(assetId || ""));
    if (!asset) throw new Error("Canvas resource is not declared");
    const extension = path.extname(String(asset.fileName || asset.packagePath || ".png")).toLowerCase() || ".png";
    const target = path.join(uploadSessionPath(canvasId), "assets", `${asset.id}${extension}`);
    const expectedSize = Number(asset.sizeBytes || expectedContentLength || 0);
    const result = await receiveStreamToFile(stream, `${target}.part`, expectedSize);
    if (asset.sha256 && String(asset.sha256).toLowerCase() !== result.sha256.toLowerCase()) {
      unlinkIfExists(`${target}.part`);
      throw new Error("Canvas resource checksum does not match its declaration");
    }
    renameSync(`${target}.part`, target);
    return { ok: true, assetId: String(asset.id), sizeBytes: result.bytes };
  }

  function completeCanvasUpload(canvasId) {
    const session = readUploadSession(canvasId);
    const finalized = packages.finalizeDirectUpload({
      canvasId,
      canvas: session.canvas,
      manifest: session.manifest,
      stagingRoot: uploadSessionPath(canvasId),
    });
    try {
      const timestamp = nowIso();
      const canvas = {
        ...finalized.canvas,
        id: canvasId,
        projectId: session.projectId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const title = String(session.manifest.canvas?.title || canvas.title || "Untitled canvas").slice(0, 80);
      canvas.title = title;
      const manifest = {
        id: canvasId,
        projectId: session.projectId,
        title,
        uploadedAt: timestamp,
        updatedAt: timestamp,
        nodeCount: Array.isArray(canvas.nodes) ? canvas.nodes.length : 0,
        assetCount: finalized.assets.length,
        packageBytes: finalized.assets.reduce((total, asset) => total + Number(asset.sizeBytes || 0), 0),
        assets: finalized.assets,
        warnings: Array.isArray(session.manifest.warnings) ? session.manifest.warnings : [],
        schemaVersion: SCHEMA_VERSION,
      };
      writeJson(paths.canvasJsonPath(canvasId), canvas);
      writeJson(paths.manifestPath(canvasId), manifest);
      const record = index.upsertCanvas(manifest);
      rmSync(uploadSessionPath(canvasId), { recursive: true, force: true });
      return { ok: true, canvas: record, warnings: manifest.warnings };
    } catch (error) {
      try { finalized.cleanup?.(); } catch {}
      try { unlinkIfExists(paths.canvasJsonPath(canvasId)); } catch {}
      try { unlinkIfExists(paths.manifestPath(canvasId)); } catch {}
      try { index.removeCanvas(canvasId); } catch {}
      try { rmSync(uploadSessionPath(canvasId), { recursive: true, force: true }); } catch {}
      throw error;
    }
  }

  function cancelCanvasUpload(canvasId) {
    rmSync(uploadSessionPath(canvasId), { recursive: true, force: true });
    return { ok: true };
  }

  function cleanupStaleUploadSessions() {
    const tempRoot = paths.tempRoot();
    const cutoff = Date.now() - Math.max(0, Number(uploadSessionMaxAgeMs) || 0);
    for (const entry of readdirSync(tempRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith("upload-")) continue;
      const sessionRoot = path.join(tempRoot, entry.name);
      try {
        if (statSync(sessionRoot).mtimeMs < cutoff) rmSync(sessionRoot, { recursive: true, force: true });
      } catch {
        // A concurrently completed or canceled upload can disappear between the scan and stat.
      }
    }
  }

  function loadCanvasTransfer(canvasId) {
    const canvas = loadCanvas(canvasId);
    const manifest = loadManifest(canvasId);
    if (!canvas || !manifest) throw new Error("Canvas not found");
    return { canvas, manifest };
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
  cleanupStaleUploadSessions();
  ensureDefaultProject();

  return {
    createPackageForCanvas,
    beginCanvasUpload,
    cancelCanvasUpload,
    completeCanvasUpload,
    createProject,
    deleteCanvas,
    deleteProject,
    listCanvases,
    listProjects,
    loadCanvas,
    loadCanvasTransfer,
    readAsset,
    receiveCanvasAsset,
    updateCanvas,
    updateProject,
    uploadCanvasPackage,
  };
}
