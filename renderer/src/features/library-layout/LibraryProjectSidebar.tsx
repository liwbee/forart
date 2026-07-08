import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
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
  canManageProjects?: boolean;
  renamingProjectId: string;
  deleteConfirmProjectId: string;
  ariaLabel: string;
  projectActionsLabel: (name: string) => string;
  onCreateProject: () => void;
  onSelect: (projectId: string) => void;
  onRenameStart: (projectId: string) => void;
  onRenameCancel: () => void;
  onRenameSubmit: (projectId: string, name: string) => Promise<void> | void;
  onDeleteProject: (projectId: string, isConfirming: boolean) => Promise<void> | void;
  onReorderProjects: (projects: TProject[]) => Promise<void> | void;
  closeMenuToken?: number;
}

function menuPositionFromButton(button: HTMLButtonElement) {
  const rect = button.getBoundingClientRect();
  const menuWidth = 160;
  const menuMaxHeight = 160;
  const pad = 8;
  return {
    x: Math.max(pad, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - pad)),
    y: Math.max(pad, Math.min(rect.bottom + 8, window.innerHeight - menuMaxHeight - pad)),
  };
}

function projectRectsFromList(list: HTMLDivElement) {
  const listRect = list.getBoundingClientRect();
  return Array.from(list.querySelectorAll<HTMLElement>("[data-project-row]")).map((element, index) => {
    const rect = element.getBoundingClientRect();
    return {
      index,
      top: rect.top - listRect.top + list.scrollTop,
      bottom: rect.bottom - listRect.top + list.scrollTop,
    };
  });
}

function insertIndexFromPointer(pointerY: number, list: HTMLDivElement, rects: ProjectRect[]) {
  if (!rects.length) return 0;
  const listRect = list.getBoundingClientRect();
  const y = pointerY - listRect.top + list.scrollTop;
  for (const rect of rects) {
    const mid = (rect.top + rect.bottom) / 2;
    if (y < mid) return rect.index;
  }
  return rects.length;
}

function indicatorStyleForIndex(index: number, list: HTMLDivElement, rects: ProjectRect[]) {
  if (!rects.length) return { top: 0 };
  const first = rects[0];
  const last = rects[rects.length - 1];
  if (index <= 0) return { top: first.top - 4 };
  if (index >= rects.length) return { top: last.bottom + 4 };
  const previous = rects[index - 1];
  const next = rects[index];
  return { top: (previous.bottom + next.top) / 2 };
}

function reorderProjects<TProject extends LibraryProjectSidebarProject>(projects: TProject[], draggedId: string, insertIndex: number) {
  const ordered = [...projects];
  const currentIndex = ordered.findIndex((project) => project.id === draggedId);
  if (currentIndex < 0) return ordered;
  const [dragged] = ordered.splice(currentIndex, 1);
  const normalizedInsertIndex = currentIndex < insertIndex ? insertIndex - 1 : insertIndex;
  ordered.splice(Math.max(0, Math.min(normalizedInsertIndex, ordered.length)), 0, dragged);
  return ordered;
}

