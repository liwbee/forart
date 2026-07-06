import { Check, Cloud, Copy, Download, FileJson, FolderInput, GripVertical, HardDrive, Layers, MoreHorizontal, Pencil, Plus, RefreshCw, Server, Trash2, Upload, UploadCloud } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { CanvasDocumentRecord, CanvasProjectRecord } from "./types";

export type CanvasHomeMode = "local" | "server";
export type CanvasSortMode = "recent" | "name";

export type HomeCanvasRecord = CanvasDocumentRecord;

type CanvasCardMenuTarget = { kind: "canvas"; id: string };
type ProjectMenuTarget = { id: string };

interface CanvasCardMenuState {
  target: CanvasCardMenuTarget | null;
  x: number;
  y: number;
}

interface ProjectMenuState {
  target: ProjectMenuTarget | null;
  x: number;
  y: number;
}

interface CanvasMoveMenuState {
  canvasId: string;
  action: "move" | "upload" | "copy";
  x: number;
  y: number;
}

interface ProjectDragState {
  project: CanvasProjectRecord;
  pointerId: number;
  startY: number;
  insertIndex: number;
  indicatorStyle: CSSProperties;
  hasMoved: boolean;
}

interface ProjectRect {
  index: number;
  top: number;
  bottom: number;
}

