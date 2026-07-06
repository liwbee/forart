import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GripVertical, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface LibraryProjectSidebarProject {
  id: string;
  name: string;
  sort_order: number;
}

interface DragState<TProject extends LibraryProjectSidebarProject> {
  project: TProject;
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

interface LibraryProjectSidebarProps<TProject extends LibraryProjectSidebarProject> {
  projects: TProject[];
  activeProjectId: string;
  renamingProjectId: string;
  deleteConfirmProjectId: string;
  ariaLabel: string;
  projectActionsLabel: (projectName: string) => string;
  canManageProjects?: boolean;
  addButton?: ReactNode;
  header?: ReactNode;
  closeMenuToken: number;
  onSelect: (projectId: string) => void;
  onCreateProject?: () => void;
  onRenameStart: (projectId: string) => void;
  onRenameCancel: () => void;
  onRenameSubmit: (projectId: string, name: string) => void;
  onDeleteProject: (projectId: string, isConfirming: boolean) => void;
  onReorderProjects: (projects: TProject[]) => void;
}

function reorderProjects<TProject>(projects: TProject[], draggedIndex: number, insertIndex: number) {
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

function createInsertionIndicatorStyle(listElement: HTMLDivElement, insertIndex: number): CSSProperties {
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
    left: 0,
    right: 0,
  };
}

export function LibraryProjectSidebar<TProject extends LibraryProjectSidebarProject>({
  projects,
  activeProjectId,
  renamingProjectId,
  deleteConfirmProjectId,
  ariaLabel,
  projectActionsLabel,
  canManageProjects = true,
  addButton,
  header,
  closeMenuToken,
  onSelect,
  onCreateProject,
  onRenameStart,
  onRenameCancel,
  onRenameSubmit,
  onDeleteProject,
  onReorderProjects,
}: LibraryProjectSidebarProps<TProject>) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<DragState<TProject> | null>(null);
  const [menuState, setMenuState] = useState<{ projectId: string; x: number; y: number }>({ projectId: "", x: 0, y: 0 });
  const [draftName, setDraftName] = useState("");
  const [dragState, setDragState] = useState<DragState<TProject> | null>(null);
  const menuProjectId = menuState.projectId;

  useEffect(() => {
    const project = projects.find((item) => item.id === renamingProjectId);
    setDraftName(project?.name || "");
  }, [projects, renamingProjectId]);

  useEffect(() => {
    setMenuState({ projectId: "", x: 0, y: 0 });
  }, [closeMenuToken]);

  useEffect(() => {
    dragStateRef.current = dragState;
  }, [dragState]);

