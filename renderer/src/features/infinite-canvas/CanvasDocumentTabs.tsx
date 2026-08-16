import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Cloud, CloudOff, Copy, Download, FileJson, FolderInput, Home, Layers3, Pencil, Plus, Trash2, UploadCloud, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import {
  ConfirmingContextMenuItem,
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "../../components/ui/context-menu";
import { Input } from "../../components/ui/input";
import { TabsList, TabsTrigger } from "../../components/ui/tabs";
import { restrictCanvasTabDragToHorizontalAxis } from "./canvasTabDrag";
import type { CanvasDocumentTab, CanvasProjectRecord } from "./canvasWorkspaceTypes";

interface CanvasDocumentTabMenuActions {
  localProjects: CanvasProjectRecord[];
  projects: CanvasProjectRecord[];
  sharedCanvasesEnabled: boolean;
  sharedProjects: CanvasProjectRecord[];
  canEditSharedCanvases: boolean;
  canDeleteSharedCanvases: boolean;
  canCopySharedCanvases: boolean;
  onCopyToLocal: (tab: CanvasDocumentTab, projectId: string) => void;
  onDelete: (tab: CanvasDocumentTab) => void;
  onDuplicate: (tab: CanvasDocumentTab) => void;
  onExport: (tab: CanvasDocumentTab, withResources: boolean) => void;
  onMove: (tab: CanvasDocumentTab, projectId: string) => void;
  onUpload: (tab: CanvasDocumentTab, projectId: string) => void;
}

interface CanvasDocumentTabsProps {
  tabs: CanvasDocumentTab[];
  activeValue: string;
  onClose: (canvasId: string) => void;
  onCreateCanvas: (projectId: string) => void;
  onRename: (canvasId: string, title: string) => void;
  onReorder: (tabs: CanvasDocumentTab[]) => void;
  menuActions: CanvasDocumentTabMenuActions;
}

function SortableCanvasTab({ tab, active, menuActions, onClose, onRename }: {
  tab: CanvasDocumentTab;
  active: boolean;
  menuActions: CanvasDocumentTabMenuActions;
  onClose: (canvasId: string) => void;
  onRename: (canvasId: string, title: string) => void;
}) {
  const { t } = useTranslation();
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(tab.title);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const cancelRenameRef = useRef(false);
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id,
    disabled: renaming,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform ? { ...transform, y: 0 } : null),
    transition,
  };
  const canRename = !tab.readOnly || menuActions.canEditSharedCanvases;
  const canDelete = !tab.readOnly || menuActions.canDeleteSharedCanvases;
  const CanvasIcon = tab.remoteUnavailable ? CloudOff : tab.readOnly ? Cloud : Layers3;

  const stopClosePointer = (event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };

  useEffect(() => {
    if (!renaming) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renaming]);

  useEffect(() => {
    if (!canRename) setRenaming(false);
  }, [canRename]);

  const commitRename = () => {
    if (cancelRenameRef.current) {
      cancelRenameRef.current = false;
      setRenameDraft(tab.title);
      setRenaming(false);
      return;
    }
    const title = renameDraft.trim();
    setRenaming(false);
    if (title && title !== tab.title) onRename(tab.id, title);
    else setRenameDraft(tab.title);
  };

  const startRename = () => {
    if (!canRename) return;
    cancelRenameRef.current = false;
    setRenameDraft(tab.title);
    setRenaming(true);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          className="rf-workspace-tab"
          data-active={active || undefined}
          data-dragging={isDragging || undefined}
          data-remote-unavailable={tab.remoteUnavailable || undefined}
          style={style}
          {...listeners}
        >
          {renaming ? (
            <div className="rf-workspace-tab__trigger rf-workspace-tab__editor">
              <CanvasIcon aria-hidden="true" />
              <Input
                ref={renameInputRef}
                className="rf-workspace-tab__rename-input"
                value={renameDraft}
                maxLength={80}
                aria-label={t("infiniteCanvas:renameCanvas")}
                onPointerDown={(event) => event.stopPropagation()}
                onChange={(event) => setRenameDraft(event.currentTarget.value)}
                onBlur={commitRename}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelRenameRef.current = true;
                    event.currentTarget.blur();
                  }
                }}
              />
            </div>
          ) : (
            <TabsTrigger className="rf-workspace-tab__trigger" value={tab.id} title={tab.title}>
              <CanvasIcon aria-hidden="true" />
              <span
                onDoubleClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (canRename) startRename();
                }}
              >
                {tab.title}
              </span>
            </TabsTrigger>
          )}
          <Button
            className="rf-workspace-tab__close"
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`${t("common:actions.close")}: ${tab.title}`}
            title={t("common:actions.close")}
            onPointerDown={stopClosePointer}
            onClick={(event) => {
              event.stopPropagation();
              onClose(tab.id);
            }}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuGroup>
          {canRename ? <ContextMenuItem onSelect={startRename}>
            <Pencil aria-hidden="true" />
            {t("common:actions.rename")}
          </ContextMenuItem> : null}
          {tab.readOnly && menuActions.canCopySharedCanvases ? (
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <Copy aria-hidden="true" />
                {t("infiniteCanvas:copyToLocal")}
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {menuActions.localProjects.length ? menuActions.localProjects.map((project) => (
                  <ContextMenuItem key={project.id} onSelect={() => menuActions.onCopyToLocal(tab, project.id)}>
                    {project.title}
                  </ContextMenuItem>
                )) : <ContextMenuItem disabled>{t("common:empty.noProjects")}</ContextMenuItem>}
              </ContextMenuSubContent>
            </ContextMenuSub>
          ) : !tab.readOnly ? (
            <ContextMenuItem onSelect={() => menuActions.onDuplicate(tab)}>
              <Copy aria-hidden="true" />
              {t("infiniteCanvas:duplicateCanvas")}
            </ContextMenuItem>
          ) : null}
          {!tab.readOnly ? (
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <FolderInput aria-hidden="true" />
                {t("infiniteCanvas:moveTo")}
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {menuActions.projects.map((project) => (
                  <ContextMenuItem
                    key={project.id}
                    disabled={project.id === tab.projectId}
                    onSelect={() => menuActions.onMove(tab, project.id)}
                  >
                    {project.title}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
          ) : null}
          {!tab.readOnly && menuActions.sharedCanvasesEnabled && menuActions.canEditSharedCanvases ? (
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <UploadCloud aria-hidden="true" />
                {t("infiniteCanvas:uploadToShared")}
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {menuActions.sharedProjects.length ? menuActions.sharedProjects.map((project) => (
                  <ContextMenuItem key={project.id} onSelect={() => menuActions.onUpload(tab, project.id)}>
                    {project.title}
                  </ContextMenuItem>
                )) : <ContextMenuItem disabled>{t("common:empty.noProjects")}</ContextMenuItem>}
              </ContextMenuSubContent>
            </ContextMenuSub>
          ) : null}
          {!tab.readOnly ? (
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <Download aria-hidden="true" />
                {t("infiniteCanvas:exportCanvas")}
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem onSelect={() => menuActions.onExport(tab, false)}>
                  <FileJson aria-hidden="true" />
                  {t("infiniteCanvas:exportCanvasOnly")}
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => menuActions.onExport(tab, true)}>
                  <Download aria-hidden="true" />
                  {t("infiniteCanvas:exportCanvasWithResources")}
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
          ) : null}
          {canDelete ? <ConfirmingContextMenuItem
            confirmChildren={(
              <>
                <Trash2 aria-hidden="true" />
                {t("common:confirm.delete")}
              </>
            )}
            onConfirm={() => menuActions.onDelete(tab)}
          >
            <Trash2 aria-hidden="true" />
            {t("common:actions.delete")}
          </ConfirmingContextMenuItem> : null}
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function CanvasTabOverlay({ tab }: { tab: CanvasDocumentTab }) {
  const CanvasIcon = tab.remoteUnavailable ? CloudOff : tab.readOnly ? Cloud : Layers3;
  return (
    <div className="rf-workspace-tab rf-workspace-tab--overlay" data-remote-unavailable={tab.remoteUnavailable || undefined} aria-hidden="true">
      <span className="rf-workspace-tab__trigger">
        <CanvasIcon aria-hidden="true" />
        <span>{tab.title}</span>
      </span>
      <span className="rf-workspace-tab__close"><X aria-hidden="true" /></span>
    </div>
  );
}

export function CanvasDocumentTabs({ tabs, activeValue, menuActions, onClose, onCreateCanvas, onRename, onReorder }: CanvasDocumentTabsProps) {
  const { t } = useTranslation();
  const [draggedId, setDraggedId] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const tabIds = useMemo(() => tabs.map((tab) => tab.id), [tabs]);
  const draggedTab = tabs.find((tab) => tab.id === draggedId) || null;

  const finishDrag = ({ active, over }: DragEndEvent) => {
    setDraggedId("");
    if (!over || active.id === over.id) return;
    const sourceIndex = tabs.findIndex((tab) => tab.id === active.id);
    const targetIndex = tabs.findIndex((tab) => tab.id === over.id);
    if (sourceIndex < 0 || targetIndex < 0) return;
    onReorder(arrayMove(tabs, sourceIndex, targetIndex));
  };

  return (
    <div className="rf-workspace-tabs-scroll">
      <TabsList className="rf-workspace-tabs" variant="line" aria-label={t("infiniteCanvas:title")}>
        <TabsTrigger className="rf-workspace-home-tab" value="home" title={t("infiniteCanvas:homeTitle")}>
          <Home aria-hidden="true" />
          <span>{t("infiniteCanvas:homeTitle")}</span>
        </TabsTrigger>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictCanvasTabDragToHorizontalAxis]}
          onDragStart={({ active }: DragStartEvent) => setDraggedId(String(active.id))}
          onDragCancel={() => setDraggedId("")}
          onDragEnd={finishDrag}
        >
          <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
            {tabs.map((tab) => (
              <SortableCanvasTab
                key={tab.id}
                tab={tab}
                active={activeValue === tab.id}
                menuActions={menuActions}
                onClose={onClose}
                onRename={onRename}
              />
            ))}
          </SortableContext>
          <DragOverlay dropAnimation={null}>{draggedTab ? <CanvasTabOverlay tab={draggedTab} /> : null}</DragOverlay>
        </DndContext>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              className="rf-workspace-tab-add"
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("infiniteCanvas:newCanvas")}
              title={t("infiniteCanvas:newCanvas")}
            >
              <Plus aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={4}>
            <DropdownMenuGroup>
              {menuActions.localProjects.length ? menuActions.localProjects.map((project) => (
                <DropdownMenuItem key={project.id} onSelect={() => onCreateCanvas(project.id)}>
                  {project.title}
                </DropdownMenuItem>
              )) : <DropdownMenuItem disabled>{t("common:empty.noProjects")}</DropdownMenuItem>}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </TabsList>
    </div>
  );
}
