import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FolderKanban, Images, TextCursorInput, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Button } from "../../../components/ui/button";
import { ImageWithFallback } from "../../../components/ImageWithFallback";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../../../components/ui/hover-card";
import { Separator } from "../../../components/ui/separator";
import { ImageViewer } from "../../../lib/ImageViewer";
import { cn } from "../../../lib/utils";
import type {
  ImageGeneratorPromptInput,
  ImageGeneratorReferenceInput,
} from "../generation/imageGenerationInputs";

interface ReferenceItemProps {
  item: ImageGeneratorReferenceInput;
  index: number;
  invalid: boolean;
  readOnly?: boolean;
  onRemove: (edgeId: string) => void;
  onView: (item: ImageGeneratorReferenceInput) => void;
}

function SortableReferenceItem({ item, index, invalid, readOnly = false, onRemove, onView }: ReferenceItemProps) {
  const { t } = useTranslation();
  // 组内图片展开出来的参考：删除任意一条 = 断开整个组，顺序可以单独调。
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.edgeId, disabled: readOnly });
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition };
  const stopRemovePointer = (event: PointerEvent<HTMLButtonElement>) => event.stopPropagation();
  const removeLabel = item.fromGroup
    ? t("infiniteCanvas:removeGroupReference")
    : t("infiniteCanvas:removeReferenceImage");

  return (
    <div
      ref={setNodeRef}
      className={cn("rf-reference-item", invalid && "is-invalid", isDragging && "is-dragging", item.fromGroup && "is-from-group")}
      style={style}
      title={item.title}
      {...attributes}
      {...listeners}
      aria-disabled={readOnly || undefined}
      onDoubleClick={(event) => {
        if (readOnly) return;
        event.preventDefault();
        event.stopPropagation();
        onView(item);
      }}
    >
      <HoverCard openDelay={350} closeDelay={80}>
        <HoverCardTrigger asChild>
          <span className="rf-reference-item__preview-trigger">
            {item.previewUrl || item.imageUrl ? (
              <ImageWithFallback src={item.previewUrl} fallbackSrc={item.imageUrl} alt={item.title} loading="lazy" decoding="async" draggable={false} />
            ) : <Images aria-hidden="true" />}
          </span>
        </HoverCardTrigger>
        <HoverCardContent className="rf-reference-preview" side="top" sideOffset={8}>
          {item.previewUrl || item.imageUrl ? (
            <ImageWithFallback src={item.previewUrl} fallbackSrc={item.imageUrl} alt={item.title} loading="lazy" decoding="async" draggable={false} />
          ) : <Images aria-hidden="true" />}
        </HoverCardContent>
      </HoverCard>
      <span className="rf-reference-item__order">{index + 1}</span>
      {item.fromGroup ? (
        <span className="rf-reference-item__group" title={t("infiniteCanvas:groupReference")} aria-label={t("infiniteCanvas:groupReference")}>
          <FolderKanban aria-hidden="true" />
        </span>
      ) : null}
      {!readOnly ? <Button
        className="rf-reference-item__remove"
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={removeLabel}
        title={removeLabel}
        onPointerDown={stopRemovePointer}
        onClick={(event) => {
          event.stopPropagation();
          // 一条边贡献多张参考（组 / 多图节点）时，删掉任意一张就是断开这条连线。
          onRemove(item.sourceEdgeId || item.edgeId);
        }}
      >
        <X aria-hidden="true" />
      </Button> : null}
    </div>
  );
}

function PromptReferenceItem({
  item,
  onRemove,
}: {
  item: ImageGeneratorPromptInput;
  onRemove: (edgeId: string) => void;
}) {
  const { t } = useTranslation();
  const label = item.text || item.title;

  return (
    <HoverCard openDelay={250} closeDelay={80}>
      <HoverCardTrigger asChild>
        <div className="rf-prompt-reference-item" title={label} role="listitem">
          <TextCursorInput aria-hidden="true" />
          <span>{label}</span>
          <Button
            className="rf-prompt-reference-item__remove"
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t("infiniteCanvas:removePromptReference")}
            title={t("infiniteCanvas:removePromptReference")}
            onClick={(event) => {
              event.stopPropagation();
              onRemove(item.edgeId);
            }}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      </HoverCardTrigger>
      {label ? (
        <HoverCardContent className="rf-prompt-reference-preview" side="top" sideOffset={6}>
          {label}
        </HoverCardContent>
      ) : null}
    </HoverCard>
  );
}

function ReferenceOverlay({ item }: { item: ImageGeneratorReferenceInput }) {
  return (
    <div className="rf-reference-item rf-reference-item--overlay" aria-hidden="true">
      {item.previewUrl || item.imageUrl ? <ImageWithFallback src={item.previewUrl} fallbackSrc={item.imageUrl} alt="" loading="lazy" decoding="async" draggable={false} /> : <Images aria-hidden="true" />}
      {item.fromGroup ? (
        <span className="rf-reference-item__group">
          <FolderKanban aria-hidden="true" />
        </span>
      ) : null}
    </div>
  );
}

interface ImageReferenceStripProps {
  actions?: ReactNode;
  prompts: ImageGeneratorPromptInput[];
  items: ImageGeneratorReferenceInput[];
  prefixItems?: ImageGeneratorReferenceInput[];
  prefixItemOrder?: number;
  maxReferences?: number;
  supported: boolean;
  onRemove: (edgeId: string) => void;
  onReorder: (orderedEdgeIds: string[]) => void;
}