interface CanvasHomePanelProps {
  mode: CanvasHomeMode;
  documents: HomeCanvasRecord[];
  projects: CanvasProjectRecord[];
  activeProjectId: string;
  selectedDocumentId: string;
  renamingDocumentId: string;
  renamingProjectId: string;
  renamingTitle: string;
  confirmingDeleteDocumentId: string;
  confirmingDeleteProjectId: string;
  sortMode: CanvasSortMode;
  isRemoteServerMode?: boolean;
  localProjectsForCopy?: CanvasProjectRecord[];
  remoteProjectsForUpload?: CanvasProjectRecord[];
  searchText?: string;
  onRefreshLocal: () => void;
  onRefreshServer?: () => void;
  onCreateCanvas: () => void;
  onCreateProject: () => void;
  onImportCanvas: () => void;
  onSelectDocument: (canvasId: string) => void;
  onOpenDocument: (canvasId: string) => void;
  onSelectProject: (projectId: string) => void;
  onStartRenameDocument: (canvasId: string, title: string) => void;
  onStartRenameProject: (projectId: string, title: string) => void;
  onCancelRename: () => void;
  onRenamingTitleChange: (title: string) => void;
  onSubmitRenameDocument: (canvasId: string) => void;
  onSubmitRenameProject: (projectId: string) => void;
  onDuplicateDocument: (canvasId: string) => void;
  onExportDocumentJson: (canvasId: string) => void;
  onExportDocumentPackage: (canvasId: string) => void;
  onMoveDocumentToProject: (canvasId: string, projectId: string) => void;
  onUploadDocumentToRemote?: (canvasId: string, projectId: string) => void;
  onCopyRemoteDocumentToLocal?: (canvasId: string, projectId: string) => void;
  onConfirmDeleteDocument: (canvasId: string) => void;
  onConfirmDeleteProject: (projectId: string) => void;
  onDeleteDocument: (canvasId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onReorderProjects?: (projects: CanvasProjectRecord[]) => void;
  onSortModeChange: (mode: CanvasSortMode) => void;
  onHomeModeChange?: (mode: CanvasHomeMode) => void;
  onSearchTextChange?: (value: string) => void;
}

function formatProjectDate(timestamp: number) {
  if (!timestamp) return "--";
  const date = new Date(timestamp);
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function reorderProjects(projects: CanvasProjectRecord[], draggedIndex: number, insertIndex: number) {
  if (draggedIndex < 0) return projects;
  const next = [...projects];
  const [dragged] = next.splice(draggedIndex, 1);
  const adjustedIndex = Math.max(0, Math.min(insertIndex > draggedIndex ? insertIndex - 1 : insertIndex, next.length));
  next.splice(adjustedIndex, 0, dragged);
  return next;
}

function collectProjectRects(listElement: HTMLDivElement, draggedId: string) {
  return Array.from(listElement.querySelectorAll<HTMLElement>("[data-project-id]"))
    .map((element) => {
      const id = element.dataset.projectId || "";
      if (!id || id === draggedId) return null;
      const rect = element.getBoundingClientRect();
      return {
        index: Number(element.dataset.projectIndex || 0),
        top: rect.top,
        bottom: rect.bottom,
      } satisfies ProjectRect;
    })
    .filter((rect): rect is ProjectRect => Boolean(rect));
}

function insertionIndexFromPointer(rects: ProjectRect[], pointerY: number) {
  if (!rects.length) return 0;
  const sortedRects = [...rects].sort((left, right) => left.index - right.index);
  for (const rect of sortedRects) {
    if (pointerY < rect.top + (rect.bottom - rect.top) / 2) return rect.index;
  }
  return sortedRects[sortedRects.length - 1].index + 1;
}

function createProjectInsertIndicatorStyle(listElement: HTMLDivElement, insertIndex: number): CSSProperties {
  const listRect = listElement.getBoundingClientRect();
  const elements = Array.from(listElement.querySelectorAll<HTMLElement>("[data-project-id]"));
  const sortedElements = elements.sort((left, right) => Number(left.dataset.projectIndex || 0) - Number(right.dataset.projectIndex || 0));
  const targetElement = sortedElements.find((element) => Number(element.dataset.projectIndex || 0) >= insertIndex);
  const previousElement = [...sortedElements].reverse().find((element) => Number(element.dataset.projectIndex || 0) < insertIndex);
  const anchorElement = targetElement || previousElement;
  if (!anchorElement) return { display: "none" };

  let indicatorTop = 0;
  if (previousElement && targetElement) {
    const previousRect = previousElement.getBoundingClientRect();
    const targetRect = targetElement.getBoundingClientRect();
    indicatorTop = previousRect.bottom + (targetRect.top - previousRect.bottom) / 2;
  } else {
    const anchorRect = anchorElement.getBoundingClientRect();
    indicatorTop = targetElement ? anchorRect.top : anchorRect.bottom;
  }

  return {
    top: indicatorTop - listRect.top + listElement.scrollTop,
    left: 6,
    right: 6,
  };
}

export function CanvasHomePanel({
  mode,
  documents,
  projects,
  activeProjectId,
  selectedDocumentId,
  renamingDocumentId,
  renamingProjectId,
  renamingTitle,
  confirmingDeleteDocumentId,
  confirmingDeleteProjectId,
  sortMode,
  isRemoteServerMode = false,
  localProjectsForCopy = [],
  remoteProjectsForUpload = [],
  searchText = "",
  onRefreshLocal,
  onRefreshServer,
  onCreateCanvas,
  onCreateProject,
  onImportCanvas,
  onSelectDocument,
  onOpenDocument,
  onSelectProject,
  onStartRenameDocument,
  onStartRenameProject,
  onCancelRename,
  onRenamingTitleChange,
  onSubmitRenameDocument,
  onSubmitRenameProject,
  onDuplicateDocument,
  onExportDocumentJson,
  onExportDocumentPackage,
  onMoveDocumentToProject,
  onUploadDocumentToRemote,
  onCopyRemoteDocumentToLocal,
  onConfirmDeleteDocument,
  onConfirmDeleteProject,
  onDeleteDocument,
  onDeleteProject,
  onReorderProjects,
  onSortModeChange,
  onHomeModeChange,
  onSearchTextChange,
}: CanvasHomePanelProps) {
  const { t } = useTranslation();
  const [cardMenu, setCardMenu] = useState<CanvasCardMenuState>({ target: null, x: 0, y: 0 });
  const [projectMenu, setProjectMenu] = useState<ProjectMenuState>({ target: null, x: 0, y: 0 });
  const [moveMenu, setMoveMenu] = useState<CanvasMoveMenuState>({ canvasId: "", action: "move", x: 0, y: 0 });
  const cardMenuRef = useRef<HTMLDivElement | null>(null);
  const projectMenuRef = useRef<HTMLDivElement | null>(null);
  const moveMenuRef = useRef<HTMLDivElement | null>(null);
  const projectListRef = useRef<HTMLDivElement | null>(null);
  const projectDragStateRef = useRef<ProjectDragState | null>(null);
  const [projectDragState, setProjectDragState] = useState<ProjectDragState | null>(null);
  const selectedDocument = documents.find((document) => document.id === selectedDocumentId) || documents[0] || null;

  useEffect(() => {
    projectDragStateRef.current = projectDragState;
  }, [projectDragState]);

  useEffect(() => {
    if (!cardMenu.target && !projectMenu.target && !moveMenu.canvasId) return undefined;
    const onPointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node;
      if (cardMenuRef.current?.contains(target) || projectMenuRef.current?.contains(target) || moveMenuRef.current?.contains(target)) return;
      closeMenus();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenus();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [cardMenu.target, projectMenu.target, moveMenu.canvasId]);

  useEffect(() => {
    if (!projectDragState) return undefined;
    const activeDrag = projectDragState;
    function handlePointerMove(event: globalThis.PointerEvent) {
      if (event.pointerId !== activeDrag.pointerId) return;
      event.preventDefault();
      const listElement = projectListRef.current;
      const rects = listElement ? collectProjectRects(listElement, activeDrag.project.id) : [];
      setProjectDragState((current) => {
        if (!current) return current;
        const insertIndex = insertionIndexFromPointer(rects, event.clientY);
        const next = {
          ...current,
          insertIndex,
          indicatorStyle: listElement ? createProjectInsertIndicatorStyle(listElement, insertIndex) : current.indicatorStyle,
          hasMoved: current.hasMoved || Math.abs(event.clientY - current.startY) > 3,
        };
        projectDragStateRef.current = next;
        return next;
      });
    }
    function finishDrag(event: globalThis.PointerEvent) {
      if (event.pointerId !== activeDrag.pointerId) return;
      event.preventDefault();
      const current = projectDragStateRef.current;
      setProjectDragState(null);
      projectDragStateRef.current = null;
      if (!current || !current.hasMoved || !onReorderProjects) return;
      const draggedIndex = projects.findIndex((project) => project.id === current.project.id);
      const nextProjects = reorderProjects(projects, draggedIndex, current.insertIndex);
      if (nextProjects.some((project, index) => project.id !== projects[index]?.id)) onReorderProjects(nextProjects);
    }
    function cancelDrag(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setProjectDragState(null);
        projectDragStateRef.current = null;
      }
    }
    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);
    window.addEventListener("keydown", cancelDrag);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
      window.removeEventListener("keydown", cancelDrag);
    };
  }, [onReorderProjects, projectDragState, projects]);

