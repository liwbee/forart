import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TFunction } from "i18next";
import type { LibtvImportProgress, LibtvProjectRecord } from "../../app/appConfig";
import { replaceCanvasDocument } from "./canvasStore";
import { createCanvasNode } from "./nodes/registry";
import type { CanvasConnection, CanvasGroup, CanvasNode, CanvasNodeType, CanvasProject, CanvasProjectRecord, CanvasSnapshot, Viewport } from "./types";
import type { CanvasHomeMode, CanvasSortMode, HomeCanvasRecord, LibtvImportCardRecord } from "./CanvasHomePanel";

const uid = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
const GROUP_PADDING = 32;
const CANVAS_NODE_TYPES = ["imageGenerator", "image", "prompt", "loop", "llm", "libtvImage", "libtvPrompt", "libtvUpload"] as const;
const LAST_CANVAS_ID_KEY = "forart_infinite_canvas_last_canvas_id";
const LAST_CANVAS_HOME_KEY = "forart_infinite_canvas_show_home";

type StoredCanvasNode = Omit<CanvasNode, "type" | "imageMode"> & {
  type: CanvasNodeType | "generator" | "output" | "group";
  imageMode?: CanvasNode["imageMode"] | "generator";
};

interface UseCanvasProjectsOptions {
  nodes: CanvasNode[];
  connections: CanvasConnection[];
  groups: CanvasGroup[];
  viewport: Viewport;
  setViewport: (viewport: Viewport) => void;
  setZoomInput: (value: string) => void;
  clearCanvasTransientState: () => void;
  flushLibtvPending: () => void;
  getPendingLibtvNodeIds: () => string[];
  t: TFunction;
}

function isCanvasNodeType(type: string): type is CanvasNodeType {
  return CANVAS_NODE_TYPES.includes(type as CanvasNodeType);
}

function readLastCanvasState() {
  if (typeof window === "undefined") return { canvasId: "", showHome: true };
  return {
    canvasId: window.localStorage.getItem(LAST_CANVAS_ID_KEY) || "",
    showHome: window.localStorage.getItem(LAST_CANVAS_HOME_KEY) !== "false",
  };
}

function writeLastCanvasState(canvasId: string, showHome: boolean) {
  if (typeof window === "undefined") return;
  if (canvasId) window.localStorage.setItem(LAST_CANVAS_ID_KEY, canvasId);
  window.localStorage.setItem(LAST_CANVAS_HOME_KEY, showHome ? "true" : "false");
}

function nodeDefaults(type: CanvasNodeType): CanvasNode {
  return createCanvasNode(type, uid(type));
}

export function createInitialCanvas(): CanvasSnapshot {
  const prompt = { ...nodeDefaults("prompt"), id: uid("prompt"), x: -470, y: -110, text: "Describe the image, then connect it to an image generation node." };
  const imageGenerator = { ...nodeDefaults("imageGenerator"), id: uid("imageGenerator"), x: -60, y: -120, text: "" };
  return {
    nodes: [prompt, imageGenerator],
    connections: [{ id: uid("link"), from: prompt.id, to: imageGenerator.id }],
    groups: [],
    viewport: { x: 0, y: 0, scale: 1 },
  };
}

