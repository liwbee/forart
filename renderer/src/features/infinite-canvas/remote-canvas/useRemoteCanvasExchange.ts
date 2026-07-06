import { useCallback, useEffect, useMemo, useState } from "react";
import { getActiveForartConfig } from "../../../data-source/runtime";
import type { CanvasDocumentRecord, CanvasProjectRecord } from "../types";
import {
  createRemoteCanvasProject,
  deleteRemoteCanvas,
  deleteRemoteCanvasProject,
  downloadRemoteCanvasPackage,
  listRemoteCanvases,
  listRemoteCanvasProjects,
  loadRemoteCanvas,
  renameRemoteCanvasProject,
  updateRemoteCanvasProject,
  uploadRemoteCanvasPackage,
} from "./remoteCanvasApi";
import type { RemoteCanvasManifest, RemoteCanvasProject, RemoteCanvasSortMode } from "./remoteCanvasTypes";

function timestamp(value: string | number | undefined) {
  if (typeof value === "number") return value;
  return value ? new Date(value).getTime() : Date.now();
}

export function remoteManifestToRecord(manifest: RemoteCanvasManifest): CanvasDocumentRecord {
  return {
    id: manifest.id,
    title: manifest.title,
    icon: "layers",
    canvasType: "forart",
    projectId: manifest.projectId,
    color: "",
    pinned: false,
    createdAt: timestamp(manifest.uploadedAt || manifest.createdAt),
    updatedAt: timestamp(manifest.updatedAt || manifest.uploadedAt),
    nodeCount: manifest.nodeCount,
  };
}

function remoteProjectToRecord(project: RemoteCanvasProject): CanvasProjectRecord {
  return {
    id: project.id,
    title: project.title,
    color: project.color || "",
    sortOrder: Number.isFinite(Number(project.sortOrder)) ? Number(project.sortOrder) : 0,
    createdAt: timestamp(project.createdAt),
    updatedAt: timestamp(project.updatedAt),
  };
}

function sortProjectRecords(projects: CanvasProjectRecord[]) {
  return [...projects].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
    return Number(left.createdAt || 0) - Number(right.createdAt || 0);
  });
}

export function useRemoteCanvasExchange() {
  const isRemoteMode = getActiveForartConfig()?.mode === "remote";
  const [projects, setProjects] = useState<CanvasProjectRecord[]>([]);
  const [canvases, setCanvases] = useState<RemoteCanvasManifest[]>([]);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<RemoteCanvasSortMode>("uploadedAt");
  const [loading, setLoading] = useState(false);

  const records = useMemo(() => canvases.map(remoteManifestToRecord), [canvases]);

  const refresh = useCallback(async () => {
    if (!isRemoteMode) {
      setProjects([]);
      setCanvases([]);
      return;
    }
    setLoading(true);
    try {
      const remoteProjects = await listRemoteCanvasProjects();
      const projectRecords = sortProjectRecords(remoteProjects.map(remoteProjectToRecord));
      const nextProjectId = activeProjectId && projectRecords.some((project) => project.id === activeProjectId)
        ? activeProjectId
        : projectRecords[0]?.id || "";
      if (nextProjectId !== activeProjectId) setActiveProjectId(nextProjectId);
      const remoteCanvases = await listRemoteCanvases({ projectId: nextProjectId, search, sort: sortMode });
      setProjects(projectRecords);
      setCanvases(remoteCanvases);
    } finally {
      setLoading(false);
    }
  }, [activeProjectId, isRemoteMode, search, sortMode]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createProject = useCallback(async (title: string) => {
    const project = await createRemoteCanvasProject(title);
    await refresh();
    setActiveProjectId(project.id);
    return project;
  }, [refresh]);

  const renameProject = useCallback(async (projectId: string, title: string) => {
    await renameRemoteCanvasProject(projectId, title);
    await refresh();
  }, [refresh]);

  const reorderProjects = useCallback((nextProjects: CanvasProjectRecord[]) => {
    const orderedProjects = nextProjects.map((project, index) => ({ ...project, sortOrder: index + 1 }));
    setProjects(orderedProjects);
    orderedProjects.forEach((project) => {
      const previous = projects.find((item) => item.id === project.id);
      if (previous?.sortOrder !== project.sortOrder) {
        void updateRemoteCanvasProject(project.id, { sortOrder: project.sortOrder }).catch(() => {
          void refresh();
        });
      }
    });
  }, [projects, refresh]);

  const deleteProject = useCallback(async (projectId: string) => {
    await deleteRemoteCanvasProject(projectId);
    setActiveProjectId("");
    await refresh();
  }, [refresh]);

  const uploadLocalCanvas = useCallback(async (canvasId: string, projectId: string) => {
    if (!window.easyTool?.createCanvasPackageForUpload) throw new Error("Canvas package bridge is unavailable.");
    const created = await window.easyTool.createCanvasPackageForUpload(canvasId);
    if (created.canceled || !created.filePath) return null;
    const result = await uploadRemoteCanvasPackage(created.filePath, projectId);
    await refresh();
    return result;
  }, [refresh]);

  const copyRemoteToLocal = useCallback(async (remoteCanvasId: string, localProjectId: string) => {
    if (!window.easyTool?.importCanvasPackageFromPath) throw new Error("Canvas import bridge is unavailable.");
    const downloaded = await downloadRemoteCanvasPackage(remoteCanvasId);
    const imported = await window.easyTool.importCanvasPackageFromPath({ filePath: downloaded.filePath, projectId: localProjectId });
    return imported;
  }, []);

  const deleteCanvas = useCallback(async (remoteCanvasId: string) => {
    await deleteRemoteCanvas(remoteCanvasId);
    await refresh();
  }, [refresh]);

  const openRemoteCanvas = useCallback(async (remoteCanvasId: string) => loadRemoteCanvas(remoteCanvasId), []);

  return {
    activeProjectId,
    copyRemoteToLocal,
    createProject,
    deleteCanvas,
    deleteProject,
    isRemoteMode,
    loading,
    openRemoteCanvas,
    projects,
    records,
    refresh,
    renameProject,
    reorderProjects,
    search,
    setActiveProjectId,
    setSearch,
    setSortMode,
    sortMode,
    uploadLocalCanvas,
  };
}