export function LibraryProjectSidebar<TProject extends LibraryProjectSidebarProject>({
  projects,
  activeProjectId,
  canManageProjects = true,
  renamingProjectId,
  deleteConfirmProjectId,
  ariaLabel,
  projectActionsLabel,
  onCreateProject,
  onSelect,
  onRenameStart,
  onRenameCancel,
  onRenameSubmit,
  onDeleteProject,
  onReorderProjects,
  closeMenuToken = 0,
}: LibraryProjectSidebarProps<TProject>) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement | null>(null);
  const [menuState, setMenuState] = useState<{ projectId: string; x: number; y: number }>({ projectId: "", x: 0, y: 0 });
  const [renameDraft, setRenameDraft] = useState("");
  const [dragState, setDragState] = useState<DragState<TProject> | null>(null);

  useEffect(() => {
    setMenuState({ projectId: "", x: 0, y: 0 });
  }, [closeMenuToken]);

  useEffect(() => {
    if (!menuState.projectId) return undefined;
    function closeMenu() {
      setMenuState({ projectId: "", x: 0, y: 0 });
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenu();
    }
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", handleKeyDown as unknown as EventListener);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", handleKeyDown as unknown as EventListener);
    };
  }, [menuState.projectId]);

  useEffect(() => {
    if (!dragState) return undefined;
    function handlePointerMove(event: globalThis.PointerEvent) {
      const list = listRef.current;
      if (!list) return;
      const rects = projectRectsFromList(list);
      const insertIndex = insertIndexFromPointer(event.clientY, list, rects);
      const indicatorStyle = indicatorStyleForIndex(insertIndex, list, rects);
      setDragState((current) => current && current.pointerId === event.pointerId ? {
        ...current,
        insertIndex,
        indicatorStyle,
        hasMoved: current.hasMoved || Math.abs(event.clientY - current.startY) > 3,
      } : current);
    }
    function handlePointerUp(event: globalThis.PointerEvent) {
      setDragState((current) => {
        if (!current || current.pointerId !== event.pointerId) return current;
        if (current.hasMoved) {
          const nextProjects = reorderProjects(projects, current.project.id, current.insertIndex);
          if (nextProjects.some((project, index) => project.id !== projects[index]?.id)) void onReorderProjects(nextProjects);
        }
        return null;
      });
    }
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [dragState, onReorderProjects, projects]);

  function startRename(project: TProject) {
    setRenameDraft(project.name);
    setMenuState({ projectId: "", x: 0, y: 0 });
    onRenameStart(project.id);
  }

  async function commitRename(project: TProject) {
    const nextName = renameDraft.trim();
    if (!nextName || nextName === project.name) {
      cancelRename();
      return;
    }
    await onRenameSubmit(project.id, nextName);
  }

  function cancelRename() {
    onRenameCancel();
    setRenameDraft("");
  }

  function openProjectMenu(project: TProject, event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    const position = menuPositionFromButton(event.currentTarget);
    setMenuState((current) => current.projectId === project.id ? { projectId: "", x: 0, y: 0 } : { projectId: project.id, ...position });
  }

  function startProjectDrag(event: PointerEvent<HTMLElement>, project: TProject, index: number) {
    if (!canManageProjects || renamingProjectId || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const list = listRef.current;
    if (!list) return;
    const rects = projectRectsFromList(list);
    const indicatorStyle = indicatorStyleForIndex(index, list, rects);
    setDragState({
      project,
      pointerId: event.pointerId,
      startY: event.clientY,
      insertIndex: index,
      indicatorStyle,
      hasMoved: false,
    });
  }

  const activeMenuProject = projects.find((project) => project.id === menuState.projectId);

  function renderProjectRow(project: TProject, index: number, style?: CSSProperties) {
    const isActive = project.id === activeProjectId;
    const isRenaming = project.id === renamingProjectId;
    const isDragging = project.id === dragState?.project.id;
    return (
      <div
        key={project.id}
        data-project-row
        className={`library-project-row${isActive ? " active" : ""}${isRenaming ? " renaming" : ""}${isDragging ? " dragging" : ""}`}
        style={style}
      >
        {canManageProjects && !isRenaming ? (
          <span className="library-project-drag-handle" aria-hidden="true" onPointerDown={(event) => startProjectDrag(event, project, index)}>
            <GripVertical size={15} />
          </span>
        ) : null}
        {isRenaming ? (
          <input
            className="library-project-rename-input"
            value={renameDraft}
            autoFocus
            onChange={(event) => setRenameDraft(event.target.value)}
            onBlur={() => void commitRename(project)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void commitRename(project);
              if (event.key === "Escape") cancelRename();
            }}
          />
        ) : (
          <button
            className="library-project-list-item"
            type="button"
            onClick={() => {
              if (!dragState?.hasMoved) onSelect(project.id);
            }}
          >
            <span title={project.name}>{project.name}</span>
          </button>
        )}
        {canManageProjects && !isRenaming ? (
          <button
            className="library-project-menu-button"
            type="button"
            aria-label={projectActionsLabel(project.name)}
            aria-haspopup="menu"
            aria-expanded={menuState.projectId === project.id}
            onClick={(event) => openProjectMenu(project, event)}
          >
            <MoreHorizontal size={17} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <aside className="library-project-rail" aria-label={ariaLabel}>
      <div className="library-project-actions">
        <button className="library-project-add" type="button" onClick={onCreateProject}>
          <Plus size={16} aria-hidden="true" />
          <span>{t("common:labels.newProject")}</span>
        </button>
      </div>
      <div ref={listRef} className={`library-project-list scrollbar-thin-stable${dragState ? " sorting" : ""}`}>
        {projects.map((project, index) => renderProjectRow(project, index))}
        {!projects.length ? <div className="library-project-list-empty">{t("common:empty.noProjects")}</div> : null}
        {dragState ? <div className="library-project-insert-indicator" style={dragState.indicatorStyle} /> : null}
      </div>
      {menuState.projectId && activeMenuProject
        ? createPortal(
            <div
              className="project-row-menu"
              role="menu"
              style={{ left: menuState.x, top: menuState.y }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button type="button" role="menuitem" onClick={() => startRename(activeMenuProject)}>
                <Pencil size={14} aria-hidden="true" />
                <span>{t("common:actions.rename")}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className={`danger${deleteConfirmProjectId === activeMenuProject.id ? " confirming" : ""}`}
                onClick={async () => {
                  await onDeleteProject(activeMenuProject.id, deleteConfirmProjectId === activeMenuProject.id);
                  if (deleteConfirmProjectId === activeMenuProject.id) setMenuState({ projectId: "", x: 0, y: 0 });
                }}
              >
                <Trash2 size={14} aria-hidden="true" />
                <span>{deleteConfirmProjectId === activeMenuProject.id ? t("common:confirm.delete") : t("common:actions.delete")}</span>
              </button>
            </div>,
            document.body,
          )
        : null}
    </aside>
  );
}