function getNodesBounds(nodes: CanvasNode[]) {
  if (!nodes.length) return null;
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxX = Math.max(...nodes.map((node) => node.x + node.w));
  const maxY = Math.max(...nodes.map((node) => node.y + node.h));
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function getLibtvImportProgressPercent(progress: LibtvImportProgress | null | undefined) {
  if (!progress) return 0;
  const current = Number(progress.current || 0);
  const total = Number(progress.total || 0);
  const detailRatio = total > 0 ? Math.max(0, Math.min(1, current / total)) : 0;
  if (progress.stage === "loadingProject") return 12;
  if (progress.stage === "loadingNodeDetails") return Math.round(16 + detailRatio * 72);
  if (progress.stage === "mappingNodes") return 92;
  if (progress.stage === "creatingCanvas") return 96;
  if (progress.stage === "done") return 100;
  return 0;
}

function mergeLibtvImportProgress(current: LibtvImportProgress | null | undefined, next: LibtvImportProgress): LibtvImportProgress {
  if (!current) return next;
  const currentPercent = getLibtvImportProgressPercent(current);
  const nextPercent = getLibtvImportProgressPercent(next);
  if (nextPercent < currentPercent && next.stage !== "done") return current;
  if (nextPercent === currentPercent && (Number(next.current || 0) < Number(current.current || 0))) return current;
  return next;
}

function normalizeStoredNode(node: StoredCanvasNode): CanvasNode | null {
  const hasLibtvBinding = Boolean(node.libtvProjectId || node.libtvNodeId);
  const normalizedType = node.type === "prompt" && hasLibtvBinding
    ? "libtvPrompt"
    : node.type === "image" && hasLibtvBinding
      ? "libtvUpload"
      : (node.type === "generator" || (node.type === "image" && node.imageMode === "generator")) ? "imageGenerator" : node.type;
  if (!isCanvasNodeType(normalizedType)) return null;
  return {
    ...node,
    type: normalizedType,
    title: normalizedType === "imageGenerator" && (node.title === "Image" || node.title === "Upload" || node.title === "Generate") ? "Image Generation" : node.title,
    url: node.url?.startsWith("blob:") ? "" : node.url,
    imageMode: normalizedType === "imageGenerator" ? "imageGenerator" : (normalizedType === "image" || normalizedType === "libtvUpload") ? "asset" : node.imageMode === "generator" ? "imageGenerator" : node.imageMode,
    imageSource: normalizedType === "imageGenerator" ? "generated" : (normalizedType === "image" || normalizedType === "libtvUpload") ? "uploaded" : node.imageSource,
  };
}

function normalizeStoredGroups(groups: unknown, nodeMap: Map<string, CanvasNode>): CanvasGroup[] {
  if (!Array.isArray(groups)) return [];
  return groups.flatMap((groupInput, index) => {
    const group = groupInput as Partial<CanvasGroup> | null;
    const groupNodeIds = Array.from(new Set((Array.isArray(group?.nodeIds) ? group.nodeIds : []).map(String).filter((nodeId) => nodeMap.has(nodeId))));
    const childBounds = getNodesBounds(groupNodeIds.map((nodeId) => nodeMap.get(nodeId)).filter(Boolean) as CanvasNode[]);
    const fallbackBounds = childBounds ? {
      x: childBounds.x - GROUP_PADDING,
      y: childBounds.y - GROUP_PADDING,
      w: childBounds.width + GROUP_PADDING * 2,
      h: childBounds.height + GROUP_PADDING * 2,
    } : { x: 0, y: 0, w: 320, h: 220 };
    return [{
      id: String(group?.id || uid("group")),
      title: String(group?.title || `Group ${index + 1}`).slice(0, 80),
      x: Number.isFinite(Number(group?.x)) ? Number(group?.x) : fallbackBounds.x,
      y: Number.isFinite(Number(group?.y)) ? Number(group?.y) : fallbackBounds.y,
      w: Number.isFinite(Number(group?.w)) ? Math.max(120, Number(group?.w)) : fallbackBounds.w,
      h: Number.isFinite(Number(group?.h)) ? Math.max(90, Number(group?.h)) : fallbackBounds.h,
      nodeIds: groupNodeIds,
    }];
  });
}

function normalizeStoredCanvas(input: unknown): CanvasSnapshot | null {
  const parsed = input as { nodes?: StoredCanvasNode[]; connections?: CanvasConnection[]; groups?: CanvasGroup[]; viewport?: Viewport } | null;
  if (!parsed || !Array.isArray(parsed.nodes)) return null;
  const nodes = parsed.nodes.map(normalizeStoredNode).filter(Boolean) as CanvasNode[];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const normalizedNodeMap = new Map(nodes.map((node) => [node.id, node]));
  return {
    nodes,
    connections: Array.isArray(parsed.connections) ? parsed.connections.filter((connection) => nodeIds.has(connection.from) && nodeIds.has(connection.to)) : [],
    groups: normalizeStoredGroups(parsed.groups, normalizedNodeMap),
    viewport: parsed.viewport || { x: 0, y: 0, scale: 1 },
  };
}

function normalizeCanvasProject(input: unknown): CanvasProject | null {
  const parsed = input as Partial<CanvasProject> | null;
  const snapshot = normalizeStoredCanvas(input);
  if (!parsed?.id || !snapshot) return null;
  const timestamp = Date.now();
  return {
    id: String(parsed.id),
    title: String(parsed.title || "Untitled canvas"),
    icon: parsed.icon || "layers",
    canvasType: parsed.canvasType === "forart-libtv" || parsed.source === "libtv" ? "forart-libtv" : "forart",
    source: parsed.source === "libtv" || parsed.canvasType === "forart-libtv" ? "libtv" : "forart",
    libtvProjectId: String(parsed.libtvProjectId || ""),
    libtvProjectName: String(parsed.libtvProjectName || ""),
    color: parsed.color || "",
    pinned: Boolean(parsed.pinned),
    createdAt: Number(parsed.createdAt || timestamp),
    updatedAt: Number(parsed.updatedAt || parsed.createdAt || timestamp),
    ...snapshot,
  };
}

function normalizeCanvasRecord(input: unknown): CanvasProjectRecord | null {
  const parsed = input as Partial<CanvasProjectRecord> | null;
  if (!parsed?.id) return null;
  const timestamp = Date.now();
  return {
    id: String(parsed.id),
    title: String(parsed.title || "Untitled canvas"),
    icon: parsed.icon || "layers",
    canvasType: parsed.canvasType === "forart-libtv" || parsed.source === "libtv" ? "forart-libtv" : "forart",
    source: parsed.source === "libtv" || parsed.canvasType === "forart-libtv" ? "libtv" : "forart",
    libtvProjectId: String(parsed.libtvProjectId || ""),
    libtvProjectName: String(parsed.libtvProjectName || ""),
    color: parsed.color || "",
    pinned: Boolean(parsed.pinned),
    createdAt: Number(parsed.createdAt || timestamp),
    updatedAt: Number(parsed.updatedAt || parsed.createdAt || timestamp),
    nodeCount: Number(parsed.nodeCount || 0),
  };
}

function parseLibtvProjectInput(value: string) {
  const text = value.trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    return url.searchParams.get("projectId") || url.searchParams.get("projectUuid") || "";
  } catch {
    return /^[a-f0-9-]{24,}$/i.test(text) ? text : "";
  }
}