  const projectMoveTargets = projects.map((project) => ({ id: project.id, title: project.title || t("infiniteCanvas:untitledProject") }));
  const remoteUploadTargets = remoteProjectsForUpload.map((project) => ({ id: project.id, title: project.title || t("infiniteCanvas:untitledProject") }));
  const localCopyTargets = localProjectsForCopy.map((project) => ({ id: project.id, title: project.title || t("infiniteCanvas:untitledProject") }));

  const activeProjectTitle = activeProjectId
    ? projects.find((project) => project.id === activeProjectId)?.title || t("infiniteCanvas:untitledProject")
    : projects[0]?.title || t("infiniteCanvas:untitledProject");

  const openCardMenu = (event: MouseEvent<HTMLButtonElement>, target: CanvasCardMenuTarget) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 192;
    const menuHeight = 264;
    const pad = 8;
    setCardMenu({
      target,
      x: Math.max(pad, Math.min(rect.left, window.innerWidth - menuWidth - pad)),
      y: Math.max(pad, Math.min(rect.bottom + 8, window.innerHeight - menuHeight - pad)),
    });
    setProjectMenu({ target: null, x: 0, y: 0 });
    setMoveMenu({ canvasId: "", action: "move", x: 0, y: 0 });
  };

  const openProjectMenu = (event: MouseEvent<HTMLButtonElement>, id: string) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 184;
    const menuHeight = 96;
    const pad = 8;
    setProjectMenu({
      target: { id },
      x: Math.max(pad, Math.min(rect.left, window.innerWidth - menuWidth - pad)),
      y: Math.max(pad, Math.min(rect.bottom + 8, window.innerHeight - menuHeight - pad)),
    });
    setCardMenu({ target: null, x: 0, y: 0 });
    setMoveMenu({ canvasId: "", action: "move", x: 0, y: 0 });
  };

  const openMoveMenu = (element: HTMLElement, canvasId: string, action: CanvasMoveMenuState["action"] = "move") => {
    const rect = element.getBoundingClientRect();
    const menuWidth = 184;
    const menuMaxHeight = 280;
    const pad = 8;
    const preferredX = rect.right + 8;
    const x = preferredX + menuWidth <= window.innerWidth - pad ? preferredX : rect.left - menuWidth - 8;
    setMoveMenu({
      canvasId,
      action,
      x: Math.max(pad, Math.min(x, window.innerWidth - menuWidth - pad)),
      y: Math.max(pad, Math.min(rect.top, window.innerHeight - menuMaxHeight - pad)),
    });
  };

  const closeMenus = () => {
    setCardMenu({ target: null, x: 0, y: 0 });
    setProjectMenu({ target: null, x: 0, y: 0 });
    setMoveMenu({ canvasId: "", action: "move", x: 0, y: 0 });
  };

  const startProjectDrag = (event: PointerEvent<HTMLButtonElement>, project: CanvasProjectRecord, index: number) => {
    if (event.button !== 0 || renamingProjectId || !onReorderProjects) return;
    event.preventDefault();
    event.stopPropagation();
    const listElement = projectListRef.current;
    closeMenus();
    setProjectDragState({
      project,
      pointerId: event.pointerId,
      startY: event.clientY,
      insertIndex: index,
      indicatorStyle: listElement ? createProjectInsertIndicatorStyle(listElement, index) : { display: "none" },
      hasMoved: false,
    });
  };

  const renderCardMenu = () => {
    if (!cardMenu.target || typeof document === "undefined") return null;
    const target = cardMenu.target;
    const canvas = documents.find((item) => item.id === target.id);
    return createPortal(
      <div
        ref={cardMenuRef}
        className="ic-project-card-menu"
        role="menu"
        style={{ left: cardMenu.x, top: cardMenu.y }}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerLeave={(event) => {
          const nextTarget = event.relatedTarget as Node | null;
          if (nextTarget && moveMenuRef.current?.contains(nextTarget)) return;
          setMoveMenu({ canvasId: "", action: "move", x: 0, y: 0 });
        }}
      >
        <button
          type="button"
          role="menuitem"
          onPointerEnter={() => setMoveMenu({ canvasId: "", action: "move", x: 0, y: 0 })}
          onClick={() => {
            closeMenus();
            if (canvas) onStartRenameDocument(canvas.id, canvas.title || "");
          }}
        >
          <Pencil size={16} aria-hidden="true" />
          <span>{t("infiniteCanvas:renameCanvas")}</span>
        </button>
        <button
          type="button"
          role="menuitem"
          onPointerEnter={() => setMoveMenu({ canvasId: "", action: "move", x: 0, y: 0 })}
          onClick={() => {
            closeMenus();
            onDuplicateDocument(target.id);
          }}
        >
          <Copy size={16} aria-hidden="true" />
          <span>{t("infiniteCanvas:duplicateCanvas")}</span>
        </button>
        <button
          type="button"
          role="menuitem"
          onPointerEnter={() => setMoveMenu({ canvasId: "", action: "move", x: 0, y: 0 })}
          onClick={() => {
            closeMenus();
            onExportDocumentJson(target.id);
          }}
        >
          <FileJson size={16} aria-hidden="true" />
          <span>{t("infiniteCanvas:exportCanvasJson")}</span>
        </button>
        <button
          type="button"
          role="menuitem"
          onPointerEnter={() => setMoveMenu({ canvasId: "", action: "move", x: 0, y: 0 })}
          onClick={() => {
            closeMenus();
            onExportDocumentPackage(target.id);
          }}
        >
          <Download size={16} aria-hidden="true" />
          <span>{t("infiniteCanvas:exportCanvasWithResources")}</span>
        </button>
        <button
          type="button"
          role="menuitem"
          className={moveMenu.canvasId === target.id && moveMenu.action === "move" ? "active" : ""}
          aria-haspopup="menu"
          aria-expanded={moveMenu.canvasId === target.id && moveMenu.action === "move"}
          onPointerEnter={(event) => openMoveMenu(event.currentTarget, target.id, "move")}
          onFocus={(event) => openMoveMenu(event.currentTarget, target.id, "move")}
          onClick={(event) => openMoveMenu(event.currentTarget, target.id, "move")}
        >
          <FolderInput size={16} aria-hidden="true" />
          <span>{t("infiniteCanvas:moveToProject")}</span>
        </button>
        {isRemoteServerMode && onUploadDocumentToRemote ? (
          <button
            type="button"
            role="menuitem"
            className={moveMenu.canvasId === target.id && moveMenu.action === "upload" ? "active" : ""}
            aria-haspopup="menu"
            aria-expanded={moveMenu.canvasId === target.id && moveMenu.action === "upload"}
            onPointerEnter={(event) => openMoveMenu(event.currentTarget, target.id, "upload")}
            onFocus={(event) => openMoveMenu(event.currentTarget, target.id, "upload")}
            onClick={(event) => openMoveMenu(event.currentTarget, target.id, "upload")}
          >
            <UploadCloud size={16} aria-hidden="true" />
            <span>{t("infiniteCanvas:uploadToRemote", { defaultValue: "Upload to server" })}</span>
          </button>
        ) : null}
        <button
          type="button"
          role="menuitem"
          className={confirmingDeleteDocumentId === target.id ? "danger confirming" : "danger"}
          onPointerEnter={() => setMoveMenu({ canvasId: "", action: "move", x: 0, y: 0 })}
          onClick={() => {
            onSelectDocument(target.id);
            if (confirmingDeleteDocumentId === target.id) {
              closeMenus();
              onDeleteDocument(target.id);
              return;
            }
            onConfirmDeleteDocument(target.id);
          }}
        >
          <Trash2 size={16} aria-hidden="true" />
          <span>{confirmingDeleteDocumentId === target.id ? t("common:confirm.delete") : t("infiniteCanvas:deleteCanvas")}</span>
        </button>
      </div>,
      document.body,
    );
  };

  const renderServerCardMenu = () => {
    if (!cardMenu.target || typeof document === "undefined") return null;
    const target = cardMenu.target;
    return createPortal(
      <div
        ref={cardMenuRef}
        className="ic-project-card-menu"
        role="menu"
        style={{ left: cardMenu.x, top: cardMenu.y }}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerLeave={(event) => {
          const nextTarget = event.relatedTarget as Node | null;
          if (nextTarget && moveMenuRef.current?.contains(nextTarget)) return;
          setMoveMenu({ canvasId: "", action: "move", x: 0, y: 0 });
        }}
      >
        <button
          type="button"
          role="menuitem"
          className={moveMenu.canvasId === target.id && moveMenu.action === "copy" ? "active" : ""}
          aria-haspopup="menu"
          aria-expanded={moveMenu.canvasId === target.id && moveMenu.action === "copy"}
          onPointerEnter={(event) => openMoveMenu(event.currentTarget, target.id, "copy")}
          onFocus={(event) => openMoveMenu(event.currentTarget, target.id, "copy")}
          onClick={(event) => openMoveMenu(event.currentTarget, target.id, "copy")}
        >
          <Copy size={16} aria-hidden="true" />
          <span>{t("infiniteCanvas:copyToLocal", { defaultValue: "Copy to local" })}</span>
        </button>
        <button
          type="button"
          role="menuitem"
          className={confirmingDeleteDocumentId === target.id ? "danger confirming" : "danger"}
          onPointerEnter={() => setMoveMenu({ canvasId: "", action: "move", x: 0, y: 0 })}
          onClick={() => {
            onSelectDocument(target.id);
            if (confirmingDeleteDocumentId === target.id) {
              closeMenus();
              onDeleteDocument(target.id);
              return;
            }
            onConfirmDeleteDocument(target.id);
          }}
        >
          <Trash2 size={16} aria-hidden="true" />
          <span>{confirmingDeleteDocumentId === target.id ? t("common:confirm.delete") : t("infiniteCanvas:deleteCanvas")}</span>
        </button>
      </div>,
      document.body,
    );
  };

  const renderProjectMenu = () => {
    if (!projectMenu.target || typeof document === "undefined") return null;
    const project = projects.find((item) => item.id === projectMenu.target?.id);
    if (!project) return null;
    return createPortal(
      <div
        ref={projectMenuRef}
        className="ic-project-card-menu"
        role="menu"
        style={{ left: projectMenu.x, top: projectMenu.y }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            closeMenus();
            onStartRenameProject(project.id, project.title || "");
          }}
        >
          <Pencil size={16} aria-hidden="true" />
          <span>{t("common:actions.rename")}</span>
        </button>
        {projects.length > 1 ? (
          <button
            type="button"
            role="menuitem"
            className={confirmingDeleteProjectId === project.id ? "danger confirming" : "danger"}
            onClick={() => {
              if (confirmingDeleteProjectId === project.id) {
                closeMenus();
                onDeleteProject(project.id);
                return;
              }
              onConfirmDeleteProject(project.id);
            }}
          >
            <Trash2 size={16} aria-hidden="true" />
            <span>{confirmingDeleteProjectId === project.id ? t("common:confirm.delete") : t("common:actions.delete")}</span>
          </button>
        ) : null}
      </div>,
      document.body,
    );
  };

  const renderMoveMenu = () => {
    if (!moveMenu.canvasId || typeof document === "undefined") return null;
    const canvas = documents.find((item) => item.id === moveMenu.canvasId);
    const currentProjectId = canvas?.projectId || "";
    const projectItems = moveMenu.action === "upload"
      ? remoteUploadTargets
      : moveMenu.action === "copy"
        ? localCopyTargets
        : projectMoveTargets;
    const label = moveMenu.action === "upload"
      ? t("infiniteCanvas:uploadToRemote", { defaultValue: "Upload to server" })
      : moveMenu.action === "copy"
        ? t("infiniteCanvas:copyToLocal", { defaultValue: "Copy to local" })
        : t("infiniteCanvas:moveToProject");
    return createPortal(
      <div
        ref={moveMenuRef}
        className="ic-project-move-menu"
        role="menu"
        aria-label={label}
        style={{ left: moveMenu.x, top: moveMenu.y }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {projectItems.map((project) => {
          const selected = project.id === currentProjectId;
          return (
            <button
              key={project.id}
              type="button"
              role="menuitemradio"
              aria-checked={selected}
              className={selected ? "selected" : ""}
              disabled={moveMenu.action === "move" && selected}
              onClick={() => {
                closeMenus();
                if (moveMenu.action === "upload") onUploadDocumentToRemote?.(moveMenu.canvasId, project.id);
                else if (moveMenu.action === "copy") onCopyRemoteDocumentToLocal?.(moveMenu.canvasId, project.id);
                else onMoveDocumentToProject(moveMenu.canvasId, project.id);
              }}
            >
              {selected ? <Check size={14} aria-hidden="true" /> : <span className="ic-menu-check-spacer" />}
              <span>{project.title}</span>
            </button>
          );
        })}
      </div>,
      document.body,
    );
  };

  return (
    <div className="ic-project-home" aria-label={t("infiniteCanvas:homeAriaLabel")}>
      <aside className="ic-project-sidebar" aria-label={t("infiniteCanvas:projectSidebar")}>
        {isRemoteServerMode && onHomeModeChange ? (
          <div className="ic-project-source-switch" role="group" aria-label={t("infiniteCanvas:canvasSource", { defaultValue: "Canvas source" })}>
            <button
              type="button"
              className={mode === "local" ? "active" : ""}
              aria-pressed={mode === "local"}
              onClick={() => onHomeModeChange("local")}
            >
              <HardDrive size={17} aria-hidden="true" />
              <span>{t("infiniteCanvas:localCanvases", { defaultValue: "Local" })}</span>
            </button>
            <button
              type="button"
              className={mode === "server" ? "active" : ""}
              aria-pressed={mode === "server"}
              onClick={() => onHomeModeChange("server")}
            >
              <Server size={17} aria-hidden="true" />
              <span>{t("infiniteCanvas:serverCanvases", { defaultValue: "Server" })}</span>
            </button>
          </div>
        ) : null}
        <div className="ic-project-sidebar__header">
          <strong>{t("infiniteCanvas:projectsTitle")}</strong>
          <button type="button" title={t("infiniteCanvas:newProject")} aria-label={t("infiniteCanvas:newProject")} onClick={onCreateProject}>
            <Plus size={16} aria-hidden="true" />
          </button>
        </div>
        <div ref={projectListRef} className={`ic-project-sidebar__list${projectDragState ? " is-sorting" : ""}`}>
          {projects.map((project, index) => {
            const isRenaming = project.id === renamingProjectId;
            const isDragging = projectDragState?.project.id === project.id;
            return (
              <div
                key={project.id}
                data-project-id={project.id}
                data-project-index={index}
                className={`ic-project-sidebar__row${project.id === activeProjectId ? " active" : ""}${isRenaming ? " is-renaming" : ""}${isDragging ? " is-dragging" : ""}`}
              >
                {isRenaming ? (
                  <form
                    className="ic-project-sidebar__rename"
                    onSubmit={(event) => {
                      event.preventDefault();
                      onSubmitRenameProject(project.id);
                    }}
                  >
                    <input
                      value={renamingTitle}
                      autoFocus
                      maxLength={80}
                      onChange={(event) => onRenamingTitleChange(event.target.value)}
                      onBlur={() => onSubmitRenameProject(project.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          onCancelRename();
                        }
                      }}
                    />
                  </form>
                ) : (
                  <>
                    {onReorderProjects ? (
                      <button
                        type="button"
                        className="ic-project-sidebar__drag"
                        aria-label={t("common:labels.sort")}
                        onPointerDown={(event) => startProjectDrag(event, project, index)}
                      >
                        <GripVertical size={13} aria-hidden="true" />
                      </button>
                    ) : null}
                    <button type="button" className="ic-project-sidebar__item" onClick={() => onSelectProject(project.id)}>
                      <span>{project.title || t("infiniteCanvas:untitledProject")}</span>
                    </button>
                    <button
                      type="button"
                      className="ic-project-sidebar__menu"
                      title={t("infiniteCanvas:projectActions")}
                      aria-label={t("infiniteCanvas:projectActions")}
                      aria-haspopup="menu"
                      aria-expanded={projectMenu.target?.id === project.id}
                      onClick={(event) => openProjectMenu(event, project.id)}
                    >
                      <MoreHorizontal size={16} aria-hidden="true" />
                    </button>
                  </>
                )}
              </div>
            );
          })}
          {projectDragState ? <div className="ic-project-sidebar__insert-indicator" style={projectDragState.indicatorStyle} /> : null}
        </div>
      </aside>
      <div className="ic-project-home__panel">
        <div className="ic-project-home__head">
          <div className="ic-project-home__title">
            <div>
              <strong>{activeProjectTitle}</strong>
              <button
                className="ic-title-refresh-button"
                type="button"
                title={t("infiniteCanvas:refreshCanvases")}
                aria-label={t("infiniteCanvas:refreshCanvases")}
                onClick={mode === "server" && onRefreshServer ? onRefreshServer : onRefreshLocal}
              >
                <RefreshCw size={17} aria-hidden="true" />
              </button>
              <span>{documents.length}</span>
            </div>
          </div>
          <div className="ic-project-home__actions">
            <div className="ic-project-sort" role="group" aria-label={t("infiniteCanvas:sortCanvases")}>
              <button type="button" className={sortMode === "recent" ? "active" : ""} onClick={() => onSortModeChange("recent")}>{t("infiniteCanvas:sortRecent")}</button>
              <button type="button" className={sortMode === "name" ? "active" : ""} onClick={() => onSortModeChange("name")}>{t("infiniteCanvas:sortName")}</button>
            </div>
            {mode === "server" ? (
              <input
                className="ic-project-search"
                type="search"
                value={searchText}
                placeholder={t("common:actions.search", { defaultValue: "Search" })}
                onChange={(event) => onSearchTextChange?.(event.target.value)}
              />
            ) : (
              <>
                <button
                  className="ic-home-create-button ic-home-import-button"
                  type="button"
                  aria-label={t("infiniteCanvas:importCanvas")}
                  title={t("infiniteCanvas:importCanvas")}
                  onClick={onImportCanvas}
                >
                  <Upload size={17} aria-hidden="true" />
                </button>
                <button
                  className="ic-home-create-button"
                  type="button"
                  aria-label={t("infiniteCanvas:newCanvas")}
                  title={t("infiniteCanvas:newCanvas")}
                  onClick={onCreateCanvas}
                >
                  <Plus size={17} aria-hidden="true" />
                </button>
              </>
            )}
          </div>
        </div>
        <div className="ic-project-home__body">
          <div className="ic-project-card-grid scrollbar-thin-stable">
            {documents.length ? documents.map((document) => {
              const isActive = document.id === selectedDocumentId || (!selectedDocumentId && document.id === selectedDocument?.id);
              const isRenaming = document.id === renamingDocumentId;
              const CanvasIcon = mode === "server" ? Cloud : Layers;
              return (
                <article key={document.id} className={`ic-project-card${isActive ? " active" : ""}`} onClick={() => onSelectDocument(document.id)} onDoubleClick={() => {
                  onOpenDocument(document.id);
                }}>
                  {isRenaming ? (
                    <form
                      className="ic-project-rename"
                      onSubmit={(event) => {
                        event.preventDefault();
                        onSubmitRenameDocument(document.id);
                      }}
                    >
                      <input
                        value={renamingTitle}
                        autoFocus
                        maxLength={80}
                        onChange={(event) => onRenamingTitleChange(event.target.value)}
                        onBlur={() => onSubmitRenameDocument(document.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            onCancelRename();
                          }
                        }}
                      />
                    </form>
                  ) : (
                    <>
                      <div className="ic-project-card__actions" onDoubleClick={(event) => event.stopPropagation()}>
                        <button
                          className="ic-project-card__menu-button"
                          type="button"
                          title={t("infiniteCanvas:canvasActions")}
                          aria-label={t("infiniteCanvas:canvasActions")}
                          aria-haspopup="menu"
                          aria-expanded={cardMenu.target?.id === document.id}
                          onClick={(event) => openCardMenu(event, { kind: "canvas", id: document.id })}
                        >
                          <MoreHorizontal size={18} aria-hidden="true" />
                        </button>
                      </div>
                      <button className="ic-project-card__main" type="button" onClick={() => onSelectDocument(document.id)}>
                        <span className="ic-project-card__icon">
                          <CanvasIcon size={18} aria-hidden="true" />
                        </span>
                        <strong>{document.title || t("infiniteCanvas:untitledCanvas")}</strong>
                        <small>{formatProjectDate(document.updatedAt || document.createdAt)}</small>
                      </button>
                    </>
                  )}
                </article>
              );
            }) : <div className="ic-project-empty">{t("infiniteCanvas:noCanvases")}</div>}
          </div>
        </div>
      </div>
      {mode === "server" ? renderServerCardMenu() : renderCardMenu()}
      {renderProjectMenu()}
      {renderMoveMenu()}
    </div>
  );
}