  useEffect(() => {
    if (!menuProjectId) return undefined;
    function closeMenu() {
      setMenuState({ projectId: "", x: 0, y: 0 });
    }
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") closeMenu();
    }
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuProjectId]);

  useEffect(() => {
    if (!dragState) return undefined;
    const activeDrag = dragState;
    function handlePointerMove(event: globalThis.PointerEvent) {
      if (event.pointerId !== activeDrag.pointerId) return;
      event.preventDefault();
      const listElement = listRef.current;
      const rects = listElement ? collectProjectRects(listElement, activeDrag.project.id) : [];
      setDragState((current) => {
        if (!current) return current;
        const insertIndex = insertionIndexFromPointer(rects, event.clientY);
        const next = {
          ...current,
          insertIndex,
          indicatorStyle: listElement ? createInsertionIndicatorStyle(listElement, insertIndex) : current.indicatorStyle,
          hasMoved: current.hasMoved || Math.abs(event.clientY - current.startY) > 3,
        };
        dragStateRef.current = next;
        return next;
      });
    }
    function finishDrag(event: globalThis.PointerEvent) {
      if (event.pointerId !== activeDrag.pointerId) return;
      event.preventDefault();
      const current = dragStateRef.current;
      setDragState(null);
      dragStateRef.current = null;
      if (!current || !current.hasMoved) return;
      const draggedIndex = projects.findIndex((project) => project.id === current.project.id);
      const nextProjects = reorderProjects(projects, draggedIndex, current.insertIndex);
      if (nextProjects.some((project, index) => project.id !== projects[index]?.id)) onReorderProjects(nextProjects);
    }
    function cancelDrag(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setDragState(null);
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
  }, [dragState, onReorderProjects, projects]);

  function submitRename(projectId: string) {
    onRenameSubmit(projectId, draftName);
  }

  function handleRenameKeyDown(event: KeyboardEvent<HTMLInputElement>, projectId: string) {
    if (event.key === "Enter") {
      event.preventDefault();
      submitRename(projectId);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onRenameCancel();
    }
  }

  function openMenuAt(projectId: string, x: number, y: number) {
    const menuWidth = 168;
    const menuHeight = 92;
    const pad = 8;
    setMenuState({
      projectId,
      x: Math.max(pad, Math.min(x, window.innerWidth - menuWidth - pad)),
      y: Math.max(pad, Math.min(y, window.innerHeight - menuHeight - pad)),
    });
  }

  function toggleMenu(event: MouseEvent<HTMLButtonElement>, projectId: string) {
    event.stopPropagation();
    if (menuProjectId === projectId) {
      setMenuState({ projectId: "", x: 0, y: 0 });
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    openMenuAt(projectId, rect.right + 6, rect.top);
  }

  function startProjectDrag(event: PointerEvent<HTMLSpanElement>, project: TProject, index: number) {
    if (event.button !== 0 || !canManageProjects || renamingProjectId) return;
    event.preventDefault();
    event.stopPropagation();
    const listElement = listRef.current;
    setMenuState({ projectId: "", x: 0, y: 0 });
    setDragState({
      project,
      pointerId: event.pointerId,
      startY: event.clientY,
      insertIndex: index,
      indicatorStyle: listElement ? createInsertionIndicatorStyle(listElement, index) : { display: "none" },
      hasMoved: false,
    });
  }

  return (
    <aside className="model-project-rail" aria-label={ariaLabel}>
      {header || addButton || (
        <button className="model-project-add" type="button" onClick={onCreateProject}>
          <Plus size={18} aria-hidden="true" />
          <span>{t("common:labels.newProject")}</span>
        </button>
      )}

      <div ref={listRef} className={`model-project-list scrollbar-thin-stable${dragState ? " sorting" : ""}`}>
        {projects.length ? (
          projects.map((project, index) => {
            const isActive = project.id === activeProjectId;
            const isRenaming = project.id === renamingProjectId;
            const isDragging = dragState?.project.id === project.id;

            return (
              <div
                key={project.id}
                data-project-id={project.id}
                data-project-index={index}
                className={`model-project-row${isActive ? " active" : ""}${isRenaming ? " renaming" : ""}${isDragging ? " dragging" : ""}`}
              >
                {canManageProjects && !isRenaming ? (
                  <span className="model-project-drag-handle" aria-hidden="true" onPointerDown={(event) => startProjectDrag(event, project, index)}>
                    <GripVertical size={13} />
                  </span>
                ) : null}
                {isRenaming ? (
                  <input
                    className="model-project-rename-input"
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                    onBlur={() => submitRename(project.id)}
                    onKeyDown={(event) => handleRenameKeyDown(event, project.id)}
                    autoFocus
                    maxLength={120}
                    aria-label={t("common:labels.projectName")}
                  />
                ) : (
                  <button
                    className="model-project-list-item"
                    type="button"
                    aria-current={isActive ? "true" : undefined}
                    onClick={() => onSelect(project.id)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      if (canManageProjects) openMenuAt(project.id, event.clientX, event.clientY);
                    }}
                  >
                    <span>{project.name || "Untitled Project"}</span>
                  </button>
                )}

                {canManageProjects ? (
                  <button
                    className="model-project-menu-button"
                    type="button"
                    aria-label={projectActionsLabel(project.name || "Untitled Project")}
                    aria-expanded={menuProjectId === project.id}
                    onClick={(event) => toggleMenu(event, project.id)}
                  >
                    <MoreHorizontal size={18} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            );
          })
        ) : (
          <div className="model-project-list-empty">{t("common:empty.noProjects")}</div>
        )}
        {dragState ? <div className="model-project-insert-indicator" style={dragState.indicatorStyle} /> : null}
      </div>

      {menuProjectId ? createPortal(
        <div
          className="project-row-menu"
          role="menu"
          style={{ left: menuState.x, top: menuState.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const projectId = menuProjectId;
              setMenuState({ projectId: "", x: 0, y: 0 });
              onRenameStart(projectId);
            }}
          >
            <Pencil size={16} aria-hidden="true" />
            <span>{t("common:actions.rename")}</span>
          </button>
          <button
            className={deleteConfirmProjectId === menuProjectId ? "danger confirming" : "danger"}
            type="button"
            role="menuitem"
            onClick={() => {
              const projectId = menuProjectId;
              const isConfirming = deleteConfirmProjectId === projectId;
              onDeleteProject(projectId, isConfirming);
            }}
          >
            <Trash2 size={16} aria-hidden="true" />
            <span>{deleteConfirmProjectId === menuProjectId ? t("common:confirm.delete") : t("common:actions.delete")}</span>
          </button>
        </div>,
        document.body,
      ) : null}
    </aside>
  );
}
