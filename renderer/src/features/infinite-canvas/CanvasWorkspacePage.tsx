import { ListTodo, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { CanvasTransferProgress, CanvasTransferType } from "../../app/appConfig";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/skeleton";
import { Tabs, TabsContent } from "../../components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { getActiveForartConfig } from "../../data-source/runtime";
import { invalidatePermissions, refreshPermissions, usePermission } from "../permissions";
import { CanvasDocumentTabs } from "./CanvasDocumentTabs";
import { createCanvasAutosaveScheduler, type CanvasAutosaveScheduler } from "./canvasAutosaveScheduler";
import { setCanvasSaveStatus } from "./canvasSaveStatusStore";
import { CanvasTransferProgressDialog, type ActiveCanvasTransfer } from "./CanvasTransferProgressDialog";
import { ReactFlowCanvasPage } from "./ReactFlowCanvasPage";
import { CanvasWorkspaceHome } from "./CanvasWorkspaceHome";
import { CanvasFloatingPanel } from "./components/CanvasFloatingPanel";
import { readCanvasViewport, writeCanvasViewport } from "./canvasViewportStorage";
import {
  canvasSnapshotForStorage,
  serializeCanvasDocument,
  storedCanvasContentSignature,
} from "./canvasSnapshotSemantics";
import {
  connectGenerationTaskEvents,
  hydrateRecentGenerationTasks,
  hydrateGenerationTasks,
  isGenerationTaskActive,
  useGenerationTaskCache,
} from "./generation/generationTaskCache";
import { GenerationTaskCenter } from "./generation/GenerationTaskCenter";
import {
  emptyCanvasSnapshot,
  normalizeCanvasDocument,
  normalizeCanvasProject,
  normalizeCanvasRecord,
  tabFromRecord,
  type CanvasDocumentTab,
  type CanvasProjectRecord,
  type CanvasRecord,
  type NativeCanvasDocument,
  type NativeCanvasSnapshot,
} from "./canvasWorkspaceTypes";

const OPEN_TABS_KEY = "forart_infinite_canvas_open_tabs";
const LAST_CANVAS_ID_KEY = "forart_infinite_canvas_last_canvas_id";
const SHOW_HOME_KEY = "forart_infinite_canvas_show_home";
const LAST_PROJECT_ID_KEY = "forart_infinite_canvas_last_project_id";

interface SavedCanvasPersistenceState {
  content: string;
  document: string;
}

function readStoredTabs(): CanvasDocumentTab[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(OPEN_TABS_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (item?.readOnly) {
        const remoteCanvasId = String(item.remoteCanvasId || "");
        if (!remoteCanvasId) return [];
        return [{
          id: String(item.id || `shared:${remoteCanvasId}`),
          title: String(item.title || "Shared canvas"),
          updatedAt: Number(item.updatedAt || 0),
          projectId: String(item.projectId || "") || undefined,
          readOnly: true,
          remoteCanvasId,
          remoteUnavailable: Boolean(item.remoteUnavailable),
        }];
      }
      const record = normalizeCanvasRecord(item);
      return record ? [tabFromRecord(record)] : [];
    });
  } catch {
    return [];
  }
}

function objectValue(input: unknown) {
  return input && typeof input === "object" ? input as Record<string, unknown> : {};
}

interface CanvasWorkspacePageProps {
  imageDownloadPath?: string;
  serverUrl?: string;
  sharedCanvasesEnabled?: boolean;
}

function rewriteRemoteAssetUrls<T>(value: T, serverUrl: string): T {
  if (Array.isArray(value)) return value.map((item) => rewriteRemoteAssetUrls(item, serverUrl)) as T;
  if (!value || typeof value !== "object") {
    if (typeof value !== "string" || !value.startsWith("/api/canvas-exchange/")) return value;
    const token = getActiveForartConfig()?.serverAuthToken || "";
    const resolved = new URL(value, serverUrl);
    if (token && /\/assets\//.test(resolved.pathname)) resolved.searchParams.set("forart_token", token);
    return resolved.toString() as T;
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewriteRemoteAssetUrls(item, serverUrl)])) as T;
}

async function remoteFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const token = getActiveForartConfig()?.serverAuthToken || "";
  const response = await fetch(input, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
  if (response.status === 401) invalidatePermissions();
  if (response.status === 403) void refreshPermissions();
  return response;
}

