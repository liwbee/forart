import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { replaceCanvasDocument } from "./canvasStore";
import { cloneCanvasNodesForNewCanvas } from "./canvasNodeClone";
import { sanitizeCanvasNodesForSave } from "./canvasSerialization";
import { stopLocalGenerationTasksForCanvas } from "./generation/generationTaskRegistry";
import { createCanvasNode } from "./nodes/registry";
import type { CanvasConnection, CanvasDocument, CanvasDocumentRecord, CanvasGroup, CanvasNode, CanvasNodeType, CanvasProjectRecord, CanvasSnapshot, Viewport } from "./types";
import type { CanvasHomeMode, CanvasSortMode, HomeCanvasRecord } from "./CanvasHomePanel";

const uid = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
const GROUP_PADDING = 32;
const CANVAS_NODE_TYPES = ["imageGenerator", "imageLoader", "prompt", "llm", "actionFission", "libtvImageGenerator"] as const satisfies readonly CanvasNodeType[];
const LAST_CANVAS_ID_KEY = "forart_infinite_canvas_last_canvas_id";
const LAST_CANVAS_HOME_KEY = "forart_infinite_canvas_show_home";
const OPEN_CANVAS_TABS_KEY = "forart_infinite_canvas_open_tabs";
const LAST_CANVAS_PROJECT_ID_KEY = "forart_infinite_canvas_last_project_id";
const CANVAS_TOAST_AUTO_HIDE_MS = 2000;

type StoredCanvasNode = Omit<CanvasNode, "type"> & {
  type: CanvasNodeType | "image";
};

export type CanvasDocumentTab = Pick<CanvasDocumentRecord, "id" | "title" | "icon" | "canvasType" | "source" | "updatedAt">;
export type CanvasProjectStatusTone = "busy" | "ready" | "error";

interface UseCanvasProjectsOptions {
  nodes: CanvasNode[];
  connections: CanvasConnection[];
  groups: CanvasGroup[];
  viewport: Viewport;
  setViewport: (viewport: Viewport) => void;
  setZoomInput: (value: string) => void;
  clearCanvasTransientState: () => void;
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

function normalizeCanvasTab(input: unknown): CanvasDocumentTab | null {
  const parsed = input as Partial<CanvasDocumentTab> | null;
  if (!parsed?.id) return null;
  return {
    id: String(parsed.id),
    title: String(parsed.title || "Untitled canvas"),
    icon: parsed.icon || "layers",
    canvasType: "forart",
    source: "forart",
    updatedAt: Number(parsed.updatedAt || 0),
  };
}

function readOpenCanvasTabs() {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(OPEN_CANVAS_TABS_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeCanvasTab).filter(Boolean) as CanvasDocumentTab[];
  } catch {
    return [];
  }
}

