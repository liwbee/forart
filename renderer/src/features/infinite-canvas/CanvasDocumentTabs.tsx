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
import { Home, Layers3, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { TabsList, TabsTrigger } from "../../components/ui/tabs";
import type { CanvasDocumentTab } from "./canvasWorkspaceTypes";

interface CanvasDocumentTabsProps {
  tabs: CanvasDocumentTab[];
  activeValue: string;
  onClose: (canvasId: string) => void;
  onRename: (canvasId: string, title: string) => void;
  onReorder: (tabs: CanvasDocumentTab[]) => void;
}

function SortableCanvasTab({ tab, active, onClose, onRename }: {
  tab: CanvasDocumentTab;
  active: boolean;
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

  const stopClosePointer = (event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };

  useEffect(() => {
    if (!renaming) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renaming]);

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

  return (
    <div
      ref={setNodeRef}
      className="rf-workspace-tab"
      data-active={active || undefined}
      data-dragging={isDragging || undefined}
      style={style}
      {...listeners}
    >
      {renaming ? (
        <div className="rf-workspace-tab__trigger rf-workspace-tab__editor">
          <Layers3 aria-hidden="true" />
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
          <Layers3 aria-hidden="true" />
          <span
            onDoubleClick={(event) => {
              if (tab.readOnly) return;
              event.preventDefault();
              event.stopPropagation();
              cancelRenameRef.current = false;
              setRenameDraft(tab.title);
              setRenaming(true);
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
  );
}

function CanvasTabOverlay({ tab }: { tab: CanvasDocumentTab }) {
  return (
    <div className="rf-workspace-tab rf-workspace-tab--overlay" aria-hidden="true">
      <span className="rf-workspace-tab__trigger">
        <Layers3 aria-hidden="true" />
        <span>{tab.title}</span>
      </span>
      <span className="rf-workspace-tab__close"><X aria-hidden="true" /></span>
    </div>
  );
}

export function CanvasDocumentTabs({ tabs, activeValue, onClose, onRename, onReorder }: CanvasDocumentTabsProps) {
  const { t } = useTranslation();
  const [draggedId, setDraggedId] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const tabIds = useMemo(() => tabs.map((tab) => tab.id), [tabs]);
  const draggedTab = tabs.find((tab) => tab.id === draggedId) || null;

  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>('[data-state="active"]');
    active?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeValue, tabs.length]);

  const finishDrag = ({ active, over }: DragEndEvent) => {
    setDraggedId("");
    if (!over || active.id === over.id) return;
    const sourceIndex = tabs.findIndex((tab) => tab.id === active.id);
    const targetIndex = tabs.findIndex((tab) => tab.id === over.id);
    if (sourceIndex < 0 || targetIndex < 0) return;
    onReorder(arrayMove(tabs, sourceIndex, targetIndex));
  };

  return (
    <div ref={listRef} className="rf-workspace-tabs-scroll">
      <TabsList className="rf-workspace-tabs" variant="line" aria-label={t("infiniteCanvas:title")}>
        <TabsTrigger className="rf-workspace-home-tab" value="home" title={t("infiniteCanvas:homeTitle")}>
          <Home aria-hidden="true" />
          <span>{t("infiniteCanvas:homeTitle")}</span>
        </TabsTrigger>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
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
                onClose={onClose}
                onRename={onRename}
              />
            ))}
          </SortableContext>
          <DragOverlay dropAnimation={null}>{draggedTab ? <CanvasTabOverlay tab={draggedTab} /> : null}</DragOverlay>
        </DndContext>
      </TabsList>
    </div>
  );
}