function mergeLibtvRemoteSnapshot(local: CanvasProject, remote: { nodes: unknown[]; connections: unknown[]; groups: unknown[]; viewport?: unknown }, pendingNodeIds: Set<string>): Pick<CanvasProject, "nodes" | "connections" | "groups" | "viewport"> {
  const remoteSnapshot = normalizeStoredCanvas({
    nodes: remote.nodes,
    connections: remote.connections,
    groups: remote.groups,
    viewport: remote.viewport || local.viewport,
  });
  if (!remoteSnapshot) {
    return {
      nodes: local.nodes,
      connections: local.connections,
      groups: local.groups,
      viewport: local.viewport,
    };
  }

  const localByRemoteId = new Map(local.nodes.map((node) => [node.libtvNodeId || node.id, node]));
  const localIdByRemoteSnapshotId = new Map<string, string>();
  const mergedNodes = remoteSnapshot.nodes.map((remoteNode) => {
    const localNode = localByRemoteId.get(remoteNode.libtvNodeId || remoteNode.id);
    if (!localNode) return remoteNode;
    localIdByRemoteSnapshotId.set(remoteNode.id, localNode.id);
    if (pendingNodeIds.has(localNode.id)) {
      return {
        ...localNode,
        libtvProjectId: remoteNode.libtvProjectId || localNode.libtvProjectId,
        libtvNodeId: remoteNode.libtvNodeId || localNode.libtvNodeId,
      };
    }
    return {
      ...localNode,
      ...remoteNode,
      id: localNode.id,
      w: localNode.w,
      h: localNode.h,
    };
  });

  const remoteIds = new Set(mergedNodes.map((node) => node.libtvNodeId || node.id));
  const localOnlyDirtyNodes = local.nodes.filter((node) => pendingNodeIds.has(node.id) && !remoteIds.has(node.libtvNodeId || node.id));
  const mergedNodeIds = new Set([...mergedNodes, ...localOnlyDirtyNodes].map((node) => node.id));
  const mergedConnections = remoteSnapshot.connections
    .map((connection) => ({
      ...connection,
      from: localIdByRemoteSnapshotId.get(connection.from) || connection.from,
      to: localIdByRemoteSnapshotId.get(connection.to) || connection.to,
    }))
    .filter((connection) => mergedNodeIds.has(connection.from) && mergedNodeIds.has(connection.to));

  return {
    nodes: [...mergedNodes, ...localOnlyDirtyNodes],
    connections: mergedConnections,
    groups: remoteSnapshot.groups,
    viewport: local.viewport,
  };
}