export function ImageReferenceStrip({
  actions,
  prompts,
  items,
  prefixItems = [],
  prefixItemOrder = 0,
  maxReferences = Number.POSITIVE_INFINITY,
  supported,
  onRemove,
  onReorder,
}: ImageReferenceStripProps) {
  const { t } = useTranslation();
  const [draggedId, setDraggedId] = useState("");
  const [optimisticOrder, setOptimisticOrder] = useState<string[] | null>(null);
  const [viewerItem, setViewerItem] = useState<ImageGeneratorReferenceInput | null>(null);
  const itemsViewportRef = useRef<HTMLDivElement | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const invalid = !supported || items.length > maxReferences;
  const sortableItems = useMemo(() => {
    if (!prefixItems.length) return items;
    const next = [...items];
    const insertionIndex = Math.max(0, Math.min(next.length, Math.round(prefixItemOrder)));
    next.splice(insertionIndex, 0, ...prefixItems);
    return next;
  }, [items, prefixItemOrder, prefixItems]);
  const renderedItems = useMemo(() => {
    if (!optimisticOrder) return sortableItems;
    const itemById = new Map(sortableItems.map((item) => [item.edgeId, item]));
    const orderedItems = optimisticOrder.flatMap((edgeId) => {
      const item = itemById.get(edgeId);
      return item ? [item] : [];
    });
    return orderedItems.length === sortableItems.length ? orderedItems : sortableItems;
  }, [optimisticOrder, sortableItems]);
  const draggedItem = renderedItems.find((item) => item.edgeId === draggedId) || null;

  useEffect(() => {
    if (!optimisticOrder) return;
    const itemIds = sortableItems.map((item) => item.edgeId);
    const sameMembers = itemIds.length === optimisticOrder.length
      && itemIds.every((edgeId) => optimisticOrder.includes(edgeId));
    if (!sameMembers || itemIds.every((edgeId, index) => edgeId === optimisticOrder[index])) {
      setOptimisticOrder(null);
    }
  }, [optimisticOrder, sortableItems]);
  const restrictToReferenceViewport = useCallback<Modifier>(({ activeNodeRect, draggingNodeRect, overlayNodeRect, transform }) => {
    const viewport = itemsViewportRef.current?.getBoundingClientRect();
    const draggedRect = overlayNodeRect || draggingNodeRect || activeNodeRect;
    if (!viewport || !draggedRect) return transform;
    const minX = viewport.left - draggedRect.left;
    const maxX = viewport.right - draggedRect.right;
    const minY = viewport.top - draggedRect.top;
    const maxY = viewport.bottom - draggedRect.bottom;
    return {
      ...transform,
      x: Math.max(minX, Math.min(maxX, transform.x)),
      y: Math.max(minY, Math.min(maxY, transform.y)),
    };
  }, []);

  if (!prompts.length && !items.length && !actions) return null;

  const finishDrag = ({ active, over }: DragEndEvent) => {
    setDraggedId("");
    if (!over || active.id === over.id) return;
    const sourceIndex = renderedItems.findIndex((item) => item.edgeId === active.id);
    const targetIndex = renderedItems.findIndex((item) => item.edgeId === over.id);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const nextOrder = arrayMove(renderedItems, sourceIndex, targetIndex).map((item) => item.edgeId);
    setOptimisticOrder(nextOrder);
    onReorder(nextOrder);
  };

  return (
    <div
      ref={itemsViewportRef}
      className="rf-reference-strip"
      data-invalid={invalid || undefined}
      role="list"
      aria-label={t("infiniteCanvas:connectedInputs")}
    >
      {actions ? (
        <div className="rf-reference-actions-tile" aria-label={t("infiniteCanvas:referenceImages")}>
          <span>{items.length}/{supported ? maxReferences : 0}</span>
          <div>{actions}</div>
        </div>
      ) : null}
      {actions && (prompts.length > 0 || items.length > 0) ? (
        <Separator className="rf-reference-strip__separator" orientation="vertical" />
      ) : null}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToReferenceViewport]}
        onDragStart={({ active }: DragStartEvent) => setDraggedId(String(active.id))}
        onDragCancel={() => setDraggedId("")}
        onDragEnd={finishDrag}
      >
        <div className="rf-reference-strip__items">
          {prompts.map((item) => (
            <PromptReferenceItem key={item.edgeId} item={item} onRemove={onRemove} />
          ))}
          <SortableContext items={renderedItems.map((item) => item.edgeId)} strategy={rectSortingStrategy}>
            {renderedItems.map((item, index) => (
              <SortableReferenceItem
                key={item.edgeId}
                item={item}
                index={index}
                invalid={!supported || (prefixItems.some((prefix) => prefix.edgeId === item.edgeId) ? false : renderedItems.slice(0, index).filter((candidate) => !prefixItems.some((prefix) => prefix.edgeId === candidate.edgeId)).length >= maxReferences)}
                readOnly={prefixItems.some((prefix) => prefix.edgeId === item.edgeId)}
                onRemove={onRemove}
                onView={setViewerItem}
              />
            ))}
          </SortableContext>
        </div>
        {typeof document !== "undefined" ? createPortal(
          <DragOverlay dropAnimation={null}>
            {draggedItem ? <ReferenceOverlay item={draggedItem} /> : null}
          </DragOverlay>,
          document.body,
        ) : null}
      </DndContext>
      {viewerItem ? (
        <ImageViewer
          src={viewerItem.imageUrl}
          alt={viewerItem.title}
          onClose={() => setViewerItem(null)}
        />
      ) : null}
    </div>
  );
}
