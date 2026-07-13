import { ArrowDownAZ, Clock3, Copy, Download, FileJson, Layers3, MoreHorizontal, Pencil, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SearchInput } from "../../components/SearchInput";
import { NativeTabs } from "../../components/NativeTabs";
import { Button } from "../../components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import {
  ConfirmingDropdownMenuItem,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../../components/ui/empty";
import { Input } from "../../components/ui/input";
import { LibraryProjectSidebar } from "../library-layout/LibraryProjectSidebar";
import type { CanvasProjectRecord, CanvasRecord } from "./canvasWorkspaceTypes";

interface CanvasWorkspaceHomeProps {
  source: "local" | "shared";
  sharedCanvasesEnabled: boolean;
  canvases: CanvasRecord[];
  projects: CanvasProjectRecord[];
  localProjects: CanvasProjectRecord[];
  activeProjectId: string;
  busy: boolean;
  onCreateCanvas: () => void;
  onCreateProject: () => void;
  onDeleteCanvas: (canvasId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onDuplicateCanvas: (canvasId: string) => void;
  onCopyCanvasToLocal: (canvasId: string, projectId: string) => void;
  onExportCanvas: (canvasId: string, withResources: boolean) => void;
  onImportCanvas: () => void;
  onMoveCanvas: (canvasId: string, projectId: string) => void;
  onOpenCanvas: (canvasId: string) => void;
  onRefresh: () => void;
  onRenameCanvas: (canvasId: string, title: string) => void;
  onRenameProject: (projectId: string, title: string) => void;
  onReorderProjects: (projects: CanvasProjectRecord[]) => void;
  onSelectProject: (projectId: string) => void;
  onSourceChange: (source: "local" | "shared") => void;
}

function formatUpdatedAt(timestamp: number) {
  if (!timestamp) return "--";
  return new Intl.DateTimeFormat(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

export function CanvasWorkspaceHome({
  source,
  sharedCanvasesEnabled,
  canvases,
  projects,
  localProjects,
  activeProjectId,
  busy,
  onCreateCanvas,
  onCreateProject,
  onDeleteCanvas,
  onDeleteProject,
  onDuplicateCanvas,
  onCopyCanvasToLocal,
  onExportCanvas,
  onImportCanvas,
  onMoveCanvas,
  onOpenCanvas,
  onRefresh,
  onRenameCanvas,
  onRenameProject,
  onReorderProjects,
  onSelectProject,
  onSourceChange,
}: CanvasWorkspaceHomeProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<"recent" | "name">("recent");
  const [renamingCanvasId, setRenamingCanvasId] = useState("");
  const [renamingProjectId, setRenamingProjectId] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const readOnly = source === "shared";

  const activeProject = projects.find((project) => project.id === activeProjectId) || projects[0] || null;
  const visibleCanvases = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const filtered = canvases.filter((canvas) => (
      (!activeProjectId || canvas.projectId === activeProjectId)
      && (!query || canvas.title.toLocaleLowerCase().includes(query))
    ));
    return [...filtered].sort((left, right) => sortMode === "name"
      ? left.title.localeCompare(right.title, undefined, { numeric: true, sensitivity: "base" })
      : right.updatedAt - left.updatedAt);
  }, [activeProjectId, canvases, search, sortMode]);

  const commitCanvasRename = (canvas: CanvasRecord) => {
    const title = renameDraft.trim();
    if (title && title !== canvas.title) onRenameCanvas(canvas.id, title);
    setRenamingCanvasId("");
    setRenameDraft("");
  };

  return (
    <div className="rf-workspace-home">
      <LibraryProjectSidebar
        projects={projects.map((project) => ({ ...project, name: project.title, sort_order: project.sortOrder }))}
        activeProjectId={activeProject?.id || ""}
        renamingProjectId={renamingProjectId}
        ariaLabel={t("infiniteCanvas:projectSidebar")}
        projectActionsLabel={(name) => `${t("infiniteCanvas:projectActions")}: ${name}`}
        title={t("infiniteCanvas:projectsTitle")}
        creatingProject={busy}
        canManageProjects={!readOnly}
        canReorderProjects
        topContent={sharedCanvasesEnabled ? (
          <NativeTabs
            items={[
              { value: "local", label: t("infiniteCanvas:localCanvases") },
              { value: "shared", label: t("infiniteCanvas:serverCanvases") },
            ]}
            value={source}
            onChange={onSourceChange}
            ariaLabel={t("infiniteCanvas:canvasSource")}
            className="rf-workspace-home__source"
          />
        ) : null}
        onCreateProject={onCreateProject}
        onSelect={onSelectProject}
        onRenameStart={(projectId) => setRenamingProjectId(projectId)}
        onRenameCancel={() => setRenamingProjectId("")}
        onRenameSubmit={(projectId, title) => {
          onRenameProject(projectId, title);
          setRenamingProjectId("");
        }}
        onDeleteProject={onDeleteProject}
        onReorderProjects={(next) => onReorderProjects(next.map((project, index) => ({
          id: project.id,
          title: project.title,
          sortOrder: index + 1,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        })))}
      />

      <main className="rf-workspace-home__main">
        <header className="rf-workspace-home__header">
          <div className="rf-workspace-home__title">
            <strong>{activeProject?.title || t("infiniteCanvas:homeTitle")}</strong>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={t("infiniteCanvas:refreshCanvases")} onClick={onRefresh} disabled={busy}>
              <RefreshCw aria-hidden="true" />
            </Button>
          </div>
          <div className="rf-workspace-home__actions">
            <SearchInput
              className="rf-workspace-home__search"
              value={search}
              onChange={setSearch}
              placeholder={t("common:actions.search")}
              clearLabel={t("infiniteCanvas:clearSearch")}
            />
            <NativeTabs
              items={[
                { value: "recent", label: t("infiniteCanvas:sortRecent"), icon: Clock3 },
                { value: "name", label: t("infiniteCanvas:sortName"), icon: ArrowDownAZ },
              ]}
              value={sortMode}
              onChange={setSortMode}
              ariaLabel={t("infiniteCanvas:sortCanvases")}
              className="rf-workspace-home__sort"
            />
            {!readOnly ? <Button type="button" variant="outline" onClick={onImportCanvas} disabled={busy}>
              <Upload data-icon="inline-start" aria-hidden="true" />
              {t("infiniteCanvas:importCanvas")}
            </Button> : null}
            {!readOnly ? <Button type="button" variant="default" onClick={onCreateCanvas} disabled={busy || !activeProject}>
              <Plus data-icon="inline-start" aria-hidden="true" />
              {t("infiniteCanvas:newCanvas")}
            </Button> : null}
          </div>
        </header>

        <div className="rf-workspace-home__grid">
          {visibleCanvases.length ? visibleCanvases.map((canvas) => (
            <Card key={canvas.id} className="rf-canvas-card">
              <CardHeader>
                <div className="rf-canvas-card__icon"><Layers3 aria-hidden="true" /></div>
                <div className="min-w-0">
                  {renamingCanvasId === canvas.id ? (
                    <Input
                      value={renameDraft}
                      autoFocus
                      maxLength={80}
                      aria-label={t("infiniteCanvas:renameCanvas")}
                      onChange={(event) => setRenameDraft(event.currentTarget.value)}
                      onBlur={() => commitCanvasRename(canvas)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") commitCanvasRename(canvas);
                        if (event.key === "Escape") setRenamingCanvasId("");
                      }}
                    />
                  ) : (
                    <CardTitle title={canvas.title}>{canvas.title}</CardTitle>
                  )}
                  <CardDescription>{formatUpdatedAt(canvas.updatedAt)}</CardDescription>
                </div>
                <CardAction>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="outline" size="icon-sm" aria-label={`${t("infiniteCanvas:canvasActions")}: ${canvas.title}`}>
                        <MoreHorizontal aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuGroup>
                        <DropdownMenuItem onSelect={() => {
                          setRenameDraft(canvas.title);
                          setRenamingCanvasId(canvas.id);
                        }}>
                          <Pencil aria-hidden="true" />
                          {t("common:actions.rename")}
                        </DropdownMenuItem>
                        {readOnly ? <DropdownMenuSub>
                          <DropdownMenuSubTrigger>
                            <Copy aria-hidden="true" />
                            {t("infiniteCanvas:copyToLocal")}
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent>
                            {localProjects.length ? localProjects.map((project) => (
                              <DropdownMenuItem key={project.id} onSelect={() => onCopyCanvasToLocal(canvas.id, project.id)}>
                                {project.title}
                              </DropdownMenuItem>
                            )) : (
                              <DropdownMenuItem disabled>{t("common:empty.noProjects")}</DropdownMenuItem>
                            )}
                          </DropdownMenuSubContent>
                        </DropdownMenuSub> : <DropdownMenuItem onSelect={() => onDuplicateCanvas(canvas.id)}>
                          <Copy aria-hidden="true" />
                          {t("infiniteCanvas:duplicateCanvas")}
                        </DropdownMenuItem>}
                        {!readOnly ? <DropdownMenuSub>
                          <DropdownMenuSubTrigger>{t("infiniteCanvas:moveTo")}</DropdownMenuSubTrigger>
                          <DropdownMenuSubContent>
                            {projects.map((project) => (
                              <DropdownMenuItem key={project.id} disabled={project.id === canvas.projectId} onSelect={() => onMoveCanvas(canvas.id, project.id)}>
                                {project.title}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuSubContent>
                        </DropdownMenuSub> : null}
                        {!readOnly ? <DropdownMenuItem onSelect={() => onExportCanvas(canvas.id, false)}>
                          <FileJson aria-hidden="true" />
                          {t("infiniteCanvas:exportCanvasJson")}
                        </DropdownMenuItem> : null}
                        {!readOnly ? <DropdownMenuItem onSelect={() => onExportCanvas(canvas.id, true)}>
                          <Download aria-hidden="true" />
                          {t("infiniteCanvas:exportCanvasWithResources")}
                        </DropdownMenuItem> : null}
                        <ConfirmingDropdownMenuItem
                          confirmChildren={(
                            <>
                              <Trash2 aria-hidden="true" />
                              {t("common:confirm.delete")}
                            </>
                          )}
                          onConfirm={() => onDeleteCanvas(canvas.id)}
                        >
                          <Trash2 aria-hidden="true" />
                          {t("common:actions.delete")}
                        </ConfirmingDropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardAction>
              </CardHeader>
              <CardContent>
                <Button className="rf-canvas-card__open" type="button" variant="ghost" onClick={() => onOpenCanvas(canvas.id)}>
                  <Layers3 data-icon="inline-start" aria-hidden="true" />
                  <span>{canvas.nodeCount}</span>
                </Button>
              </CardContent>
            </Card>
          )) : (
            <Empty className="rf-workspace-home__empty">
              <EmptyHeader>
                <EmptyMedia variant="icon"><Layers3 aria-hidden="true" /></EmptyMedia>
                <EmptyTitle>{t("infiniteCanvas:noCanvases")}</EmptyTitle>
                <EmptyDescription>{activeProject?.title || t("infiniteCanvas:projectsTitle")}</EmptyDescription>
              </EmptyHeader>
              {!readOnly ? <Button type="button" variant="default" onClick={onCreateCanvas} disabled={busy || !activeProject}>
                <Plus data-icon="inline-start" aria-hidden="true" />
                {t("infiniteCanvas:newCanvas")}
              </Button> : null}
            </Empty>
          )}
        </div>
      </main>
    </div>
  );
}
