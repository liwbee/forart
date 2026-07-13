import { LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Skeleton } from "../../components/ui/skeleton";
import { Tabs, TabsContent } from "../../components/ui/tabs";
import { CanvasDocumentTabs } from "./CanvasDocumentTabs";
import { ReactFlowCanvasPage } from "./ReactFlowCanvasPage";
import { CanvasWorkspaceHome } from "./CanvasWorkspaceHome";
import { loadApiSettings } from "../settings/apiProviders";
import {
  emptyCanvasSnapshot,
  normalizeCanvasDocument,
  normalizeCanvasProject,
  normalizeCanvasRecord,
  snapshotForStorage,
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
const AUTOSAVE_DELAY = 700;

function readStoredTabs(): CanvasDocumentTab[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(OPEN_TABS_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (item?.readOnly) return [];
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
    return typeof value === "string" && value.startsWith("/api/canvas-exchange/")
      ? `${serverUrl}${value}` as T
      : value;
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewriteRemoteAssetUrls(item, serverUrl)])) as T;
}

export function CanvasWorkspacePage({ imageDownloadPath, serverUrl = "", sharedCanvasesEnabled = false }: CanvasWorkspacePageProps) {
  const { t } = useTranslation();
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
  const activeCanvasIdRef = useRef("");
  const activeDocumentRef = useRef<NativeCanvasDocument | null>(null);
  const activeReadOnlyRef = useRef(false);
  const showHomeRef = useRef(showHome);
  const snapshotRef = useRef<NativeCanvasSnapshot>(emptyCanvasSnapshot());
  const saveTimerRef = useRef<number | null>(null);
  const initialRestoreRef = useRef(false);

  useEffect(() => {
    if (!sharedCanvasesEnabled) setHomeSource("local");
  }, [sharedCanvasesEnabled]);

  const upsertCanvas = useCallback((record: CanvasRecord) => {
    setCanvases((current) => current.some((item) => item.id === record.id)
      ? current.map((item) => item.id === record.id ? record : item)
      : [record, ...current]);
    setTabs((current) => current.map((tab) => tab.id === record.id ? tabFromRecord(record) : tab));
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

  const saveActiveCanvasNow = useCallback(async () => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const canvasId = activeCanvasIdRef.current;
    const document = activeDocumentRef.current;
    if (!canvasId || !document || activeReadOnlyRef.current || !window.easyTool?.saveCanvas) return;
    try {
      const result = await window.easyTool.saveCanvas(canvasId, {
        title: document.title,
        projectId: document.projectId,
        ...snapshotForStorage(snapshotRef.current),
      });
      const record = normalizeCanvasRecord(objectValue(result).record);
      if (record) upsertCanvas(record);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }, [upsertCanvas]);

  const openCanvas = useCallback(async (canvasId: string, skipSave = false) => {
    if (!canvasId || !window.easyTool?.loadCanvas) return;
    if (canvasId === activeCanvasIdRef.current && !showHomeRef.current) return;
    if (!skipSave) await saveActiveCanvasNow();
    setLoadingCanvas(true);
    try {
      const loaded = normalizeCanvasDocument(await window.easyTool.loadCanvas(canvasId));
      if (!loaded) throw new Error(t("infiniteCanvas:canvasNotFound"));
      activeCanvasIdRef.current = loaded.id;
      activeReadOnlyRef.current = false;
      activeDocumentRef.current = loaded;
      snapshotRef.current = { nodes: loaded.nodes, edges: loaded.edges, viewport: loaded.viewport };
      setActiveCanvasId(loaded.id);
      setActiveDocument(loaded);
      showHomeRef.current = false;
      setShowHome(false);
      setTabs((current) => current.some((tab) => tab.id === loaded.id)
        ? current.map((tab) => tab.id === loaded.id ? tabFromRecord(loaded) : tab)
        : [...current, tabFromRecord(loaded)]);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      showHomeRef.current = true;
      setShowHome(true);
    } finally {
      setLoadingCanvas(false);
    }
  }, [saveActiveCanvasNow, t]);

  const refreshSharedWorkspace = useCallback(async () => {
    const baseUrl = serverUrl.trim().replace(/\/+$/, "");
    if (!baseUrl) {
      setSharedCanvases([]);
      setSharedProjects([]);
      setActiveSharedProjectId("");
      return;
    }
    setBusy(true);
    try {
      const [canvasResponse, projectResponse] = await Promise.all([
        fetch(`${baseUrl}/api/canvas-exchange/canvases`),
        fetch(`${baseUrl}/api/canvas-exchange/projects`),
      ]);
      if (!canvasResponse.ok || !projectResponse.ok) throw new Error(t("infiniteCanvas:sharedCanvasLoadFailed"));
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
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [serverUrl, t]);

  const openSharedCanvas = useCallback(async (remoteCanvasId: string) => {
    const baseUrl = serverUrl.trim().replace(/\/+$/, "");
    if (!baseUrl || !remoteCanvasId) return;
    await saveActiveCanvasNow();
    setLoadingCanvas(true);
    try {
      const response = await fetch(`${baseUrl}/api/canvas-exchange/canvases/${encodeURIComponent(remoteCanvasId)}`);
      if (!response.ok) throw new Error(t("infiniteCanvas:canvasNotFound"));
      const remote = rewriteRemoteAssetUrls(await response.json(), baseUrl);
      const loaded = normalizeCanvasDocument(remote);
      if (!loaded) throw new Error(t("infiniteCanvas:canvasNotFound"));
      const tabId = `shared:${remoteCanvasId}`;
      const document = { ...loaded, id: tabId };
      activeCanvasIdRef.current = tabId;
      activeDocumentRef.current = document;
      activeReadOnlyRef.current = true;
      snapshotRef.current = { nodes: document.nodes, edges: document.edges, viewport: document.viewport };
      setActiveCanvasId(tabId);
      setActiveDocument(document);
      showHomeRef.current = false;
      setShowHome(false);
      setTabs((current) => current.some((tab) => tab.id === tabId)
        ? current
        : [...current, { id: tabId, title: document.title, updatedAt: document.updatedAt, readOnly: true, remoteCanvasId }]);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingCanvas(false);
    }
  }, [saveActiveCanvasNow, serverUrl, t]);

  useEffect(() => {
    void refreshWorkspace().then(() => {
      void loadApiSettings()
        .then((settings) => window.easyTool?.recoverCanvasGenerationTasks?.({ providers: settings.providers }))
        .catch(() => undefined);
      void window.libtv?.recoverCanvasImageTasks?.().catch(() => undefined);
      if (initialRestoreRef.current) return;
      initialRestoreRef.current = true;
      const lastCanvasId = window.localStorage.getItem(LAST_CANVAS_ID_KEY) || "";
      if (window.localStorage.getItem(SHOW_HOME_KEY) === "false" && lastCanvasId) {
        void openCanvas(lastCanvasId, true);
      }
    });
  }, [openCanvas, refreshWorkspace]);

  useEffect(() => {
    window.localStorage.setItem(OPEN_TABS_KEY, JSON.stringify(tabs.filter((tab) => !tab.readOnly)));
  }, [tabs]);

  useEffect(() => {
    window.localStorage.setItem(SHOW_HOME_KEY, showHome ? "true" : "false");
    if (activeCanvasId) window.localStorage.setItem(LAST_CANVAS_ID_KEY, activeCanvasId);
  }, [activeCanvasId, showHome]);

  useEffect(() => {
    if (activeProjectId) window.localStorage.setItem(LAST_PROJECT_ID_KEY, activeProjectId);
  }, [activeProjectId]);

  useEffect(() => () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    void saveActiveCanvasNow();
  }, [saveActiveCanvasNow]);

  const handleSnapshotChange = useCallback((snapshot: NativeCanvasSnapshot) => {
    if (activeReadOnlyRef.current) return;
    snapshotRef.current = snapshot;
    if (!activeCanvasIdRef.current) return;
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => void saveActiveCanvasNow(), AUTOSAVE_DELAY);
  }, [saveActiveCanvasNow]);

  const openHome = useCallback(async () => {
    await saveActiveCanvasNow();
    showHomeRef.current = true;
    setShowHome(true);
  }, [saveActiveCanvasNow]);

  const closeTab = useCallback(async (canvasId: string) => {
    const closingIndex = tabs.findIndex((tab) => tab.id === canvasId);
    const nextTabs = tabs.filter((tab) => tab.id !== canvasId);
    setTabs(nextTabs);
    if (canvasId !== activeCanvasIdRef.current) return;
    await saveActiveCanvasNow();
    const nextTab = nextTabs[Math.max(0, closingIndex - 1)] || nextTabs[0] || null;
    if (nextTab) {
      if (nextTab.readOnly && nextTab.remoteCanvasId) await openSharedCanvas(nextTab.remoteCanvasId);
      else await openCanvas(nextTab.id, true);
      return;
    }
    activeCanvasIdRef.current = "";
    activeDocumentRef.current = null;
    activeReadOnlyRef.current = false;
    setActiveCanvasId("");
    setActiveDocument(null);
    showHomeRef.current = true;
    setShowHome(true);
  }, [openCanvas, openSharedCanvas, saveActiveCanvasNow, tabs]);

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

  const createCanvas = () => void runBusy(async () => {
    if (!window.easyTool?.createCanvas || !activeProjectId) return;
    const result = await window.easyTool.createCanvas({
      title: `${t("infiniteCanvas:canvasBaseName")} ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
      projectId: activeProjectId,
      ...snapshotForStorage(emptyCanvasSnapshot()),
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
    const response = await fetch(`${baseUrl}/api/canvas-exchange/canvases/${encodeURIComponent(canvasId)}`, {
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
    const response = await fetch(`${baseUrl}/api/canvas-exchange/canvases/${encodeURIComponent(canvasId)}`, { method: "DELETE" });
    if (!response.ok) throw new Error(t("infiniteCanvas:sharedCanvasDeleteFailed"));
    await refreshSharedWorkspace();
  });

  const copySharedCanvasToLocal = (canvasId: string, projectId: string) => void runBusy(async () => {
    const baseUrl = serverUrl.trim().replace(/\/+$/, "");
    if (!baseUrl || !window.easyTool?.downloadCanvasPackageFromRemote || !window.easyTool.importCanvasPackageFromPath) return;
    const downloaded = await window.easyTool.downloadCanvasPackageFromRemote({
      downloadUrl: `${baseUrl}/api/canvas-exchange/canvases/${encodeURIComponent(canvasId)}/package`,
    });
    await window.easyTool.importCanvasPackageFromPath({ filePath: downloaded.filePath, projectId });
    await refreshWorkspace();
    toast.success(t("infiniteCanvas:canvasImported"));
  });

  const deleteProject = (projectId: string) => void runBusy(async () => {
    const result = await window.easyTool?.deleteCanvasProject?.(projectId);
    const deletedIds = new Set(result?.deletedCanvasIds || []);
    setTabs((current) => current.filter((tab) => !deletedIds.has(tab.id)));
    if (deletedIds.has(activeCanvasIdRef.current)) {
      activeCanvasIdRef.current = "";
      activeDocumentRef.current = null;
      setActiveCanvasId("");
      setActiveDocument(null);
      showHomeRef.current = true;
      setShowHome(true);
    }
    await refreshWorkspace();
  });

  const duplicateCanvas = (canvasId: string) => void runBusy(async () => {
    if (!window.easyTool?.loadCanvas || !window.easyTool.createCanvas) return;
    const source = normalizeCanvasDocument(await window.easyTool.loadCanvas(canvasId));
    if (!source) return;
    const result = await window.easyTool.createCanvas({
      title: t("infiniteCanvas:canvasCopyName", { title: source.title }),
      projectId: source.projectId,
      ...snapshotForStorage(source),
    });
    const created = normalizeCanvasDocument(objectValue(result).canvas);
    await refreshWorkspace();
    if (created) await openCanvas(created.id);
  });

  const importCanvas = () => void runBusy(async () => {
    const result = await window.easyTool?.importCanvas?.({ projectId: activeProjectId });
    await refreshWorkspace();
    const imported = normalizeCanvasDocument(objectValue(result).canvas);
    if (imported) await openCanvas(imported.id);
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
        const response = await fetch(`${baseUrl}/api/canvas-exchange/projects/${encodeURIComponent(project.id)}`, {
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
        onRename={renameCanvas}
        onReorder={setTabs}
      />
      {errorMessage ? (
        <Alert variant="destructive" className="rf-workspace__error">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}
      <TabsContent className="rf-workspace__content" value="home">
        <CanvasWorkspaceHome
          source={homeSource}
          sharedCanvasesEnabled={sharedCanvasesEnabled}
          canvases={homeSource === "shared" ? sharedCanvases : canvases}
          projects={homeSource === "shared" ? sharedProjects : projects}
          localProjects={projects}
          activeProjectId={homeSource === "shared" ? activeSharedProjectId : activeProjectId}
          busy={busy}
          onCreateCanvas={createCanvas}
          onCreateProject={createProject}
          onDeleteCanvas={homeSource === "shared" ? deleteSharedCanvas : deleteCanvas}
          onDeleteProject={deleteProject}
          onDuplicateCanvas={duplicateCanvas}
          onCopyCanvasToLocal={copySharedCanvasToLocal}
          onExportCanvas={(id, withResources) => void runBusy(async () => {
            if (withResources) await window.easyTool?.exportCanvasPackage?.(id);
            else await window.easyTool?.exportCanvasJson?.(id);
          })}
          onImportCanvas={importCanvas}
          onMoveCanvas={moveCanvas}
          onOpenCanvas={(id) => homeSource === "shared" ? void openSharedCanvas(id) : void openCanvas(id)}
          onRefresh={() => homeSource === "shared" ? void refreshSharedWorkspace() : void refreshWorkspace()}
          onRenameCanvas={homeSource === "shared" ? renameSharedCanvas : renameCanvas}
          onRenameProject={renameProject}
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
              onSnapshotChange={handleSnapshotChange}
              readOnly={Boolean(tab.readOnly)}
            />
          ) : null}
        </TabsContent>
      ))}
    </Tabs>
  );
}

export default CanvasWorkspacePage;