export function CanvasWorkspacePage({ imageDownloadPath, serverUrl = "", sharedCanvasesEnabled = false }: CanvasWorkspacePageProps) {
  const { t } = useTranslation();
  const canViewSharedCanvases = sharedCanvasesEnabled;
  const serverAuthToken = getActiveForartConfig()?.serverAuthToken || "";
  const canEditSharedProjects = usePermission("shared_canvas.project_edit");
  const canDeleteSharedProjects = usePermission("shared_canvas.project_delete");
  const canReorderSharedProjects = usePermission("shared_canvas.project_reorder");
  const canEditSharedCanvases = usePermission("shared_canvas.canvas_edit");
  const canDeleteSharedCanvases = usePermission("shared_canvas.canvas_delete");
  const canCopySharedCanvases = usePermission("shared_canvas.copy_to_local");
  const [canvases, setCanvases] = useState<CanvasRecord[]>([]);
  const [projects, setProjects] = useState<CanvasProjectRecord[]>([]);
  const [sharedCanvases, setSharedCanvases] = useState<CanvasRecord[]>([]);
  const [sharedProjects, setSharedProjects] = useState<CanvasProjectRecord[]>([]);
  const [homeSource, setHomeSource] = useState<"local" | "shared">("local");
  const [tabs, setTabs] = useState<CanvasDocumentTab[]>(readStoredTabs);
  const [activeProjectId, setActiveProjectId] = useState(() => window.localStorage.getItem(LAST_PROJECT_ID_KEY) || "");
  const [activeSharedProjectId, setActiveSharedProjectId] = useState("");
  const [activeCanvasId, setActiveCanvasId] = useState("");
  const [activeDocument, setActiveDocument] = useState<NativeCanvasDocument | null>(null);
  const [showHome, setShowHome] = useState(() => window.localStorage.getItem(SHOW_HOME_KEY) !== "false");
  const [busy, setBusy] = useState(false);
  const [loadingCanvas, setLoadingCanvas] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [taskCenterOpen, setTaskCenterOpen] = useState(false);
  const [activeCanvasTransfer, setActiveCanvasTransfer] = useState<ActiveCanvasTransfer | null>(null);
  const activeTaskCount = useGenerationTaskCache((state) => Object.values(state.tasksById).filter(isGenerationTaskActive).length);
  const activeCanvasIdRef = useRef("");
  const activeDocumentRef = useRef<NativeCanvasDocument | null>(null);
  const activeReadOnlyRef = useRef(false);
  const showHomeRef = useRef(showHome);
  const snapshotRef = useRef<NativeCanvasSnapshot>(emptyCanvasSnapshot());
  const persistedViewportRef = useRef<NativeCanvasSnapshot["viewport"]>({ x: 0, y: 0, zoom: 1 });
  const snapshotVersionRef = useRef(0);
  const lastSavedPersistenceRef = useRef<SavedCanvasPersistenceState | null>(null);
  const autosaveSchedulerRef = useRef<CanvasAutosaveScheduler | null>(null);
  const allowEmptySaveRef = useRef(false);
  const saveSequenceRef = useRef(0);
  const saveSessionIdRef = useRef(crypto.randomUUID());
  const saveSessionStartedAtRef = useRef(Date.now());
  const lastSaveErrorRef = useRef("");
  const initialRestoreRef = useRef(false);

  const markSharedTabsUnavailable = useCallback(() => {
    setTabs((current) => current.map((tab) => tab.readOnly ? { ...tab, remoteUnavailable: true } : tab));
  }, []);

  const markSharedTabsAvailable = useCallback(() => {
    setTabs((current) => current.map((tab) => tab.readOnly ? { ...tab, remoteUnavailable: false } : tab));
  }, []);

  const markSharedTabUnavailable = useCallback((tabId: string) => {
    setTabs((current) => current.map((tab) => tab.id === tabId ? { ...tab, remoteUnavailable: true } : tab));
  }, []);

  const markSharedTabAvailable = useCallback((tabId: string) => {
    setTabs((current) => current.map((tab) => tab.id === tabId ? { ...tab, remoteUnavailable: false } : tab));
  }, []);

  useEffect(() => {
    if (!canViewSharedCanvases) {
      setHomeSource("local");
      markSharedTabsUnavailable();
    }
  }, [canViewSharedCanvases, markSharedTabsUnavailable]);

  useEffect(() => window.easyTool?.onCanvasTransferProgress?.((progress: CanvasTransferProgress) => {
    setActiveCanvasTransfer((current) => current?.operationId === progress.operationId
      ? { ...progress, canceling: current.canceling }
      : current);
  }), []);

  const upsertCanvas = useCallback((record: CanvasRecord) => {
    setCanvases((current) => current.some((item) => item.id === record.id)
      ? current.map((item) => item.id === record.id ? record : item)
      : [record, ...current]);
    setTabs((current) => current.map((tab) => tab.id === record.id ? tabFromRecord(record) : tab));
  }, []);

  const adoptSavedSnapshot = useCallback((snapshot: NativeCanvasSnapshot, document?: NativeCanvasDocument) => {
    snapshotRef.current = snapshot;
    snapshotVersionRef.current += 1;
    if (document) {
      const stored = canvasSnapshotForStorage(snapshot);
      lastSavedPersistenceRef.current = {
        content: storedCanvasContentSignature(stored),
        document: serializeCanvasDocument({ ...document, viewport: persistedViewportRef.current }, stored),
      };
    } else {
      lastSavedPersistenceRef.current = null;
    }
    autosaveSchedulerRef.current?.reset();
    setCanvasSaveStatus(activeCanvasIdRef.current, "saved");
  }, []);

  const refreshWorkspace = useCallback(async () => {
    if (!window.easyTool?.listCanvases) return;
    try {
      const result = await window.easyTool.listCanvases();
      const nextCanvases = result.canvases.map(normalizeCanvasRecord).filter((item): item is CanvasRecord => Boolean(item));
      const nextProjects = result.projects.map(normalizeCanvasProject).filter((item): item is CanvasProjectRecord => Boolean(item));
      setCanvases(nextCanvases);
      setProjects(nextProjects);
      setTabs((current) => current
        .filter((tab) => tab.readOnly || nextCanvases.some((canvas) => canvas.id === tab.id))
        .map((tab) => tab.readOnly ? tab : tabFromRecord(nextCanvases.find((canvas) => canvas.id === tab.id)!)));
      setActiveProjectId((current) => nextProjects.some((project) => project.id === current)
        ? current
        : nextProjects[0]?.id || "");
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const performCanvasSave = useCallback(async () => {
    const canvasId = activeCanvasIdRef.current;
    const document = activeDocumentRef.current;
    if (!canvasId || !document || activeReadOnlyRef.current || !window.easyTool?.saveCanvas) return true;
    const capturedVersion = snapshotVersionRef.current;
    const storedSnapshot = canvasSnapshotForStorage(snapshotRef.current);
    const jsonText = serializeCanvasDocument({ ...document, viewport: persistedViewportRef.current }, storedSnapshot);
    const persistenceState = {
      content: storedCanvasContentSignature(storedSnapshot),
      document: jsonText,
    };
    const savedPersistence = lastSavedPersistenceRef.current;
    if (savedPersistence?.document === persistenceState.document) {
      if (snapshotVersionRef.current === capturedVersion) setCanvasSaveStatus(canvasId, "saved");
      return true;
    }
    const allowEmpty = allowEmptySaveRef.current && storedSnapshot.nodes.length === 0;
    const saveSequence = ++saveSequenceRef.current;
    if (savedPersistence?.content !== persistenceState.content) setCanvasSaveStatus(canvasId, "saving");
    try {
      const result = await window.easyTool.saveCanvas(canvasId, {
        title: document.title,
        icon: document.icon,
        projectId: document.projectId,
        color: document.color,
        pinned: document.pinned,
        jsonText,
        nodeCount: storedSnapshot.nodes.length,
        allowEmpty,
        saveSequence,
        saveSessionId: saveSessionIdRef.current,
        saveSessionStartedAt: saveSessionStartedAtRef.current,
      });
      const record = normalizeCanvasRecord(objectValue(result).record);
      if (record) {
        upsertCanvas(record);
        if (activeDocumentRef.current?.id === record.id) {
          activeDocumentRef.current = { ...activeDocumentRef.current, ...record };
        }
      }
      lastSavedPersistenceRef.current = persistenceState;
      if (allowEmpty && snapshotRef.current.nodes.length === 0) allowEmptySaveRef.current = false;
      if (lastSaveErrorRef.current) {
        const resolvedError = lastSaveErrorRef.current;
        lastSaveErrorRef.current = "";
        setErrorMessage((current) => current === resolvedError ? "" : current);
      }
      setCanvasSaveStatus(canvasId, snapshotVersionRef.current === capturedVersion ? "saved" : "unsaved");
      return true;
    } catch (error) {
      setCanvasSaveStatus(canvasId, "unsaved");
      const message = error instanceof Error ? error.message : String(error);
      lastSaveErrorRef.current = message;
      setErrorMessage(message);
      return false;
    }
  }, [upsertCanvas]);

  const saveActiveCanvasNow = useCallback(async () => {
    const scheduler = autosaveSchedulerRef.current;
    return scheduler ? scheduler.flush() : performCanvasSave();
  }, [performCanvasSave]);

  const saveActiveCanvasManually = useCallback(async () => {
    if (await saveActiveCanvasNow()) {
      toast.success(t("infiniteCanvas:canvasSaved"));
    }
  }, [saveActiveCanvasNow, t]);

  const openCanvas = useCallback(async (canvasId: string, skipSave = false) => {
    if (!canvasId || !window.easyTool?.loadCanvas) return;
    if (canvasId === activeCanvasIdRef.current && !showHomeRef.current) return;
    if (!skipSave && !(await saveActiveCanvasNow())) return;
    setLoadingCanvas(true);
    try {
      const loaded = normalizeCanvasDocument(await window.easyTool.loadCanvas(canvasId));
      if (!loaded) throw new Error(t("infiniteCanvas:canvasNotFound"));
      persistedViewportRef.current = loaded.viewport;
      const document = { ...loaded, viewport: readCanvasViewport(loaded.id, loaded.viewport) };
      activeCanvasIdRef.current = document.id;
      activeReadOnlyRef.current = false;
      activeDocumentRef.current = document;
      adoptSavedSnapshot({ nodes: document.nodes, edges: document.edges, viewport: document.viewport }, document);
      allowEmptySaveRef.current = false;
      setActiveCanvasId(document.id);
      setActiveDocument(document);
      showHomeRef.current = false;
      setShowHome(false);
      setTabs((current) => current.some((tab) => tab.id === document.id)
        ? current.map((tab) => tab.id === document.id ? tabFromRecord(document) : tab)
        : [...current, tabFromRecord(document)]);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      showHomeRef.current = true;
      setShowHome(true);
    } finally {
      setLoadingCanvas(false);
    }
  }, [adoptSavedSnapshot, saveActiveCanvasNow, t]);

  const refreshSharedWorkspace = useCallback(async () => {
    const baseUrl = serverUrl.trim().replace(/\/+$/, "");
    if (!baseUrl) {
      setSharedCanvases([]);
      setSharedProjects([]);
      setActiveSharedProjectId("");
      return;
    }
    if (!serverAuthToken) {
      markSharedTabsUnavailable();
      toast.error(t("infiniteCanvas:sharedCanvasLoginRequired"));
      return;
    }
    setBusy(true);
    try {
      const [canvasResponse, projectResponse] = await Promise.all([
        remoteFetch(`${baseUrl}/api/canvas-exchange/canvases`),
        remoteFetch(`${baseUrl}/api/canvas-exchange/projects`),
      ]);
      const failedResponse = [canvasResponse, projectResponse].find((response) => !response.ok);
      if (failedResponse?.status === 401) throw new Error(t("infiniteCanvas:sharedCanvasLoginRequired"));
      if (failedResponse?.status === 403) throw new Error(t("infiniteCanvas:sharedCanvasAccessDenied"));
      if (failedResponse) throw new Error(t("infiniteCanvas:sharedCanvasConnectionFailed"));
      const canvasPayload = objectValue(await canvasResponse.json());
      const projectPayload = objectValue(await projectResponse.json());
      const nextCanvases = (Array.isArray(canvasPayload.canvases) ? canvasPayload.canvases : [])
        .map(normalizeCanvasRecord).filter((item): item is CanvasRecord => Boolean(item));
      const nextProjects = (Array.isArray(projectPayload.projects) ? projectPayload.projects : [])
        .map(normalizeCanvasProject).filter((item): item is CanvasProjectRecord => Boolean(item));
      setSharedCanvases(nextCanvases);
      setSharedProjects(nextProjects);
      setActiveSharedProjectId((current) => nextProjects.some((project) => project.id === current)
        ? current
        : nextProjects[0]?.id || "");
      markSharedTabsAvailable();
      setErrorMessage("");
    } catch (error) {
      markSharedTabsUnavailable();
      toast.error(error instanceof TypeError ? t("infiniteCanvas:sharedCanvasConnectionFailed") : error instanceof Error ? error.message : t("infiniteCanvas:sharedCanvasConnectionFailed"));
    } finally {
      setBusy(false);
    }
  }, [markSharedTabsAvailable, markSharedTabsUnavailable, serverAuthToken, serverUrl, t]);

  useEffect(() => {
    if (canViewSharedCanvases) void refreshSharedWorkspace();
  }, [refreshSharedWorkspace, canViewSharedCanvases]);

  const openSharedCanvas = useCallback(async (remoteCanvasId: string) => {
    const baseUrl = serverUrl.trim().replace(/\/+$/, "");
    const tabId = `shared:${remoteCanvasId}`;
    if (!remoteCanvasId) return;
    if (!baseUrl) {
      markSharedTabUnavailable(tabId);
      toast.error(t("infiniteCanvas:sharedCanvasConnectionFailed"));
      return;
    }
    if (!serverAuthToken) {
      markSharedTabUnavailable(tabId);
      toast.error(t("infiniteCanvas:sharedCanvasLoginRequired"));
      return;
    }
    if (!(await saveActiveCanvasNow())) return;
    setLoadingCanvas(true);
    try {
      const response = await remoteFetch(`${baseUrl}/api/canvas-exchange/canvases/${encodeURIComponent(remoteCanvasId)}`);
      if (response.status === 401) throw new Error(t("infiniteCanvas:sharedCanvasLoginRequired"));
      if (response.status === 403) throw new Error(t("infiniteCanvas:sharedCanvasAccessDenied"));
      if (!response.ok) throw new Error(t("infiniteCanvas:sharedCanvasConnectionFailed"));
      const remote = rewriteRemoteAssetUrls(await response.json(), baseUrl);
      const loaded = normalizeCanvasDocument(remote);
      if (!loaded) throw new Error(t("infiniteCanvas:canvasNotFound"));
      persistedViewportRef.current = loaded.viewport;
      const document = { ...loaded, id: tabId, viewport: readCanvasViewport(tabId, loaded.viewport) };
      activeCanvasIdRef.current = tabId;
      activeDocumentRef.current = document;
      activeReadOnlyRef.current = true;
      adoptSavedSnapshot({ nodes: document.nodes, edges: document.edges, viewport: document.viewport }, document);
      allowEmptySaveRef.current = false;
      setActiveCanvasId(tabId);
      setActiveDocument(document);
      showHomeRef.current = false;
      setShowHome(false);
      setTabs((current) => current.some((tab) => tab.id === tabId)
        ? current.map((tab) => tab.id === tabId ? {
            ...tab,
            title: document.title,
            updatedAt: document.updatedAt,
            projectId: document.projectId,
            readOnly: true,
            remoteCanvasId,
            remoteUnavailable: false,
          } : tab)
        : [...current, {
            id: tabId,
            title: document.title,
            updatedAt: document.updatedAt,
            projectId: document.projectId,
            readOnly: true,
            remoteCanvasId,
            remoteUnavailable: false,
          }]);
      setErrorMessage("");
      markSharedTabAvailable(tabId);
    } catch (error) {
      markSharedTabUnavailable(tabId);
      toast.error(error instanceof TypeError ? t("infiniteCanvas:sharedCanvasConnectionFailed") : error instanceof Error ? error.message : t("infiniteCanvas:sharedCanvasConnectionFailed"));
    } finally {
      setLoadingCanvas(false);
    }
  }, [adoptSavedSnapshot, markSharedTabAvailable, markSharedTabUnavailable, saveActiveCanvasNow, serverAuthToken, serverUrl, t]);

  useEffect(() => {
    void refreshWorkspace().then(() => {
      if (initialRestoreRef.current) return;
      initialRestoreRef.current = true;
      const lastCanvasId = window.localStorage.getItem(LAST_CANVAS_ID_KEY) || "";
      if (window.localStorage.getItem(SHOW_HOME_KEY) === "false" && lastCanvasId && !lastCanvasId.startsWith("shared:")) {
        void openCanvas(lastCanvasId, true);
      } else if (lastCanvasId.startsWith("shared:")) {
        showHomeRef.current = true;
        setShowHome(true);
      }
    });
  }, [openCanvas, refreshWorkspace]);

  useEffect(() => {
    const disconnect = connectGenerationTaskEvents();
    void hydrateRecentGenerationTasks(100).catch(() => undefined);
    return disconnect;
  }, []);

  useEffect(() => {
    if (!activeCanvasId || activeCanvasId.startsWith("shared:")) return;
    void hydrateGenerationTasks(activeCanvasId).catch(() => undefined);
  }, [activeCanvasId]);

  useEffect(() => {
    window.localStorage.setItem(OPEN_TABS_KEY, JSON.stringify(tabs));
  }, [tabs]);

  useEffect(() => {
    window.localStorage.setItem(SHOW_HOME_KEY, showHome ? "true" : "false");
    if (activeCanvasId) window.localStorage.setItem(LAST_CANVAS_ID_KEY, activeCanvasId);
  }, [activeCanvasId, showHome]);

  useEffect(() => {
    if (activeProjectId) window.localStorage.setItem(LAST_PROJECT_ID_KEY, activeProjectId);
  }, [activeProjectId]);

  useEffect(() => {
    const scheduler = createCanvasAutosaveScheduler({ save: performCanvasSave });
    autosaveSchedulerRef.current = scheduler;
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") void scheduler.flush();
    };
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      document.removeEventListener("visibilitychange", flushWhenHidden);
      if (autosaveSchedulerRef.current === scheduler) autosaveSchedulerRef.current = null;
      void scheduler.flush().finally(() => scheduler.dispose());
    };
  }, [performCanvasSave]);

  const handleSnapshotChange = useCallback((snapshot: NativeCanvasSnapshot) => {
    if (activeReadOnlyRef.current) return;
    const previousSnapshot = snapshotRef.current;
    const previousNodeCount = previousSnapshot.nodes.length;
    const unchanged = snapshot.nodes === previousSnapshot.nodes
      && snapshot.edges === previousSnapshot.edges;
    snapshotRef.current = snapshot;
    if (unchanged) return;
    snapshotVersionRef.current += 1;
    if (!activeCanvasIdRef.current) return;
    if (previousNodeCount > 0 && snapshot.nodes.length === 0) allowEmptySaveRef.current = true;
    else if (snapshot.nodes.length > 0) allowEmptySaveRef.current = false;
    setCanvasSaveStatus(activeCanvasIdRef.current, "unsaved");
    autosaveSchedulerRef.current?.markDirty();
  }, []);

  const handleViewportChange = useCallback((viewport: NativeCanvasSnapshot["viewport"]) => {
    const canvasId = activeCanvasIdRef.current;
    if (!canvasId) return;
    snapshotRef.current = { ...snapshotRef.current, viewport };
    writeCanvasViewport(canvasId, viewport);
  }, []);

  const handleCanvasInteractionChange = useCallback((active: boolean) => {
    autosaveSchedulerRef.current?.setInteracting(active);
  }, []);

  const openHome = useCallback(async () => {
    if (!(await saveActiveCanvasNow())) return;
    showHomeRef.current = true;
    setShowHome(true);
  }, [saveActiveCanvasNow]);

  const closeTab = useCallback(async (canvasId: string) => {
    const closingIndex = tabs.findIndex((tab) => tab.id === canvasId);
    const nextTabs = tabs.filter((tab) => tab.id !== canvasId);
    if (canvasId !== activeCanvasIdRef.current) {
      setTabs(nextTabs);
      return;
    }
    if (!(await saveActiveCanvasNow())) return;
    setTabs(nextTabs);
    const nextTab = nextTabs[Math.max(0, closingIndex - 1)] || nextTabs[0] || null;
    if (nextTab) {
      if (nextTab.readOnly && nextTab.remoteCanvasId) await openSharedCanvas(nextTab.remoteCanvasId);
      else await openCanvas(nextTab.id, true);
      return;
    }
    activeCanvasIdRef.current = "";
    activeDocumentRef.current = null;
    persistedViewportRef.current = { x: 0, y: 0, zoom: 1 };
    activeReadOnlyRef.current = false;
    adoptSavedSnapshot(emptyCanvasSnapshot());
    allowEmptySaveRef.current = false;
    setActiveCanvasId("");
    setActiveDocument(null);
    showHomeRef.current = true;
    setShowHome(true);
  }, [adoptSavedSnapshot, openCanvas, openSharedCanvas, saveActiveCanvasNow, tabs]);

  const runBusy = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const runCanvasTransfer = async <T,>(transferType: CanvasTransferType, work: (operationId: string) => Promise<T>) => {
    if (activeCanvasTransfer) return undefined;
    const operationId = crypto.randomUUID();
    setBusy(true);
    setActiveCanvasTransfer({
      operationId,
      transferType,
      phase: "queued",
      percent: 0,
      loadedBytes: 0,
      totalBytes: 0,
    });
    try {
      const result = await work(operationId);
      setErrorMessage("");
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/Canvas transfer canceled/i.test(message)) setErrorMessage(message);
      return undefined;
    } finally {
      setActiveCanvasTransfer((current) => current?.operationId === operationId ? null : current);
      setBusy(false);
    }
  };

  const cancelCanvasTransfer = () => {
    const operationId = activeCanvasTransfer?.operationId;
    if (!operationId || activeCanvasTransfer.canceling) return;
    setActiveCanvasTransfer((current) => current?.operationId === operationId ? { ...current, canceling: true } : current);
    void window.easyTool?.cancelCanvasTransfer?.(operationId);
  };

  const createCanvas = (projectId = activeProjectId) => void runBusy(async () => {
    if (!window.easyTool?.createCanvas || !projectId) return;
    const result = await window.easyTool.createCanvas({
      title: `${t("infiniteCanvas:canvasBaseName")} ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
      projectId,
      ...canvasSnapshotForStorage(emptyCanvasSnapshot()),
    });
    const document = normalizeCanvasDocument(objectValue(result).canvas);
    await refreshWorkspace();
    if (document) await openCanvas(document.id);
  });

  const createProject = () => void runBusy(async () => {
    if (!window.easyTool?.createCanvasProject) return;
    const result = await window.easyTool.createCanvasProject({ title: t("infiniteCanvas:projectBaseName") });
    const project = normalizeCanvasProject(objectValue(result).project);
    await refreshWorkspace();
    if (project) setActiveProjectId(project.id);
  });

  const createSharedProject = () => void runBusy(async () => {
    const baseUrl = serverUrl.trim().replace(/\/+$/, "");
    if (!baseUrl) return;
    const response = await remoteFetch(`${baseUrl}/api/canvas-exchange/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: t("infiniteCanvas:projectBaseName") }),
    });
    if (!response.ok) throw new Error(t("infiniteCanvas:sharedProjectCreateFailed"));
    const payload = objectValue(await response.json());
    const project = normalizeCanvasProject(payload.project);
    if (!project) throw new Error(t("infiniteCanvas:sharedProjectCreateFailed"));
    setSharedProjects((current) => [
      project,
      ...current.filter((item) => item.id !== project.id),
    ].sort((left, right) => left.sortOrder - right.sortOrder));
    setActiveSharedProjectId(project.id);
  });

  const renameCanvas = (canvasId: string, title: string) => void runBusy(async () => {
    if (!window.easyTool?.updateCanvasMeta) return;
    const result = await window.easyTool.updateCanvasMeta(canvasId, { title });
    const record = normalizeCanvasRecord(objectValue(result).record);
    if (record) upsertCanvas(record);
    if (activeDocumentRef.current?.id === canvasId && record) {
      activeDocumentRef.current = { ...activeDocumentRef.current, title: record.title };
      setActiveDocument(activeDocumentRef.current);
    }
  });

  const renameSharedCanvas = (canvasId: string, title: string) => void runBusy(async () => {
    const baseUrl = serverUrl.trim().replace(/\/+$/, "");
    if (!baseUrl) return;
    const response = await remoteFetch(`${baseUrl}/api/canvas-exchange/canvases/${encodeURIComponent(canvasId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!response.ok) throw new Error(t("infiniteCanvas:sharedCanvasUpdateFailed"));
    const payload = objectValue(await response.json());
    const record = normalizeCanvasRecord(payload.canvas);
    if (!record) return;
    setSharedCanvases((current) => current.map((canvas) => canvas.id === record.id ? record : canvas));
    const tabId = `shared:${canvasId}`;
    setTabs((current) => current.map((tab) => tab.id === tabId ? { ...tab, title: record.title, updatedAt: record.updatedAt } : tab));
    if (activeDocumentRef.current?.id === tabId) {
      activeDocumentRef.current = { ...activeDocumentRef.current, title: record.title, updatedAt: record.updatedAt };
      setActiveDocument(activeDocumentRef.current);
    }
  });

  const renameProject = (projectId: string, title: string) => void runBusy(async () => {
    if (!window.easyTool?.updateCanvasProject) return;
    const result = await window.easyTool.updateCanvasProject(projectId, { title });
    const project = normalizeCanvasProject(objectValue(result).project);
    if (project) setProjects((current) => current.map((item) => item.id === project.id ? project : item));
  });

  const renameSharedProject = (projectId: string, title: string) => void runBusy(async () => {
    const baseUrl = serverUrl.trim().replace(/\/+$/, "");
    if (!baseUrl) return;
    const response = await remoteFetch(`${baseUrl}/api/canvas-exchange/projects/${encodeURIComponent(projectId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!response.ok) throw new Error(t("infiniteCanvas:sharedProjectUpdateFailed"));
    const payload = objectValue(await response.json());
    const project = normalizeCanvasProject(payload.project);
    if (!project) throw new Error(t("infiniteCanvas:sharedProjectUpdateFailed"));
    setSharedProjects((current) => current.map((item) => item.id === project.id ? project : item));
  });

  const deleteCanvas = (canvasId: string) => void runBusy(async () => {
    if (tabs.some((tab) => tab.id === canvasId)) await closeTab(canvasId);
    await window.easyTool?.deleteCanvas?.(canvasId);
    await refreshWorkspace();
  });

  const deleteSharedCanvas = (canvasId: string) => void runBusy(async () => {
    const baseUrl = serverUrl.trim().replace(/\/+$/, "");
    if (!baseUrl) return;
    const tabId = `shared:${canvasId}`;
    if (tabs.some((tab) => tab.id === tabId)) await closeTab(tabId);
    const response = await remoteFetch(`${baseUrl}/api/canvas-exchange/canvases/${encodeURIComponent(canvasId)}`, { method: "DELETE" });
    if (!response.ok) throw new Error(t("infiniteCanvas:sharedCanvasDeleteFailed"));
    await refreshSharedWorkspace();
  });

  const copySharedCanvasToLocal = (canvasId: string, projectId: string) => void runCanvasTransfer("import", async (operationId) => {
    const baseUrl = serverUrl.trim().replace(/\/+$/, "");
    if (!baseUrl || !window.easyTool?.copyRemoteCanvasToLocal) return;
    await window.easyTool.copyRemoteCanvasToLocal({
      remoteCanvasId: canvasId,
      transferUrl: `${baseUrl}/api/canvas-exchange/canvases/${encodeURIComponent(canvasId)}/transfer`,
      projectId,
      operationId,
      authToken: getActiveForartConfig()?.serverAuthToken || "",
    });
    await refreshWorkspace();
    toast.success(t("infiniteCanvas:canvasImported"));
  });

  const uploadCanvasToShared = (canvasId: string, projectId: string) => void runCanvasTransfer("upload", async (operationId) => {
    const baseUrl = serverUrl.trim().replace(/\/+$/, "");
    if (!baseUrl || !window.easyTool?.uploadCanvasToRemote) return;
    const uploaded = objectValue(await window.easyTool.uploadCanvasToRemote({
      canvasId,
      projectId,
      uploadUrl: `${baseUrl}/api/canvas-exchange/canvases?project_id=${encodeURIComponent(projectId)}`,
      operationId,
      authToken: getActiveForartConfig()?.serverAuthToken || "",
    }));
    const warnings = Array.isArray(uploaded.warnings) ? uploaded.warnings : [];
    await refreshSharedWorkspace();
    if (warnings.length) toast.warning(t("infiniteCanvas:sharedCanvasUploadWarnings", { count: warnings.length }));
    else toast.success(t("infiniteCanvas:sharedCanvasUploaded"));
  });

  const deleteProject = (projectId: string) => void runBusy(async () => {
    const result = await window.easyTool?.deleteCanvasProject?.(projectId);
    const deletedIds = new Set(result?.deletedCanvasIds || []);
    setTabs((current) => current.filter((tab) => !deletedIds.has(tab.id)));
    if (deletedIds.has(activeCanvasIdRef.current)) {
      activeCanvasIdRef.current = "";
      activeDocumentRef.current = null;
      persistedViewportRef.current = { x: 0, y: 0, zoom: 1 };
      adoptSavedSnapshot(emptyCanvasSnapshot());
      allowEmptySaveRef.current = false;
      setActiveCanvasId("");
      setActiveDocument(null);
      showHomeRef.current = true;
      setShowHome(true);
    }
    await refreshWorkspace();
  });

  const deleteSharedProject = (projectId: string) => void runBusy(async () => {
    const baseUrl = serverUrl.trim().replace(/\/+$/, "");
    if (!baseUrl) return;
    const response = await remoteFetch(`${baseUrl}/api/canvas-exchange/projects/${encodeURIComponent(projectId)}`, {
      method: "DELETE",
    });
    if (!response.ok) throw new Error(t("infiniteCanvas:sharedProjectDeleteFailed"));
    const payload = objectValue(await response.json());
    const deletedTabIds = new Set(
      (Array.isArray(payload.deletedCanvasIds) ? payload.deletedCanvasIds : [])
        .map((canvasId) => `shared:${String(canvasId)}`),
    );
    setTabs((current) => current.filter((tab) => !deletedTabIds.has(tab.id)));
    if (deletedTabIds.has(activeCanvasIdRef.current)) {
      activeCanvasIdRef.current = "";
      activeDocumentRef.current = null;
      persistedViewportRef.current = { x: 0, y: 0, zoom: 1 };
      activeReadOnlyRef.current = false;
      adoptSavedSnapshot(emptyCanvasSnapshot());
      allowEmptySaveRef.current = false;
      setActiveCanvasId("");
      setActiveDocument(null);
      showHomeRef.current = true;
      setShowHome(true);
    }
    await refreshSharedWorkspace();
  });

  const duplicateCanvas = (canvasId: string) => void runBusy(async () => {
    if (!window.easyTool?.loadCanvas || !window.easyTool.createCanvas) return;
    const source = normalizeCanvasDocument(await window.easyTool.loadCanvas(canvasId));
    if (!source) return;
    const result = await window.easyTool.createCanvas({
      title: t("infiniteCanvas:canvasCopyName", { title: source.title }),
      projectId: source.projectId,
      ...canvasSnapshotForStorage(source),
    });
    const created = normalizeCanvasDocument(objectValue(result).canvas);
    await refreshWorkspace();
    if (created) await openCanvas(created.id);
  });

  const importCanvas = () => void runCanvasTransfer("import", async (operationId) => {
    const result = await window.easyTool?.importCanvas?.({ projectId: activeProjectId, operationId });
    if (result?.canceled) return;
    await refreshWorkspace();
    const imported = normalizeCanvasDocument(objectValue(result).canvas);
    if (imported) await openCanvas(imported.id);
  });

  const exportCanvas = (canvasId: string, withResources: boolean) => void runCanvasTransfer("export", async (operationId) => {
    if (withResources) await window.easyTool?.exportCanvasPackage?.(canvasId, operationId);
    else await window.easyTool?.exportCanvasJson?.(canvasId, operationId);
  });

  const moveCanvas = (canvasId: string, projectId: string) => void runBusy(async () => {
    const result = await window.easyTool?.moveCanvasToProject?.(canvasId, projectId);
    const record = normalizeCanvasRecord(objectValue(result).record);
    if (record) upsertCanvas(record);
  });

  const reorderProjects = (nextProjects: CanvasProjectRecord[]) => {
    setProjects(nextProjects);
    void runBusy(async () => {
      if (!window.easyTool?.updateCanvasProject) return;
      await Promise.all(nextProjects.map((project, index) => window.easyTool!.updateCanvasProject(project.id, { sortOrder: index + 1 })));
    });
  };

  const reorderSharedProjects = (nextProjects: CanvasProjectRecord[]) => {
    setSharedProjects(nextProjects);
    void runBusy(async () => {
      const baseUrl = serverUrl.trim().replace(/\/+$/, "");
      if (!baseUrl) return;
      await Promise.all(nextProjects.map(async (project, index) => {
        const response = await remoteFetch(`${baseUrl}/api/canvas-exchange/projects/${encodeURIComponent(project.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sortOrder: index + 1 }),
        });
        if (!response.ok) throw new Error(t("infiniteCanvas:sharedProjectReorderFailed"));
      }));
      await refreshSharedWorkspace();
    });
  };

  const activeValue = showHome ? "home" : activeCanvasId || "home";

  return (
    <Tabs
      className="infinite-canvas-page rf-workspace rf-workspace__tabs"
      value={activeValue}
      aria-label={t("infiniteCanvas:title")}
      onValueChange={(value) => {
        if (value === "home") void openHome();
        else {
          const tab = tabs.find((item) => item.id === value);
          if (tab?.readOnly && tab.remoteCanvasId) void openSharedCanvas(tab.remoteCanvasId);
          else void openCanvas(value);
        }
      }}
    >
      <CanvasDocumentTabs
        tabs={tabs}
        activeValue={activeValue}
        onClose={(id) => void closeTab(id)}
        onCreateCanvas={createCanvas}
        onRename={(id, title) => {
          const tab = tabs.find((item) => item.id === id);
          if (tab?.readOnly && tab.remoteCanvasId) renameSharedCanvas(tab.remoteCanvasId, title);
          else renameCanvas(id, title);
        }}
        onReorder={setTabs}
        menuActions={{
          localProjects: projects,
          projects,
          sharedCanvasesEnabled: canViewSharedCanvases,
          sharedProjects,
          canEditSharedCanvases,
          canDeleteSharedCanvases,
          canCopySharedCanvases,
          onCopyToLocal: (tab, projectId) => {
            if (tab.remoteCanvasId) copySharedCanvasToLocal(tab.remoteCanvasId, projectId);
          },
          onDelete: (tab) => {
            if (tab.readOnly && tab.remoteCanvasId) deleteSharedCanvas(tab.remoteCanvasId);
            else deleteCanvas(tab.id);
          },
          onDuplicate: (tab) => duplicateCanvas(tab.id),
          onExport: (tab, withResources) => exportCanvas(tab.id, withResources),
          onMove: (tab, projectId) => moveCanvas(tab.id, projectId),
          onUpload: (tab, projectId) => uploadCanvasToShared(tab.id, projectId),
        }}
      />
      {errorMessage ? (
        <Alert variant="destructive" className="rf-workspace__error">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}
      <TabsContent className="rf-workspace__content" value="home">
        <CanvasWorkspaceHome
          source={homeSource}
          sharedCanvasesEnabled={canViewSharedCanvases}
          canEditSharedProjects={canEditSharedProjects}
          canDeleteSharedProjects={canDeleteSharedProjects}
          canReorderSharedProjects={canReorderSharedProjects}
          canEditSharedCanvases={canEditSharedCanvases}
          canDeleteSharedCanvases={canDeleteSharedCanvases}
          canCopySharedCanvases={canCopySharedCanvases}
          canvases={homeSource === "shared" ? sharedCanvases : canvases}
          projects={homeSource === "shared" ? sharedProjects : projects}
          localProjects={projects}
          sharedProjects={sharedProjects}
          activeProjectId={homeSource === "shared" ? activeSharedProjectId : activeProjectId}
          busy={busy}
          onCreateCanvas={() => createCanvas()}
          onCreateProject={homeSource === "shared" ? createSharedProject : createProject}
          onDeleteCanvas={homeSource === "shared" ? deleteSharedCanvas : deleteCanvas}
          onDeleteProject={homeSource === "shared" ? deleteSharedProject : deleteProject}
          onDuplicateCanvas={duplicateCanvas}
          onCopyCanvasToLocal={copySharedCanvasToLocal}
          onExportCanvas={exportCanvas}
          onImportCanvas={importCanvas}
          onMoveCanvas={moveCanvas}
          onUploadCanvas={uploadCanvasToShared}
          onOpenCanvas={(id) => homeSource === "shared" ? void openSharedCanvas(id) : void openCanvas(id)}
          onRefresh={() => homeSource === "shared" ? void refreshSharedWorkspace() : void refreshWorkspace()}
          onRenameCanvas={homeSource === "shared" ? renameSharedCanvas : renameCanvas}
          onRenameProject={homeSource === "shared" ? renameSharedProject : renameProject}
          onReorderProjects={homeSource === "shared" ? reorderSharedProjects : reorderProjects}
          onSelectProject={homeSource === "shared" ? setActiveSharedProjectId : setActiveProjectId}
          onSourceChange={(source) => {
            setHomeSource(source);
            if (source === "shared" && !sharedProjects.length) void refreshSharedWorkspace();
          }}
        />
      </TabsContent>
      {tabs.map((tab) => (
        <TabsContent key={tab.id} className="rf-workspace__content" value={tab.id}>
          {loadingCanvas && activeCanvasId !== tab.id ? (
            <div className="rf-workspace__loading"><LoaderCircle aria-hidden="true" /><Skeleton className="h-4 w-40" /></div>
          ) : activeDocument?.id === tab.id ? (
            <ReactFlowCanvasPage
              key={tab.id}
              canvasId={tab.id}
              imageDownloadPath={imageDownloadPath}
              initialSnapshot={activeDocument}
              onInteractionChange={handleCanvasInteractionChange}
              onSnapshotChange={handleSnapshotChange}
              onViewportChange={handleViewportChange}
              onSave={tab.readOnly ? undefined : saveActiveCanvasManually}
              readOnly={Boolean(tab.readOnly)}
            />
          ) : null}
        </TabsContent>
      ))}
      <CanvasTransferProgressDialog transfer={activeCanvasTransfer} onCancel={cancelCanvasTransfer} />
      <CanvasFloatingPanel
        open={taskCenterOpen}
        title={t("infiniteCanvas:taskCenter")}
        className="rf-generation-task-center-panel"
      >
        <GenerationTaskCenter open={taskCenterOpen} onClose={() => setTaskCenterOpen(false)} />
      </CanvasFloatingPanel>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant={taskCenterOpen ? "default" : "outline"}
            size="icon"
            className="rf-generation-task-button"
            aria-label={t("infiniteCanvas:taskCenter")}
            aria-pressed={taskCenterOpen}
            onClick={() => setTaskCenterOpen((current) => !current)}
          >
            <ListTodo aria-hidden="true" />
            {activeTaskCount > 0 ? <Badge className="rf-generation-task-button__count">{Math.min(99, activeTaskCount)}</Badge> : null}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">{t("infiniteCanvas:taskCenter")}</TooltipContent>
      </Tooltip>
    </Tabs>
  );
}

export default CanvasWorkspacePage;
