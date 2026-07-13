import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { TextCursorInput, X } from "lucide-react";
import { useCallback, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode, type WheelEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Button } from "../../../components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../../../components/ui/hover-card";
import { Separator } from "../../../components/ui/separator";
import { ImageViewer } from "../../../lib/ImageViewer";
import { cn } from "../../../lib/utils";
import type {
  ImageGeneratorPromptInput,
  ImageGeneratorReferenceInput,
} from "../generation/imageGenerationInputs";

const restrictToHorizontalAxis: Modifier = ({ transform }) => ({ ...transform, y: 0 });

const horizontalCollisionDetection: CollisionDetection = ({
  droppableContainers,
  droppableRects,
  pointerCoordinates,
}) => {
  if (!pointerCoordinates) return [];
  return droppableContainers
    .flatMap((container) => {
      const rect = droppableRects.get(container.id);
      if (!rect) return [];
      return [{
        id: container.id,
        data: {
          droppableContainer: container,
          value: Math.abs(pointerCoordinates.x - (rect.left + rect.width / 2)),
        },
      }];
    })
    .sort((left, right) => left.data.value - right.data.value);
};

interface ReferenceItemProps {
  item: ImageGeneratorReferenceInput;
  index: number;
  invalid: boolean;
  onRemove: (edgeId: string) => void;
  onView: (item: ImageGeneratorReferenceInput) => void;
}

function SortableReferenceItem({ item, index, invalid, onRemove, onView }: ReferenceItemProps) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.edgeId });
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition };
  const stopRemovePointer = (event: PointerEvent<HTMLButtonElement>) => event.stopPropagation();

  return (
    <div
      ref={setNodeRef}
      className={cn("rf-reference-item", invalid && "is-invalid", isDragging && "is-dragging")}
      style={style}
      title={item.title}
      {...attributes}
      {...listeners}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onView(item);
      }}
    >
      <HoverCard openDelay={350} closeDelay={80}>
        <HoverCardTrigger asChild>
          <img src={item.previewUrl} alt={item.title} draggable={false} />
        </HoverCardTrigger>
        <HoverCardContent className="rf-reference-preview" side="top" sideOffset={8}>
          <img src={item.imageUrl} alt={item.title} draggable={false} />
        </HoverCardContent>
      </HoverCard>
      <span className="rf-reference-item__order">{index + 1}</span>
      <Button
        className="rf-reference-item__remove"
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={t("infiniteCanvas:removeReferenceImage")}
        title={t("infiniteCanvas:removeReferenceImage")}
        onPointerDown={stopRemovePointer}
        onClick={(event) => {
          event.stopPropagation();
          onRemove(item.edgeId);
        }}
      >
        <X aria-hidden="true" />
      </Button>
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
  );
}

function ReferenceOverlay({ item }: { item: ImageGeneratorReferenceInput }) {
  return (
    <div className="rf-reference-item rf-reference-item--overlay" aria-hidden="true">
      <img src={item.previewUrl} alt="" draggable={false} />
    </div>
  );
}

interface ImageReferenceStripProps {
  actions?: ReactNode;
  prompts: ImageGeneratorPromptInput[];
  items: ImageGeneratorReferenceInput[];
  maxReferences: number;
  supported: boolean;
  onRemove: (edgeId: string) => void;
  onReorder: (orderedEdgeIds: string[]) => void;
}

export function ImageReferenceStrip({
  actions,
  prompts,
  items,
  maxReferences,
  supported,
  onRemove,
  onReorder,
}: ImageReferenceStripProps) {
  const { t } = useTranslation();
  const [draggedId, setDraggedId] = useState("");
  const [viewerItem, setViewerItem] = useState<ImageGeneratorReferenceInput | null>(null);
  const itemsViewportRef = useRef<HTMLDivElement | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const invalid = !supported || items.length > maxReferences;
  const draggedItem = items.find((item) => item.edgeId === draggedId) || null;
  const restrictToReferenceViewport = useCallback<Modifier>(({ activeNodeRect, draggingNodeRect, overlayNodeRect, transform }) => {
    const viewport = itemsViewportRef.current?.getBoundingClientRect();
    const draggedRect = overlayNodeRect || draggingNodeRect || activeNodeRect;
    if (!viewport || !draggedRect) return { ...transform, y: 0 };
    const minX = viewport.left - draggedRect.left;
    const maxX = viewport.right - draggedRect.right;
    return {
      ...transform,
      x: Math.max(minX, Math.min(maxX, transform.x)),
      y: 0,
    };
  }, []);

  if (!prompts.length && !items.length && !actions) return null;

  const finishDrag = ({ active, over }: DragEndEvent) => {
    setDraggedId("");
    if (!over || active.id === over.id) return;
    const sourceIndex = items.findIndex((item) => item.edgeId === active.id);
    const targetIndex = items.findIndex((item) => item.edgeId === over.id);
    if (sourceIndex < 0 || targetIndex < 0) return;
    onReorder(arrayMove(items, sourceIndex, targetIndex).map((item) => item.edgeId));
  };

  const scrollReferences = (event: WheelEvent<HTMLDivElement>) => {
    const container = event.currentTarget;
    if (container.scrollWidth <= container.clientWidth) return;
    event.preventDefault();
    event.stopPropagation();
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    container.scrollBy({ left: delta, behavior: "smooth" });
  };

  return (
    <div className="rf-reference-strip" data-invalid={invalid || undefined}>
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
        collisionDetection={horizontalCollisionDetection}
        modifiers={[restrictToHorizontalAxis, restrictToReferenceViewport]}
        onDragStart={({ active }: DragStartEvent) => setDraggedId(String(active.id))}
        onDragCancel={() => setDraggedId("")}
        onDragEnd={finishDrag}
      >
        <div
          ref={itemsViewportRef}
          className="rf-reference-strip__items"
          role="list"
          aria-label={t("infiniteCanvas:connectedInputs")}
          onWheel={scrollReferences}
        >
          {prompts.map((item) => (
            <PromptReferenceItem key={item.edgeId} item={item} onRemove={onRemove} />
          ))}
          {prompts.length > 0 && items.length > 0 ? (
            <Separator className="rf-reference-strip__separator" orientation="vertical" />
          ) : null}
          <SortableContext items={items.map((item) => item.edgeId)} strategy={horizontalListSortingStrategy}>
            <div className="rf-reference-strip__sortable">
            {items.map((item, index) => (
              <SortableReferenceItem
                key={item.edgeId}
                item={item}
                index={index}
                invalid={!supported || index >= maxReferences}
                onRemove={onRemove}
                onView={setViewerItem}
              />
            ))}
            </div>
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