export function useCanvasProjects({
  nodes,
  connections,
  groups,
  viewport,
  setViewport,
  setZoomInput,
  clearCanvasTransientState,
  flushLibtvPending,
  getPendingLibtvNodeIds,
  t,
}: UseCanvasProjectsOptions) {
  const [initialLastCanvasState] = useState(readLastCanvasState);
  const [canvasProjects, setCanvasProjects] = useState<CanvasProjectRecord[]>([]);
  const [activeCanvasId, setActiveCanvasId] = useState("");
  const activeCanvasIdRef = useRef("");
  const [activeCanvasTitle, setActiveCanvasTitle] = useState(t("infiniteCanvas.untitledCanvas"));
  const [projectDraftTitle, setProjectDraftTitle] = useState("");
  const [renamingCanvasId, setRenamingCanvasId] = useState("");
  const [renamingTitle, setRenamingTitle] = useState("");
  const [projectStatus, setProjectStatus] = useState("");
  const [showCanvasHome, setShowCanvasHome] = useState(initialLastCanvasState.showHome);
  const showCanvasHomeRef = useRef(initialLastCanvasState.showHome);
  const [canvasHomeMode, setCanvasHomeMode] = useState<CanvasHomeMode>("local");
  const [selectedHomeCanvasId, setSelectedHomeCanvasId] = useState(initialLastCanvasState.canvasId);
  const [libtvImportCards, setLibtvImportCards] = useState<LibtvImportCardRecord[]>([]);
  const [canvasSortMode, setCanvasSortMode] = useState<CanvasSortMode>("recent");
  const [confirmingDeleteCanvasId, setConfirmingDeleteCanvasId] = useState("");
  const [libtvProjectDraftId] = useState("");
  const [libtvImporting, setLibtvImporting] = useState(false);
  const [libtvStatus, setLibtvStatus] = useState("");
  const [libtvStatusTone, setLibtvStatusTone] = useState<"busy" | "ready" | "error">("ready");
  const libtvStatusTimeoutRef = useRef<number | null>(null);
  const [, setLibtvImportProgress] = useState<LibtvImportProgress | null>(null);
  const [libtvProjectResults, setLibtvProjectResults] = useState<LibtvProjectRecord[]>([]);
  const [libtvProjectFilter, setLibtvProjectFilter] = useState("");
  const [selectedLibtvProjectUuid, setSelectedLibtvProjectUuid] = useState("");

  const activeProject = useMemo(() => canvasProjects.find((project) => project.id === activeCanvasId) || null, [activeCanvasId, canvasProjects]);
  const sortedCanvasProjects = useMemo(() => {
    const projects: HomeCanvasRecord[] = [...libtvImportCards, ...canvasProjects];
    if (canvasSortMode === "name") {
      return projects.sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), undefined, { numeric: true, sensitivity: "base" }));
    }
    return projects.sort((a, b) => Number(b.updatedAt || b.createdAt) - Number(a.updatedAt || a.createdAt));
  }, [canvasProjects, canvasSortMode, libtvImportCards]);

  useEffect(() => {
    activeCanvasIdRef.current = activeCanvasId;
  }, [activeCanvasId]);

  const showLibtvStatus = useCallback((status: string, tone: "busy" | "ready" | "error" = "ready", autoHideMs = 5500) => {
    if (libtvStatusTimeoutRef.current) {
      window.clearTimeout(libtvStatusTimeoutRef.current);
      libtvStatusTimeoutRef.current = null;
    }
    setLibtvStatus(status);
    setLibtvStatusTone(tone);
    if (status && autoHideMs > 0) {
      libtvStatusTimeoutRef.current = window.setTimeout(() => {
        setLibtvStatus("");
        libtvStatusTimeoutRef.current = null;
      }, autoHideMs);
    }
  }, []);

  useEffect(() => () => {
    if (libtvStatusTimeoutRef.current) window.clearTimeout(libtvStatusTimeoutRef.current);
  }, []);

  useEffect(() => {
    showCanvasHomeRef.current = showCanvasHome;
  }, [showCanvasHome]);

  const returnToCanvasHome = useCallback(() => {
    showCanvasHomeRef.current = true;
    setShowCanvasHome(true);
    writeLastCanvasState(activeCanvasIdRef.current, true);
    setProjectStatus("");
    clearCanvasTransientState();
  }, [clearCanvasTransientState]);

  const setTransientLibtvStatus = useCallback((status: string) => {
    showLibtvStatus(status, status ? "error" : "ready", status ? 7000 : 0);
  }, [showLibtvStatus]);

  const applyCanvasProject = useCallback((project: CanvasProject) => {
    replaceCanvasDocument({ nodes: project.nodes, connections: project.connections, groups: project.groups });
    setViewport(project.viewport);
    setZoomInput(String(Math.round(project.viewport.scale * 100)));
    activeCanvasIdRef.current = project.id;
    setActiveCanvasId(project.id);
    setActiveCanvasTitle(project.title);
    setShowCanvasHome(false);
    writeLastCanvasState(project.id, false);
    clearCanvasTransientState();
  }, [clearCanvasTransientState, setViewport, setZoomInput]);

  const updateCanvasProjectRecord = useCallback((recordInput: unknown) => {
    const record = normalizeCanvasRecord(recordInput);
    if (!record) return;
    setCanvasProjects((current) => {
      const next = current.some((item) => item.id === record.id)
        ? current.map((item) => (item.id === record.id ? { ...item, ...record } : item))
        : [record, ...current];
      return [...next].sort((a, b) => Number(b.updatedAt || b.createdAt) - Number(a.updatedAt || a.createdAt));
    });
    if (record.id === activeCanvasIdRef.current) setActiveCanvasTitle(record.title);
  }, []);

  const refreshCanvasProjects = useCallback(async () => {
    if (!window.easyTool?.listCanvases) return [];
    const result = await window.easyTool.listCanvases();
    const projects = (result.canvases || []).map(normalizeCanvasRecord).filter(Boolean) as CanvasProjectRecord[];
    setCanvasProjects(projects);
    return projects;
  }, []);

  const refreshLibtvCanvasFromRemote = useCallback(async (project: CanvasProject) => {
    const importLibtvProject = window.libtv?.importProject;
    const saveCanvasProject = window.easyTool?.saveCanvasProject;
    if (project.canvasType !== "forart-libtv" || !project.libtvProjectId || !importLibtvProject || !saveCanvasProject) return;
    try {
      flushLibtvPending();
      if (!showCanvasHomeRef.current && activeCanvasIdRef.current === project.id) {
        setProjectStatus(t("infiniteCanvas.libtvRefreshingRemoteCanvas"));
      }
      const imported = await importLibtvProject(project.libtvProjectId);
      const merged = mergeLibtvRemoteSnapshot(project, imported, new Set(getPendingLibtvNodeIds()));
      const saved = await saveCanvasProject(project.id, {
        title: project.libtvProjectName || project.title || imported.title,
        icon: "libtv",
        canvasType: "forart-libtv",
        source: "libtv",
        libtvProjectId: project.libtvProjectId,
        libtvProjectName: project.libtvProjectName || project.title || imported.title,
        nodes: merged.nodes,
        connections: merged.connections,
        groups: merged.groups,
        viewport: merged.viewport,
      });
      const refreshedProject = normalizeCanvasProject(saved.canvas);
      updateCanvasProjectRecord(saved.record || saved.canvas);
      if (refreshedProject && activeCanvasIdRef.current === project.id && !showCanvasHomeRef.current) {
        applyCanvasProject(refreshedProject);
        setProjectStatus(t("infiniteCanvas.canvasReady"));
      }
    } catch (error) {
      if (activeCanvasIdRef.current === project.id && !showCanvasHomeRef.current) {
        setProjectStatus(error instanceof Error ? error.message : String(error));
      }
    }
  }, [applyCanvasProject, flushLibtvPending, getPendingLibtvNodeIds, t, updateCanvasProjectRecord]);

  const openCanvasProject = useCallback(async (canvasId: string) => {
    if (!canvasId || !window.easyTool?.loadCanvasProject) return;
    setProjectStatus(t("infiniteCanvas.openingCanvas"));
    const project = normalizeCanvasProject(await window.easyTool.loadCanvasProject(canvasId));
    if (!project) {
      setProjectStatus(t("infiniteCanvas.canvasNotFound"));
      await refreshCanvasProjects();
      return;
    }
    applyCanvasProject(project);
    updateCanvasProjectRecord(project);
    setProjectStatus(t("infiniteCanvas.canvasReady"));
    void refreshLibtvCanvasFromRemote(project);
  }, [applyCanvasProject, refreshCanvasProjects, refreshLibtvCanvasFromRemote, t, updateCanvasProjectRecord]);

  const createCanvasProjectFromDraft = useCallback(async () => {
    const title = projectDraftTitle.trim() || `${t("infiniteCanvas.canvasBaseName")} ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    const initialCanvas = createInitialCanvas();
    if (!window.easyTool?.createCanvas) {
      setProjectStatus(t("infiniteCanvas.canvasDesktopRequired"));
      return;
    }
    setProjectStatus(t("infiniteCanvas.creatingCanvas"));
    const created = await window.easyTool.createCanvas({ title, nodes: initialCanvas.nodes, connections: initialCanvas.connections, groups: initialCanvas.groups, viewport: initialCanvas.viewport });
    const project = normalizeCanvasProject(created.canvas);
    const record = normalizeCanvasRecord(created.record || created.canvas);
    if (record) updateCanvasProjectRecord(record);
    if (project) applyCanvasProject(project);
    if (project) setSelectedHomeCanvasId(project.id);
    setProjectDraftTitle("");
    setProjectStatus(t("infiniteCanvas.canvasReady"));
  }, [applyCanvasProject, projectDraftTitle, t, updateCanvasProjectRecord]);

  const submitRenameCanvasProject = useCallback(async (canvasId: string) => {
    const title = renamingTitle.trim();
    if (!canvasId || !title || !window.easyTool?.updateCanvasMeta) {
      setRenamingCanvasId("");
      return;
    }
    const result = await window.easyTool.updateCanvasMeta(canvasId, { title });
    updateCanvasProjectRecord(result.record || result.canvas);
    if (canvasId === activeCanvasIdRef.current) setActiveCanvasTitle(title);
    setRenamingCanvasId("");
    setRenamingTitle("");
  }, [renamingTitle, updateCanvasProjectRecord]);

  const deleteCanvasProject = useCallback(async (canvasId: string) => {
    if (!canvasId || !window.easyTool?.deleteCanvas) return;
    setConfirmingDeleteCanvasId("");
    await window.easyTool.deleteCanvas(canvasId);
    const nextProjects = await refreshCanvasProjects();
    setSelectedHomeCanvasId((current) => (current === canvasId ? nextProjects[0]?.id || "" : current));
    if (canvasId === activeCanvasIdRef.current && showCanvasHome) {
      setActiveCanvasId("");
      setActiveCanvasTitle(t("infiniteCanvas.untitledCanvas"));
      return;
    }
    if (canvasId === activeCanvasIdRef.current) {
      const nextProject = nextProjects.find((project) => project.id !== canvasId) || nextProjects[0];
      if (nextProject) {
        await openCanvasProject(nextProject.id);
      } else if (window.easyTool.createCanvas) {
        const initialCanvas = createInitialCanvas();
        const created = await window.easyTool.createCanvas({ title: t("infiniteCanvas.untitledCanvas"), nodes: initialCanvas.nodes, connections: initialCanvas.connections, groups: initialCanvas.groups, viewport: initialCanvas.viewport });
        const project = normalizeCanvasProject(created.canvas);
        const record = normalizeCanvasRecord(created.record || created.canvas);
        if (record) setCanvasProjects([record]);
        if (project) applyCanvasProject(project);
      }
    }
  }, [applyCanvasProject, openCanvasProject, refreshCanvasProjects, showCanvasHome, t]);

  const searchLibtvProjects = useCallback(async (queryOverride?: string) => {
    const query = queryOverride !== undefined ? queryOverride.trim() : libtvProjectDraftId.trim();
    const directProjectId = parseLibtvProjectInput(query);
    if (directProjectId) {
      setSelectedLibtvProjectUuid(directProjectId);
      setLibtvProjectResults([{ uuid: directProjectId, name: directProjectId }]);
      showLibtvStatus(t("infiniteCanvas.libtvDirectProjectReady"), "ready");
      return;
    }
    if (!window.libtv?.searchProjects || libtvImporting) return;
    setLibtvImporting(true);
    setLibtvImportProgress(null);
    showLibtvStatus(t("infiniteCanvas.libtvSearchingProjects"), "busy", 0);
    try {
      const result = await window.libtv.searchProjects({ pageSize: 100 });
      setLibtvProjectResults(result.projects || []);
      setSelectedLibtvProjectUuid(result.projects?.[0]?.uuid || "");
      showLibtvStatus((result.projects || []).length ? t("infiniteCanvas.libtvSearchSuccess", { count: result.projects.length, total: result.total || result.projects.length }) : t("infiniteCanvas.libtvNoProjectsFound"), "ready");
    } catch (error) {
      showLibtvStatus(error instanceof Error ? error.message : String(error), "error", 7000);
    } finally {
      setLibtvImporting(false);
    }
  }, [libtvImporting, libtvProjectDraftId, showLibtvStatus, t]);

  const importLibtvProjectFromDraft = useCallback(async (projectUuid?: string) => {
    const projectId = projectUuid || selectedLibtvProjectUuid || parseLibtvProjectInput(libtvProjectDraftId) || libtvProjectDraftId.trim();
    if (!projectId || !window.libtv?.importProject || !window.easyTool?.createCanvas || libtvImporting) return;
    const sourceProject = libtvProjectResults.find((project) => project.uuid === projectId);
    const fallbackTitle = projectId;
    const displayTitle = String(sourceProject?.name || "").trim() || fallbackTitle;
    const temporaryCardId = `libtv_import_${projectId}`;
    const startedAt = Date.now();
    setLibtvImporting(true);
    setLibtvImportProgress({ projectId, stage: "loadingProject" });
    showLibtvStatus(t("infiniteCanvas.libtvImporting"), "busy", 0);
    setCanvasHomeMode("local");
    setShowCanvasHome(true);
    setSelectedHomeCanvasId(temporaryCardId);
    setLibtvImportCards((current) => [
      {
        id: temporaryCardId,
        title: displayTitle,
        icon: "libtv",
        color: "",
        pinned: false,
        createdAt: startedAt,
        updatedAt: startedAt,
        nodeCount: 0,
        isLibtvImporting: true,
        libtvProjectId: projectId,
        libtvImportProgress: { projectId, stage: "loadingProject" },
      },
      ...current.filter((project) => project.libtvProjectId !== projectId),
    ]);
    try {
      const imported = await window.libtv.importProject(projectId);
      const creatingProgress: LibtvImportProgress = { projectId, stage: "creatingCanvas" };
      setLibtvImportProgress((current) => mergeLibtvImportProgress(current, creatingProgress));
      setLibtvImportCards((current) => current.map((project) => (
        project.libtvProjectId === projectId
          ? { ...project, libtvImportProgress: mergeLibtvImportProgress(project.libtvImportProgress, creatingProgress) }
          : project
      )));
      const title = String(sourceProject?.name || "").trim() || imported.title || t("infiniteCanvas.libtvImportedCanvas", { projectId });
      const created = await window.easyTool.createCanvas({
        title,
        icon: "libtv",
        canvasType: "forart-libtv",
        source: "libtv",
        libtvProjectId: projectId,
        libtvProjectName: title,
        nodes: imported.nodes,
        connections: imported.connections,
        groups: imported.groups,
        viewport: imported.viewport || { x: 0, y: 0, scale: 1 },
      });
      const project = normalizeCanvasProject(created.canvas);
      const record = normalizeCanvasRecord(created.record || created.canvas);
      if (record) updateCanvasProjectRecord(record);
      const doneProgress: LibtvImportProgress = { projectId, stage: "done", current: imported.nodes.length, total: imported.nodes.length };
      setLibtvImportProgress((current) => mergeLibtvImportProgress(current, doneProgress));
      setLibtvImportCards((current) => current.filter((item) => item.libtvProjectId !== projectId));
      setSelectedHomeCanvasId(record?.id || project?.id || "");
      showLibtvStatus(t("infiniteCanvas.libtvImportSuccess", { count: imported.nodes.length }), "ready");
    } catch (error) {
      setLibtvImportCards((current) => current.filter((item) => item.libtvProjectId !== projectId));
      showLibtvStatus(error instanceof Error ? error.message : String(error), "error", 7000);
    } finally {
      setLibtvImporting(false);
      setLibtvImportProgress(null);
    }
  }, [libtvImporting, libtvProjectDraftId, libtvProjectResults, selectedLibtvProjectUuid, showLibtvStatus, t, updateCanvasProjectRecord]);

  const openLibtvHome = useCallback(() => {
    setCanvasHomeMode("libtv");
    if (!libtvProjectResults.length && !libtvImporting) void searchLibtvProjects("");
  }, [libtvImporting, libtvProjectResults.length, searchLibtvProjects]);

  useEffect(() => {
    let canceled = false;
    async function loadDiskCanvasProjects() {
      if (!window.easyTool?.listCanvases || !window.easyTool?.loadCanvasProject) {
        setProjectStatus(t("infiniteCanvas.canvasDesktopRequired"));
        setCanvasProjects([]);
        setShowCanvasHome(true);
        return;
      }
      try {
        const projects = await refreshCanvasProjects();
        if (canceled) return;
        const lastCanvas = readLastCanvasState();
        if (!lastCanvas.showHome && lastCanvas.canvasId && projects.some((project) => project.id === lastCanvas.canvasId)) {
          await openCanvasProject(lastCanvas.canvasId);
          return;
        }
        setShowCanvasHome(true);
        if (!projects.length) setProjectStatus(t("infiniteCanvas.noCanvases"));
      } catch (error) {
        if (!canceled) {
          setShowCanvasHome(true);
          setProjectStatus(error instanceof Error ? error.message : String(error));
        }
      }
    }
    void loadDiskCanvasProjects();
    return () => {
      canceled = true;
    };
  }, [openCanvasProject, refreshCanvasProjects, t]);

  useEffect(() => {
    if (!activeCanvasId) return;
    if (!window.easyTool?.saveCanvasProject) return;
    const snapshot = {
      title: activeCanvasTitle,
      icon: activeProject?.icon,
      canvasType: activeProject?.canvasType,
      source: activeProject?.source,
      libtvProjectId: activeProject?.libtvProjectId,
      libtvProjectName: activeProject?.libtvProjectName,
      nodes,
      connections,
      groups,
      viewport,
    };
    const timeout = window.setTimeout(() => {
      void window.easyTool?.saveCanvasProject(activeCanvasId, snapshot).then((result) => updateCanvasProjectRecord(result.record || result.canvas));
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [activeCanvasId, activeCanvasTitle, activeProject, connections, groups, nodes, updateCanvasProjectRecord, viewport]);

  useEffect(() => {
    if (!window.libtv?.onImportProgress) return undefined;
    return window.libtv.onImportProgress((payload) => {
      setLibtvImportProgress((current) => mergeLibtvImportProgress(current, payload));
      setLibtvImportCards((current) => current.map((project) => (
        project.libtvProjectId === payload.projectId
          ? { ...project, libtvImportProgress: mergeLibtvImportProgress(project.libtvImportProgress, payload) }
          : project
      )));
      if (payload.message) {
        showLibtvStatus(payload.message, "busy", 0);
      }
    });
  }, [showLibtvStatus]);

  return {
    activeProject,
    activeCanvasTitle,
    activeCanvasId,
    activeCanvasIdRef,
    projectStatus,
    showCanvasHome,
    setShowCanvasHome,
    returnToCanvasHome,
    canvasHomeMode,
    setCanvasHomeMode,
    selectedHomeCanvasId,
    setSelectedHomeCanvasId,
    renamingCanvasId,
    setRenamingCanvasId,
    renamingTitle,
    setRenamingTitle,
    confirmingDeleteCanvasId,
    setConfirmingDeleteCanvasId,
    canvasSortMode,
    setCanvasSortMode,
    sortedCanvasProjects,
    libtvProjectResults,
    libtvProjectFilter,
    setLibtvProjectFilter,
    libtvImporting,
    libtvStatus,
    libtvStatusTone,
    setLibtvStatus: setTransientLibtvStatus,
    selectedLibtvProjectUuid,
    setSelectedLibtvProjectUuid,
    openLibtvHome,
    refreshCanvasProjects,
    refreshLibtvCanvasFromRemote,
    openCanvasProject,
    createCanvasProjectFromDraft,
    submitRenameCanvasProject,
    deleteCanvasProject,
    searchLibtvProjects,
    importLibtvProjectFromDraft,
  };
}