function writeOpenCanvasTabs(tabs: CanvasDocumentTab[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(OPEN_CANVAS_TABS_KEY, JSON.stringify(tabs));
}

function canvasTabFromRecord(record: CanvasDocumentRecord | CanvasDocument): CanvasDocumentTab {
  return {
    id: record.id,
    title: record.title || "Untitled canvas",
    icon: record.icon || "layers",
    canvasType: "forart",
    source: "forart",
    updatedAt: Number(record.updatedAt || 0),
  };
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

function normalizeStoredNode(node: StoredCanvasNode): CanvasNode | null {
  const storedType = node.type === "image" ? "imageLoader" : node.type;
  const normalizedType = storedType;
  if (!isCanvasNodeType(normalizedType)) return null;
  return {
    ...node,
    type: normalizedType,
    title: normalizedType === "imageGenerator" && (node.title === "Image" || node.title === "Upload" || node.title === "Generate") ? "Image Generation" : node.title,
    url: node.url?.startsWith("blob:") ? "" : node.url,
    imageMode: normalizedType === "imageGenerator" || normalizedType === "libtvImageGenerator" ? "imageGenerator" : normalizedType === "imageLoader" ? "asset" : node.imageMode,
    imageSource: normalizedType === "imageGenerator" || normalizedType === "libtvImageGenerator" ? "generated" : normalizedType === "imageLoader" ? "uploaded" : node.imageSource,
  };
}

function readLastCanvasProjectId() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(LAST_CANVAS_PROJECT_ID_KEY) || "";
}

function writeLastCanvasProjectId(projectId: string) {
  if (typeof window === "undefined") return;
  if (projectId) window.localStorage.setItem(LAST_CANVAS_PROJECT_ID_KEY, projectId);
  else window.localStorage.removeItem(LAST_CANVAS_PROJECT_ID_KEY);
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

function normalizeCanvasDocument(input: unknown): CanvasDocument | null {
  const parsed = input as Partial<CanvasDocument> | null;
  const snapshot = normalizeStoredCanvas(input);
  if (!parsed?.id || !snapshot) return null;
  const timestamp = Date.now();
  return {
    id: String(parsed.id),
    title: String(parsed.title || "Untitled canvas"),
    icon: parsed.icon || "layers",
    canvasType: "forart",
    source: "forart",
    projectId: String(parsed.projectId || ""),
    color: parsed.color || "",
    pinned: Boolean(parsed.pinned),
    createdAt: Number(parsed.createdAt || timestamp),
    updatedAt: Number(parsed.updatedAt || parsed.createdAt || timestamp),
    ...snapshot,
  };
}

function normalizeCanvasRecord(input: unknown): CanvasDocumentRecord | null {
  const parsed = input as Partial<CanvasDocumentRecord> | null;
  if (!parsed?.id) return null;
  const timestamp = Date.now();
  return {
    id: String(parsed.id),
    title: String(parsed.title || "Untitled canvas"),
    icon: parsed.icon || "layers",
    canvasType: "forart",
    source: "forart",
    projectId: String(parsed.projectId || ""),
    color: parsed.color || "",
    pinned: Boolean(parsed.pinned),
    createdAt: Number(parsed.createdAt || timestamp),
    updatedAt: Number(parsed.updatedAt || parsed.createdAt || timestamp),
    nodeCount: Number(parsed.nodeCount || 0),
  };
}

function normalizeCanvasProjectRecord(input: unknown): CanvasProjectRecord | null {
  const parsed = input as Partial<CanvasProjectRecord> | null;
  if (!parsed?.id) return null;
  const timestamp = Date.now();
  return {
    id: String(parsed.id),
    title: String(parsed.title || "New project"),
    color: parsed.color || "",
    createdAt: Number(parsed.createdAt || timestamp),
    updatedAt: Number(parsed.updatedAt || parsed.createdAt || timestamp),
  };
}

function cloneCanvasPayload<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

export function useCanvasProjects({
  nodes,
  connections,
  groups,
  viewport,
  setViewport,
  setZoomInput,
  clearCanvasTransientState,
  t,
}: UseCanvasProjectsOptions) {
  const [initialLastCanvasState] = useState(readLastCanvasState);
  const [canvasDocuments, setCanvasDocuments] = useState<CanvasDocumentRecord[]>([]);
  const [canvasProjects, setCanvasProjects] = useState<CanvasProjectRecord[]>([]);
  const [canvasTabs, setCanvasTabs] = useState<CanvasDocumentTab[]>(readOpenCanvasTabs);
  const [activeCanvasId, setActiveCanvasId] = useState("");
  const activeCanvasIdRef = useRef("");
  const [activeCanvasTitle, setActiveCanvasTitle] = useState(t("infiniteCanvas:untitledCanvas"));
  const [projectDraftTitle, setProjectDraftTitle] = useState("");
  const [renamingCanvasId, setRenamingCanvasId] = useState("");
  const [renamingProjectId, setRenamingProjectId] = useState("");
  const [renamingTitle, setRenamingTitle] = useState("");
  const [projectStatus, setProjectStatus] = useState("");
  const [projectStatusTone, setProjectStatusTone] = useState<CanvasProjectStatusTone>("ready");
  const projectStatusTimeoutRef = useRef<number | null>(null);
  const [showCanvasHome, setShowCanvasHome] = useState(initialLastCanvasState.showHome);
  const showCanvasHomeRef = useRef(initialLastCanvasState.showHome);
  const [canvasHomeMode, setCanvasHomeMode] = useState<CanvasHomeMode>("local");
  const [selectedHomeCanvasId, setSelectedHomeCanvasId] = useState(initialLastCanvasState.canvasId);
  const [activeProjectId, setActiveProjectIdState] = useState(readLastCanvasProjectId);
  const [canvasSortMode, setCanvasSortMode] = useState<CanvasSortMode>("recent");
  const [confirmingDeleteCanvasId, setConfirmingDeleteCanvasId] = useState("");
  const [confirmingDeleteProjectId, setConfirmingDeleteProjectId] = useState("");

  const setActiveProjectId = useCallback((projectId: string) => {
    setActiveProjectIdState(projectId);
    writeLastCanvasProjectId(projectId);
  }, []);

  const activeProject = useMemo(() => canvasDocuments.find((document) => document.id === activeCanvasId) || null, [activeCanvasId, canvasDocuments]);

  const sortedCanvasDocuments = useMemo(() => {
    const projects: HomeCanvasRecord[] = [
      ...canvasDocuments.filter((document) => (document.projectId || "") === activeProjectId),
    ];
    if (canvasSortMode === "name") {
      return projects.sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), undefined, { numeric: true, sensitivity: "base" }));
    }
    return projects.sort((a, b) => Number(b.updatedAt || b.createdAt) - Number(a.updatedAt || a.createdAt));
  }, [activeProjectId, canvasDocuments, canvasSortMode]);

  useEffect(() => {
    activeCanvasIdRef.current = activeCanvasId;
  }, [activeCanvasId]);

  useEffect(() => {
    writeOpenCanvasTabs(canvasTabs);
  }, [canvasTabs]);

  const showProjectStatus = useCallback((status: string, tone: CanvasProjectStatusTone = "ready", autoHideMs = CANVAS_TOAST_AUTO_HIDE_MS) => {
    if (projectStatusTimeoutRef.current) {
      window.clearTimeout(projectStatusTimeoutRef.current);
      projectStatusTimeoutRef.current = null;
    }
    setProjectStatus(status);
    setProjectStatusTone(tone);
    if (status && autoHideMs > 0) {
      projectStatusTimeoutRef.current = window.setTimeout(() => {
        setProjectStatus("");
        projectStatusTimeoutRef.current = null;
      }, autoHideMs);
    }
  }, []);

  useEffect(() => () => {
    if (projectStatusTimeoutRef.current) window.clearTimeout(projectStatusTimeoutRef.current);
  }, []);

  useEffect(() => {
    showCanvasHomeRef.current = showCanvasHome;
  }, [showCanvasHome]);

  const addOrUpdateCanvasTab = useCallback((recordInput: CanvasDocumentRecord | CanvasDocument | CanvasDocumentTab) => {
    const tab = normalizeCanvasTab(recordInput);
    if (!tab) return;
    setCanvasTabs((current) => (
      current.some((item) => item.id === tab.id)
        ? current.map((item) => (item.id === tab.id ? { ...item, ...tab } : item))
        : [...current, tab]
    ));
  }, []);

  const removeCanvasTabState = useCallback((canvasId: string) => {
    setCanvasTabs((current) => current.filter((item) => item.id !== canvasId));
  }, []);

  const reorderCanvasTabs = useCallback((draggedCanvasId: string, targetIndex: number) => {
    if (!draggedCanvasId) return;
    setCanvasTabs((current) => {
      const draggedTab = current.find((item) => item.id === draggedCanvasId);
      if (!draggedTab) return current;
      const withoutDragged = current.filter((item) => item.id !== draggedCanvasId);
      const insertIndex = Math.max(0, Math.min(targetIndex, withoutDragged.length));
      const next = [...withoutDragged];
      next.splice(insertIndex, 0, draggedTab);
      return next;
    });
  }, []);

  const applyCanvasDocument = useCallback((document: CanvasDocument) => {
    replaceCanvasDocument({ nodes: document.nodes, connections: document.connections, groups: document.groups });
    setViewport(document.viewport);
    setZoomInput(String(Math.round(document.viewport.scale * 100)));
    activeCanvasIdRef.current = document.id;
    setActiveCanvasId(document.id);
    setActiveCanvasTitle(document.title);
    setShowCanvasHome(false);
    writeLastCanvasState(document.id, false);
    addOrUpdateCanvasTab(document);
    clearCanvasTransientState();
  }, [addOrUpdateCanvasTab, clearCanvasTransientState, setViewport, setZoomInput]);

  const updateCanvasDocumentRecord = useCallback((recordInput: unknown) => {
    const record = normalizeCanvasRecord(recordInput);
    if (!record) return;
    setCanvasDocuments((current) => {
      const next = current.some((item) => item.id === record.id)
        ? current.map((item) => (item.id === record.id ? { ...item, ...record } : item))
        : [record, ...current];
      return [...next].sort((a, b) => Number(b.updatedAt || b.createdAt) - Number(a.updatedAt || a.createdAt));
    });
    setCanvasTabs((current) => current.map((item) => (item.id === record.id ? { ...item, ...canvasTabFromRecord(record) } : item)));
    if (record.id === activeCanvasIdRef.current) setActiveCanvasTitle(record.title);
  }, []);

  const saveActiveCanvasNow = useCallback(async () => {
    const canvasId = activeCanvasIdRef.current;
    if (!canvasId || !window.easyTool?.saveCanvas) return null;
    const project = canvasDocuments.find((item) => item.id === canvasId);
    const snapshot = {
      title: project?.title || activeCanvasTitle,
      icon: project?.icon,
      canvasType: project?.canvasType,
      source: project?.source,
      projectId: project?.projectId || "",
      nodes: sanitizeCanvasNodesForSave(nodes),
      connections,
      groups,
      viewport,
    };
    const result = await window.easyTool.saveCanvas(canvasId, snapshot);
    updateCanvasDocumentRecord(result.record || result.canvas);
    const tabRecord = normalizeCanvasRecord(result.record || result.canvas);
    if (tabRecord) addOrUpdateCanvasTab(tabRecord);
    return result;
  }, [activeCanvasTitle, addOrUpdateCanvasTab, canvasDocuments, connections, groups, nodes, updateCanvasDocumentRecord, viewport]);

  const returnToCanvasHome = useCallback(() => {
    void saveActiveCanvasNow();
    activeCanvasIdRef.current = "";
    setActiveCanvasId("");
    setActiveCanvasTitle(t("infiniteCanvas:untitledCanvas"));
    showCanvasHomeRef.current = true;
    setShowCanvasHome(true);
    writeLastCanvasState("", true);
    showProjectStatus("", "ready", 0);
    clearCanvasTransientState();
  }, [clearCanvasTransientState, saveActiveCanvasNow, showProjectStatus, t]);

  const refreshCanvasWorkspace = useCallback(async () => {
    if (!window.easyTool?.listCanvases) return [];
    const result = await window.easyTool.listCanvases();
    const projects = (result.canvases || []).map(normalizeCanvasRecord).filter(Boolean) as CanvasDocumentRecord[];
    const projectRecords = (result.projects || []).map(normalizeCanvasProjectRecord).filter(Boolean) as CanvasProjectRecord[];
    setCanvasDocuments(projects);
    setCanvasProjects(projectRecords);
    const nextActiveProjectId = projectRecords.some((project) => project.id === activeProjectId)
      ? activeProjectId
      : projectRecords[0]?.id || "";
    if (nextActiveProjectId !== activeProjectId) setActiveProjectId(nextActiveProjectId);
    return projects;
  }, [activeProjectId, setActiveProjectId]);

  const openCanvasDocument = useCallback(async (canvasId: string, options?: { skipSave?: boolean }) => {
    if (!canvasId || !window.easyTool?.loadCanvas) return;
    if (canvasId === activeCanvasIdRef.current && !showCanvasHomeRef.current) return;
    if (!options?.skipSave) await saveActiveCanvasNow();
    showProjectStatus(t("infiniteCanvas:openingCanvas"), "busy", 0);
    const project = normalizeCanvasDocument(await window.easyTool.loadCanvas(canvasId));
    if (!project) {
      showProjectStatus(t("infiniteCanvas:canvasNotFound"), "error", CANVAS_TOAST_AUTO_HIDE_MS);
      await refreshCanvasWorkspace();
      return;
    }
    applyCanvasDocument(project);
    updateCanvasDocumentRecord(project);
    showProjectStatus("", "ready", 0);
  }, [applyCanvasDocument, refreshCanvasWorkspace, saveActiveCanvasNow, showProjectStatus, t, updateCanvasDocumentRecord]);

  const closeCanvasTab = useCallback(async (canvasId: string) => {
    if (!canvasId) return;
    const isActiveCanvas = canvasId === activeCanvasIdRef.current;
    if (isActiveCanvas) await saveActiveCanvasNow();
    const currentTabs = canvasTabs;
    const closingIndex = currentTabs.findIndex((item) => item.id === canvasId);
    const nextTabs = currentTabs.filter((item) => item.id !== canvasId);
    removeCanvasTabState(canvasId);
    if (!isActiveCanvas) return;
    if (showCanvasHomeRef.current) {
      activeCanvasIdRef.current = "";
      setActiveCanvasId("");
      setActiveCanvasTitle(t("infiniteCanvas:untitledCanvas"));
      writeLastCanvasState("", true);
      return;
    }
    const nextTab = nextTabs[Math.max(0, closingIndex - 1)] || nextTabs[0] || null;
    if (nextTab) {
      await openCanvasDocument(nextTab.id, { skipSave: true });
      return;
    }
    activeCanvasIdRef.current = "";
    setActiveCanvasId("");
    setActiveCanvasTitle(t("infiniteCanvas:untitledCanvas"));
    showCanvasHomeRef.current = true;
    setShowCanvasHome(true);
    writeLastCanvasState("", true);
    showProjectStatus("", "ready", 0);
    clearCanvasTransientState();
  }, [canvasTabs, clearCanvasTransientState, openCanvasDocument, removeCanvasTabState, saveActiveCanvasNow, showProjectStatus, t]);

  const createCanvasDocumentFromDraft = useCallback(async () => {
    const title = projectDraftTitle.trim() || `${t("infiniteCanvas:canvasBaseName")} ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    const initialCanvas = createInitialCanvas();
    if (!window.easyTool?.createCanvas) {
      showProjectStatus(t("infiniteCanvas:canvasDesktopRequired"), "error", CANVAS_TOAST_AUTO_HIDE_MS);
      return;
    }
    showProjectStatus(t("infiniteCanvas:creatingCanvas"), "busy", 0);
    const targetProjectId = activeProjectId || canvasProjects[0]?.id || "";
    if (!targetProjectId) {
      showProjectStatus(t("infiniteCanvas:canvasDesktopRequired"), "error", CANVAS_TOAST_AUTO_HIDE_MS);
      return;
    }
    const created = await window.easyTool.createCanvas({ title, projectId: targetProjectId, nodes: initialCanvas.nodes, connections: initialCanvas.connections, groups: initialCanvas.groups, viewport: initialCanvas.viewport });
    const project = normalizeCanvasDocument(created.canvas);
    const record = normalizeCanvasRecord(created.record || created.canvas);
    if (record) updateCanvasDocumentRecord(record);
    if (project) applyCanvasDocument(project);
    if (project) setSelectedHomeCanvasId(project.id);
    setProjectDraftTitle("");
    showProjectStatus("", "ready", 0);
  }, [activeProjectId, applyCanvasDocument, canvasProjects, projectDraftTitle, showProjectStatus, t, updateCanvasDocumentRecord]);

  const submitRenameCanvasDocument = useCallback(async (canvasId: string) => {
    const title = renamingTitle.trim();
    if (!canvasId || !title || !window.easyTool?.updateCanvasMeta) {
      setRenamingCanvasId("");
      return;
    }
    const result = await window.easyTool.updateCanvasMeta(canvasId, { title });
    updateCanvasDocumentRecord(result.record || result.canvas);
    if (canvasId === activeCanvasIdRef.current) setActiveCanvasTitle(title);
    setRenamingCanvasId("");
    setRenamingProjectId("");
    setRenamingTitle("");
  }, [renamingTitle, updateCanvasDocumentRecord]);

  const createCanvasProject = useCallback(async () => {
    if (!window.easyTool?.createCanvasProject) {
      showProjectStatus(t("infiniteCanvas:canvasDesktopRequired"), "error", CANVAS_TOAST_AUTO_HIDE_MS);
      return;
    }
    const siblingNames = new Set(canvasProjects.map((project) => project.title));
    const baseName = t("infiniteCanvas:projectBaseName");
    let title = baseName;
    let index = 2;
    while (siblingNames.has(title)) {
      title = `${baseName} ${index}`;
      index += 1;
    }
    const result = await window.easyTool.createCanvasProject({ title });
    const project = normalizeCanvasProjectRecord(result.project);
    if (project) {
      setCanvasProjects((current) => [...current.filter((item) => item.id !== project.id), project]);
      setActiveProjectId(project.id);
      setSelectedHomeCanvasId("");
      setRenamingProjectId(project.id);
      setRenamingTitle(project.title);
      setConfirmingDeleteCanvasId("");
      setConfirmingDeleteProjectId("");
    }
  }, [canvasProjects, showProjectStatus, t]);

  const selectCanvasProject = useCallback((projectId: string) => {
    setActiveProjectId(projectId);
    setSelectedHomeCanvasId("");
    setRenamingCanvasId("");
    setRenamingProjectId("");
    setRenamingTitle("");
    setConfirmingDeleteCanvasId("");
    setConfirmingDeleteProjectId("");
  }, []);

  const submitRenameCanvasProject = useCallback(async (projectId: string) => {
    const title = renamingTitle.trim();
    if (!projectId || !title || !window.easyTool?.updateCanvasProject) {
      setRenamingProjectId("");
      return;
    }
    try {
      const result = await window.easyTool.updateCanvasProject(projectId, { title });
      const project = normalizeCanvasProjectRecord(result.project);
      if (project) setCanvasProjects((current) => current.map((item) => (item.id === project.id ? { ...item, ...project } : item)));
    } finally {
      setRenamingProjectId("");
      setRenamingTitle("");
    }
  }, [renamingTitle]);

  const deleteCanvasProject = useCallback(async (projectId: string) => {
    if (!projectId || !window.easyTool?.deleteCanvasProject) return;
    setConfirmingDeleteProjectId("");
    try {
      const canvasIdsInProject = canvasDocuments.filter((document) => document.projectId === projectId).map((document) => document.id);
      await Promise.all(canvasIdsInProject.map((canvasId) => stopLocalGenerationTasksForCanvas(canvasId)));
      const result = await window.easyTool.deleteCanvasProject(projectId);
      const deletedCanvasIds = new Set(Array.isArray(result.deletedCanvasIds) ? result.deletedCanvasIds : []);
      deletedCanvasIds.forEach((canvasId) => removeCanvasTabState(canvasId));
      setCanvasProjects((current) => current.filter((project) => project.id !== projectId));
      const nextProjects = await refreshCanvasWorkspace();
      setSelectedHomeCanvasId("");
      if (activeProjectId === projectId) setActiveProjectId(canvasProjects.find((project) => project.id !== projectId)?.id || "");
      if (deletedCanvasIds.has(activeCanvasIdRef.current)) {
        setActiveCanvasId("");
        setActiveCanvasTitle(t("infiniteCanvas:untitledCanvas"));
        setShowCanvasHome(true);
        setSelectedHomeCanvasId(nextProjects[0]?.id || "");
      }
    } catch (error) {
      showProjectStatus(error instanceof Error ? error.message : String(error), "error", CANVAS_TOAST_AUTO_HIDE_MS);
    }
  }, [activeProjectId, canvasDocuments, canvasProjects, refreshCanvasWorkspace, removeCanvasTabState, setActiveProjectId, setShowCanvasHome, showProjectStatus, t]);

  const deleteCanvasDocument = useCallback(async (canvasId: string) => {
    if (!canvasId || !window.easyTool?.deleteCanvas) return;
    setConfirmingDeleteCanvasId("");
    setConfirmingDeleteProjectId("");
    await stopLocalGenerationTasksForCanvas(canvasId);
    await window.easyTool.deleteCanvas(canvasId);
    removeCanvasTabState(canvasId);
    const nextProjects = await refreshCanvasWorkspace();
    setSelectedHomeCanvasId((current) => (current === canvasId ? nextProjects[0]?.id || "" : current));
    if (canvasId === activeCanvasIdRef.current && showCanvasHome) {
      setActiveCanvasId("");
      setActiveCanvasTitle(t("infiniteCanvas:untitledCanvas"));
      return;
    }
    if (canvasId === activeCanvasIdRef.current) {
      const nextProject = nextProjects.find((project) => project.id !== canvasId) || nextProjects[0];
      if (nextProject) {
        await openCanvasDocument(nextProject.id, { skipSave: true });
      } else if (window.easyTool.createCanvas) {
        const initialCanvas = createInitialCanvas();
        const created = await window.easyTool.createCanvas({ title: t("infiniteCanvas:untitledCanvas"), projectId: activeProjectId || canvasProjects[0]?.id || "", nodes: initialCanvas.nodes, connections: initialCanvas.connections, groups: initialCanvas.groups, viewport: initialCanvas.viewport });
        const project = normalizeCanvasDocument(created.canvas);
        const record = normalizeCanvasRecord(created.record || created.canvas);
        if (record) setCanvasDocuments([record]);
        if (project) applyCanvasDocument(project);
      }
    }
  }, [activeProjectId, applyCanvasDocument, canvasProjects, openCanvasDocument, refreshCanvasWorkspace, removeCanvasTabState, showCanvasHome, t]);

  const duplicateCanvasDocument = useCallback(async (canvasId: string) => {
    if (!canvasId || !window.easyTool?.loadCanvas || !window.easyTool?.createCanvas) return;
    if (canvasId === activeCanvasIdRef.current) await saveActiveCanvasNow();
    try {
      const project = normalizeCanvasDocument(await window.easyTool.loadCanvas(canvasId));
      if (!project) {
        showProjectStatus(t("infiniteCanvas:canvasNotFound"), "error", CANVAS_TOAST_AUTO_HIDE_MS);
        return;
      }
      const created = await window.easyTool.createCanvas({
        title: t("infiniteCanvas:canvasCopyName", { title: project.title || t("infiniteCanvas:untitledCanvas") }),
        icon: project.icon,
        canvasType: project.canvasType,
        source: project.source,
        projectId: project.projectId || "",
        nodes: cloneCanvasNodesForNewCanvas(project.nodes),
        connections: cloneCanvasPayload(project.connections),
        groups: cloneCanvasPayload(project.groups),
        viewport: cloneCanvasPayload(project.viewport),
      });
      const record = normalizeCanvasRecord(created.record || created.canvas);
      if (record) {
        updateCanvasDocumentRecord(record);
        setSelectedHomeCanvasId(record.id);
      }
      showProjectStatus(t("infiniteCanvas:canvasDuplicated"), "ready", CANVAS_TOAST_AUTO_HIDE_MS);
    } catch (error) {
      showProjectStatus(error instanceof Error ? error.message : String(error), "error", CANVAS_TOAST_AUTO_HIDE_MS);
    }
  }, [saveActiveCanvasNow, showProjectStatus, t, updateCanvasDocumentRecord]);

  const moveCanvasToProject = useCallback(async (canvasId: string, projectId: string) => {
    if (!canvasId) return;
    const moveCanvas = window.easyTool?.moveCanvasToProject;
    if (!moveCanvas) return;
    try {
      const result = await moveCanvas(canvasId, projectId);
      updateCanvasDocumentRecord(result.record || result.canvas);
      setSelectedHomeCanvasId("");
      showProjectStatus(t("infiniteCanvas:canvasMoved"), "ready", CANVAS_TOAST_AUTO_HIDE_MS);
    } catch (error) {
      showProjectStatus(error instanceof Error ? error.message : String(error), "error", CANVAS_TOAST_AUTO_HIDE_MS);
    }
  }, [showProjectStatus, t, updateCanvasDocumentRecord]);

  useEffect(() => {
    let canceled = false;
    async function loadDiskCanvasProjects() {
      if (!window.easyTool?.listCanvases || !window.easyTool?.loadCanvas) {
        showProjectStatus(t("infiniteCanvas:canvasDesktopRequired"), "error", CANVAS_TOAST_AUTO_HIDE_MS);
        setCanvasDocuments([]);
        setShowCanvasHome(true);
        return;
      }
      try {
        const projects = await refreshCanvasWorkspace();
        if (canceled) return;
        const projectMap = new Map(projects.map((project) => [project.id, project]));
        setCanvasTabs((current) => current
          .filter((tab) => projectMap.has(tab.id))
          .map((tab) => canvasTabFromRecord(projectMap.get(tab.id)!)));
        const lastCanvas = readLastCanvasState();
        if (!lastCanvas.showHome && lastCanvas.canvasId && projects.some((project) => project.id === lastCanvas.canvasId)) {
          await openCanvasDocument(lastCanvas.canvasId);
          return;
        }
        setShowCanvasHome(true);
        if (!projects.length) showProjectStatus(t("infiniteCanvas:noCanvases"), "ready");
      } catch (error) {
        if (!canceled) {
          setShowCanvasHome(true);
          showProjectStatus(error instanceof Error ? error.message : String(error), "error", CANVAS_TOAST_AUTO_HIDE_MS);
        }
      }
    }
    void loadDiskCanvasProjects();
    return () => {
      canceled = true;
    };
  }, [openCanvasDocument, refreshCanvasWorkspace, showProjectStatus, t]);

  useEffect(() => {
    if (!activeCanvasId) return;
    if (!window.easyTool?.saveCanvas) return;
    const snapshot = {
      title: activeCanvasTitle,
      icon: activeProject?.icon,
      canvasType: activeProject?.canvasType,
      source: activeProject?.source,
      projectId: activeProject?.projectId || "",
      nodes: sanitizeCanvasNodesForSave(nodes),
      connections,
      groups,
      viewport,
    };
    const timeout = window.setTimeout(() => {
      void window.easyTool?.saveCanvas(activeCanvasId, snapshot).then((result) => updateCanvasDocumentRecord(result.record || result.canvas));
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [activeCanvasId, activeCanvasTitle, activeProject, connections, groups, nodes, updateCanvasDocumentRecord, viewport]);

  return {
    activeProject,
    activeCanvasTitle,
    activeCanvasId,
    activeCanvasIdRef,
    canvasTabs,
    projectStatus,
    projectStatusTone,
    showCanvasHome,
    setShowCanvasHome,
    returnToCanvasHome,
    canvasHomeMode,
    setCanvasHomeMode,
    selectedHomeCanvasId,
    setSelectedHomeCanvasId,
    activeProjectId,
    canvasProjects,
    renamingCanvasId,
    setRenamingCanvasId,
    renamingProjectId,
    setRenamingProjectId,
    renamingTitle,
    setRenamingTitle,
    confirmingDeleteCanvasId,
    setConfirmingDeleteCanvasId,
    confirmingDeleteProjectId,
    setConfirmingDeleteProjectId,
    canvasSortMode,
    setCanvasSortMode,
    sortedCanvasDocuments,
    refreshCanvasWorkspace,
    openCanvasDocument,
    closeCanvasTab,
    reorderCanvasTabs,
    createCanvasDocumentFromDraft,
    createCanvasProject,
    selectCanvasProject,
    submitRenameCanvasDocument,
    submitRenameCanvasProject,
    duplicateCanvasDocument,
    moveCanvasToProject,
    deleteCanvasDocument,
    deleteCanvasProject,
  };
}
