import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { ensureDir } from "./canvas-exchange-paths.mjs";
import { DEFAULT_PROJECT_ID, DEFAULT_PROJECT_TITLE, nowIso } from "./canvas-exchange-types.mjs";

function defaultProject(timestamp = nowIso()) {
  return {
    id: DEFAULT_PROJECT_ID,
    title: DEFAULT_PROJECT_TITLE,
    color: "",
    sortOrder: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function normalizeProject(project, fallback = {}) {
  const timestamp = nowIso();
  const fallbackSortOrder = Number.isFinite(Number(fallback.sortOrder)) ? Number(fallback.sortOrder) : 0;
  const sortOrder = Number.isFinite(Number(project?.sortOrder)) ? Number(project.sortOrder) : fallbackSortOrder;
  return {
    id: String(project?.id || fallback.id || DEFAULT_PROJECT_ID),
    title: String(project?.title || fallback.title || DEFAULT_PROJECT_TITLE).slice(0, 80),
    color: String(project?.color || fallback.color || ""),
    sortOrder,
    createdAt: String(project?.createdAt || fallback.createdAt || timestamp),
    updatedAt: String(project?.updatedAt || fallback.updatedAt || timestamp),
  };
}

function normalizeCanvas(canvas) {
  const timestamp = nowIso();
  return {
    id: String(canvas?.id || ""),
    projectId: String(canvas?.projectId || DEFAULT_PROJECT_ID),
    title: String(canvas?.title || "Untitled canvas").slice(0, 80),
    uploadedAt: String(canvas?.uploadedAt || timestamp),
    updatedAt: String(canvas?.updatedAt || canvas?.uploadedAt || timestamp),
    createdAt: String(canvas?.createdAt || canvas?.uploadedAt || timestamp),
    nodeCount: Number(canvas?.nodeCount || 0),
    assetCount: Number(canvas?.assetCount || 0),
    packageBytes: Number(canvas?.packageBytes || 0),
    warnings: Array.isArray(canvas?.warnings) ? canvas.warnings : [],
    schemaVersion: Number(canvas?.schemaVersion || 1),
  };
}

function normalizePayload(payload) {
  const timestamp = nowIso();
  const projects = Array.isArray(payload?.projects)
    ? payload.projects.map((project, index) => normalizeProject(project, { sortOrder: index + 1 })).filter((project) => project.id)
    : [];
  const normalizedProjects = projects.length ? projects : [defaultProject(timestamp)];
  const projectIds = new Set(normalizedProjects.map((project) => project.id));
  const canvases = Array.isArray(payload?.canvases)
    ? payload.canvases.map(normalizeCanvas).filter((canvas) => canvas.id)
    : [];
  return {
    version: 1,
    updatedAt: String(payload?.updatedAt || timestamp),
    projects: normalizedProjects,
    canvases: canvases.map((canvas) => ({
      ...canvas,
      projectId: projectIds.has(canvas.projectId) ? canvas.projectId : normalizedProjects[0].id,
    })),
  };
}

export function createCanvasExchangeIndex(paths) {
  function readIndex() {
    const filePath = paths.indexPath();
    if (!existsSync(filePath)) return normalizePayload({});
    try {
      return normalizePayload(JSON.parse(readFileSync(filePath, "utf8")));
    } catch {
      return normalizePayload({});
    }
  }

  function writeIndex(payload) {
    const next = normalizePayload({ ...payload, updatedAt: nowIso() });
    const filePath = paths.indexPath();
    ensureDir(paths.canvasAssetsRoot());
    const temp = `${filePath}.tmp`;
    writeFileSync(temp, JSON.stringify(next, null, 2) + "\n", "utf8");
    renameSync(temp, filePath);
    return next;
  }

  function listProjects() {
    return readIndex().projects.sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  }

  function listCanvases({ projectId = "", search = "", sort = "uploadedAt" } = {}) {
    const index = readIndex();
    const query = String(search || "").trim().toLowerCase();
    let canvases = index.canvases;
    if (projectId) canvases = canvases.filter((canvas) => canvas.projectId === projectId);
    if (query) canvases = canvases.filter((canvas) => canvas.title.toLowerCase().includes(query));
    return canvases.sort((a, b) => {
      if (sort === "name") return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" });
      return new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime();
    });
  }

  function upsertProject(project) {
    const index = readIndex();
    const nextProject = normalizeProject(project);
    const projects = index.projects.some((item) => item.id === nextProject.id)
      ? index.projects.map((item) => (item.id === nextProject.id ? nextProject : item))
      : [...index.projects, nextProject];
    return writeIndex({ ...index, projects }).projects.find((item) => item.id === nextProject.id);
  }

  function removeProject(projectId) {
    const index = readIndex();
    return writeIndex({
      ...index,
      projects: index.projects.filter((project) => project.id !== projectId),
      canvases: index.canvases.filter((canvas) => canvas.projectId !== projectId),
    });
  }

  function upsertCanvas(canvas) {
    const index = readIndex();
    const nextCanvas = normalizeCanvas(canvas);
    const canvases = index.canvases.some((item) => item.id === nextCanvas.id)
      ? index.canvases.map((item) => (item.id === nextCanvas.id ? nextCanvas : item))
      : [nextCanvas, ...index.canvases];
    return writeIndex({ ...index, canvases }).canvases.find((item) => item.id === nextCanvas.id);
  }

  function removeCanvas(canvasId) {
    const index = readIndex();
    return writeIndex({ ...index, canvases: index.canvases.filter((canvas) => canvas.id !== canvasId) });
  }

  return {
    listCanvases,
    listProjects,
    readIndex,
    removeCanvas,
    removeProject,
    upsertCanvas,
    upsertProject,
    writeIndex,
  };
}
