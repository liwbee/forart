import { useEffect, useState, type PointerEvent, type ReactNode } from "react";
import { GripVertical, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AppScrollArea } from "../../components/AppScrollArea";
import { DraggableList } from "../../components/DraggableList";
import { ConfirmingDropdownMenuItem, DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { Button } from "../../components/ui/button";
import { Empty, EmptyDescription } from "../../components/ui/empty";
import { Input } from "../../components/ui/input";

export interface LibraryProjectSidebarProject {
  id: string;
  name: string;
  sort_order: number;
}

interface LibraryProjectSidebarProps<TProject extends LibraryProjectSidebarProject> {
  projects: TProject[];
  activeProjectId: string;
  canManageProjects?: boolean;
  canReorderProjects?: boolean;
  renamingProjectId: string;
  ariaLabel: string;
  projectActionsLabel: (name: string) => string;
  onCreateProject: () => void;
  onSelect: (projectId: string) => void;
  onRenameStart: (projectId: string) => void;
  onRenameCancel: () => void;
  onRenameSubmit: (projectId: string, name: string) => Promise<void> | void;
  onDeleteProject: (projectId: string) => Promise<void> | void;
  onReorderProjects: (projects: TProject[]) => Promise<void> | void;
  closeMenuToken?: number;
  title?: string;
  creatingProject?: boolean;
  topContent?: ReactNode;
}

export function createUniqueLibraryProjectName(projects: Array<{ name: string }>, baseName: string) {
  const normalizedNames = new Set(projects.map((project) => project.name.trim().toLocaleLowerCase()));
  if (!normalizedNames.has(baseName.toLocaleLowerCase())) return baseName;
  let suffix = 2;
  while (normalizedNames.has(`${baseName} ${suffix}`.toLocaleLowerCase())) suffix += 1;
  return `${baseName} ${suffix}`;
}

export function LibraryProjectSidebar<TProject extends LibraryProjectSidebarProject>({
  projects,
  activeProjectId,
  canManageProjects = true,
  canReorderProjects = canManageProjects,
  renamingProjectId,
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
  title,
  creatingProject = false,
  topContent,
}: LibraryProjectSidebarProps<TProject>) {
  const { t } = useTranslation();
  const [openMenuProjectId, setOpenMenuProjectId] = useState("");
  const [renameDraft, setRenameDraft] = useState("");

  useEffect(() => {
    setOpenMenuProjectId("");
  }, [closeMenuToken]);

  const renamingProjectName = projects.find((project) => project.id === renamingProjectId)?.name || "";

  useEffect(() => {
    if (renamingProjectId) setRenameDraft(renamingProjectName);
  }, [renamingProjectId, renamingProjectName]);

  function startRename(project: TProject) {
    setRenameDraft(project.name);
    setOpenMenuProjectId("");
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

  function renderProjectRow(project: TProject, isDragging: boolean, dragHandleProps: { onPointerDown: (event: PointerEvent<HTMLElement>) => void }) {
    const isActive = project.id === activeProjectId;
    const isRenaming = project.id === renamingProjectId;
    const isMenuOpen = openMenuProjectId === project.id;
    return (
      <div
        data-project-row
        className={`library-project-row${isActive ? " active" : ""}${isRenaming ? " renaming" : ""}${isDragging ? " dragging" : ""}`}
      >
        {canReorderProjects && !isRenaming ? (
          <span className="library-project-drag-handle" aria-hidden="true" {...dragHandleProps}>
            <GripVertical size={15} />
          </span>
        ) : null}
        {isRenaming ? (
          <Input
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
          <Button
            className="library-project-list-item"
            type="button"
            variant={isActive ? "default" : "outline"}
            onClick={() => onSelect(project.id)}
          >
            <span title={project.name}>{project.name}</span>
          </Button>
        )}
        {canManageProjects && !isRenaming ? (
          <DropdownMenu
            open={isMenuOpen}
            onOpenChange={(open) => {
              setOpenMenuProjectId(open ? project.id : "");
            }}
          >
            <DropdownMenuTrigger asChild>
              <Button
                className="library-project-menu-button"
                type="button"
                variant="ghost"
                size="icon-lg"
                aria-label={projectActionsLabel(project.name)}
                onClick={(event) => event.stopPropagation()}
              >
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={4}>
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={() => startRename(project)}>
                  <Pencil size={14} aria-hidden="true" />
                  <span>{t("common:actions.rename")}</span>
                </DropdownMenuItem>
                <ConfirmingDropdownMenuItem
                  onConfirm={() => onDeleteProject(project.id)}
                  confirmChildren={(
                    <>
                      <Trash2 size={14} aria-hidden="true" />
                      <span>{t("common:confirm.delete")}</span>
                    </>
                  )}
                >
                  <Trash2 size={14} aria-hidden="true" />
                  <span>{t("common:actions.delete")}</span>
                </ConfirmingDropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    );
  }

  return (
    <aside className="library-project-rail" aria-label={ariaLabel}>
      {topContent ? <div className="library-project-top-content">{topContent}</div> : null}
      <div className="library-project-header">
        <strong>{title || t("infiniteCanvas:projectsTitle")}</strong>
        {canManageProjects ? <Button className="library-project-add" type="button" variant="default" size="icon" title={t("common:labels.newProject")} aria-label={t("common:labels.newProject")} disabled={creatingProject} onClick={onCreateProject}>
          <Plus aria-hidden="true" />
        </Button> : null}
      </div>
      <AppScrollArea className="library-project-list-scroll" viewportClassName="library-project-list-scroll__viewport">
        <DraggableList
          items={projects}
          getId={(project) => project.id}
          disabled={!canReorderProjects || Boolean(renamingProjectId)}
          onReorder={(nextProjects) => {
            if (nextProjects.some((project, index) => project.id !== projects[index]?.id)) void onReorderProjects(nextProjects);
          }}
          className="library-project-list"
          renderItem={(project, { isDragging, dragHandleProps }) => renderProjectRow(project, isDragging, dragHandleProps)}
          empty={(
            <Empty className="library-project-list-empty">
              <EmptyDescription>{t("common:empty.noProjects")}</EmptyDescription>
            </Empty>
          )}
        />
      </AppScrollArea>
    </aside>
  );
}
