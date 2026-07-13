import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { createPortal, flushSync } from "react-dom";
import { GripVertical, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ConfirmingDeleteButton } from "../../components/ConfirmingDeleteButton";
import { Button } from "../../components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Switch } from "../../components/ui/switch";
import { normalizeTags } from "./tagUtils";
import { LIBRARY_TAG_COLORS, normalizeLibraryTagColor, type LibraryTagColor } from "./tagColors";

export interface LibraryTagManagerTag {
  id: string;
  name: string;
  color?: LibraryTagColor | string | null;
  sort_order: number;
  usage_count?: number;
}

interface DragState<TTag extends LibraryTagManagerTag> {
  tag: TTag;
  pointerId: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  insertIndex: number;
  indicatorStyle: CSSProperties;
  hasMoved: boolean;
}

interface TagRect {
  id: string;
  index: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

interface LibraryTagManagerDialogProps<TTag extends LibraryTagManagerTag> {
  isOpen: boolean;
  tags: TTag[];
  isCreating: boolean;
  titleId: string;
  description: string;
  emptyText: string;
  onClose: () => void;
  onCreateTag: (name: string) => void;
  onRenameTag: (tagId: string, name: string) => void;
  onChangeTagColor: (tagId: string, color: LibraryTagColor) => void;
  onDeleteTag: (tagId: string) => void;
  onReorderTags: (tags: TTag[]) => void;
  sameColorSingleFilter: boolean;
  onSameColorSingleFilterChange: (enabled: boolean) => void;
}

function reorderTags<TTag>(tags: TTag[], draggedIndex: number, insertIndex: number) {
  if (draggedIndex < 0) return tags;
  const next = [...tags];
  const [dragged] = next.splice(draggedIndex, 1);
  const adjustedIndex = Math.max(0, Math.min(insertIndex > draggedIndex ? insertIndex - 1 : insertIndex, next.length));
  next.splice(adjustedIndex, 0, dragged);
  return next;
}

function collectTagRects(listElement: HTMLDivElement, draggedId: string) {
  return Array.from(listElement.querySelectorAll<HTMLElement>("[data-tag-id]"))
    .map((element) => {
      const id = element.dataset.tagId || "";
      if (!id || id === draggedId) return null;
      const rect = element.getBoundingClientRect();
      return {
        id,
        index: Number(element.dataset.tagIndex || 0),
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      } satisfies TagRect;
    })
    .filter((rect): rect is TagRect => Boolean(rect));
}

function insertionIndexFromPointer(rects: TagRect[], pointerX: number, pointerY: number) {
  if (!rects.length) return 0;
  const sortedRects = [...rects].sort((left, right) => left.top - right.top || left.left - right.left);
  const rows: TagRect[][] = [];
  for (const rect of sortedRects) {
    const row = rows.find((items) => Math.abs(items[0].top - rect.top) <= 8);
    if (row) row.push(rect);
    else rows.push([rect]);
  }
  for (const row of rows) row.sort((left, right) => left.left - right.left);
  rows.sort((left, right) => left[0].top - right[0].top);

  let targetRow = rows.find((row) => pointerY >= row[0].top - 6 && pointerY <= Math.max(...row.map((rect) => rect.bottom)) + 6);
  if (!targetRow) {
    targetRow = pointerY < rows[0][0].top ? rows[0] : rows[rows.length - 1];
  }

  for (const rect of targetRow) {
    if (pointerX < rect.left + rect.width / 2) return rect.index;
  }

  return targetRow[targetRow.length - 1].index + 1;
}

function createInsertionIndicatorStyle(listElement: HTMLDivElement, insertIndex: number): CSSProperties {
  const listRect = listElement.getBoundingClientRect();
  const elements = Array.from(listElement.querySelectorAll<HTMLElement>("[data-tag-id]"));
  const sortedElements = elements.sort((left, right) => Number(left.dataset.tagIndex || 0) - Number(right.dataset.tagIndex || 0));
  const targetElement = sortedElements.find((element) => Number(element.dataset.tagIndex || 0) >= insertIndex);
  const anchorElement = targetElement || sortedElements[sortedElements.length - 1];
  if (!anchorElement) return { display: "none" };

  const anchorRect = anchorElement.getBoundingClientRect();
  const left = targetElement ? anchorRect.left : anchorRect.right;
  return {
    left: left - listRect.left + listElement.scrollLeft,
    top: anchorRect.top - listRect.top + listElement.scrollTop,
    height: anchorRect.height,
  };
}

export function LibraryTagManagerDialog<TTag extends LibraryTagManagerTag>({
  isOpen,
  tags,
  isCreating,
  titleId,
  description,
  emptyText,
  onClose,
  onCreateTag,
  onRenameTag,
  onChangeTagColor,
  onDeleteTag,
  onReorderTags,
  sameColorSingleFilter,
  onSameColorSingleFilterChange,
}: LibraryTagManagerDialogProps<TTag>) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement | null>(null);
  const [selectedTagId, setSelectedTagId] = useState("");
  const [newTagName, setNewTagName] = useState("");
  const [draftTagName, setDraftTagName] = useState("");
  const [dragState, setDragState] = useState<DragState<TTag> | null>(null);
  const dragStateRef = useRef<DragState<TTag> | null>(null);
  const pendingTagOrderRef = useRef<string[] | null>(null);
  const selectedTag = tags.find((tag) => tag.id === selectedTagId) || null;

  useLayoutEffect(() => {
    const pendingOrder = pendingTagOrderRef.current;
    const orderCommitted = pendingOrder
      && pendingOrder.length === tags.length
      && pendingOrder.every((id, index) => tags[index]?.id === id);
    if (!orderCommitted) return;
    pendingTagOrderRef.current = null;
    dragStateRef.current = null;
    setDragState(null);
  }, [tags]);

  useEffect(() => {
    if (!isOpen) {
      pendingTagOrderRef.current = null;
      dragStateRef.current = null;
      setSelectedTagId("");
      setNewTagName("");
      setDraftTagName("");
      setDragState(null);
      return;
    }
    if (!selectedTagId && tags.length) {
      setSelectedTagId(tags[0].id);
      return;
    }
    if (selectedTagId && !tags.some((tag) => tag.id === selectedTagId)) {
      setSelectedTagId(tags[0]?.id || "");
    }
  }, [isOpen, selectedTagId, tags]);

  useEffect(() => {
    setDraftTagName(selectedTag?.name || "");
  }, [selectedTag?.id, selectedTag?.name]);

  useEffect(() => {
    dragStateRef.current = dragState;
  }, [dragState]);

  useEffect(() => {
    if (!dragState) return undefined;
    const activeDrag = dragState;
    function handlePointerMove(event: globalThis.PointerEvent) {
      if (event.pointerId !== activeDrag.pointerId) return;
      event.preventDefault();
      const listElement = listRef.current;
      const rects = listElement ? collectTagRects(listElement, activeDrag.tag.id) : [];
      setDragState((current) => {
        if (!current) return current;
        const insertIndex = insertionIndexFromPointer(rects, event.clientX, event.clientY);
        const next = {
          ...current,
          x: event.clientX - current.offsetX,
          y: event.clientY - current.offsetY,
          insertIndex,
          indicatorStyle: listElement ? createInsertionIndicatorStyle(listElement, insertIndex) : current.indicatorStyle,
          hasMoved: current.hasMoved || Math.abs(event.clientX - current.startX) > 3 || Math.abs(event.clientY - current.startY) > 3,
        };
        dragStateRef.current = next;
        return next;
      });
    }
    function finishDrag(event: globalThis.PointerEvent) {
      if (event.pointerId !== activeDrag.pointerId) return;
      event.preventDefault();
      const current = dragStateRef.current;
      if (!current || !current.hasMoved) {
        dragStateRef.current = null;
        setDragState(null);
        return;
      }
      const draggedIndex = tags.findIndex((tag) => tag.id === current.tag.id);
      const nextTags = reorderTags(tags, draggedIndex, current.insertIndex);
      if (!nextTags.some((tag, index) => tag.id !== tags[index]?.id)) {
        dragStateRef.current = null;
        setDragState(null);
        return;
      }
      pendingTagOrderRef.current = nextTags.map((tag) => tag.id);
      try {
        onReorderTags(nextTags);
      } catch (error) {
        pendingTagOrderRef.current = null;
        dragStateRef.current = null;
        flushSync(() => setDragState(null));
        throw error;
      }
    }
    function cancelDrag(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      pendingTagOrderRef.current = null;
      dragStateRef.current = null;
      setDragState(null);
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
  }, [dragState, onReorderTags, tags]);

  function submitActiveTagRename() {
    if (!selectedTag) return;
    const nextName = normalizeTags([draftTagName])[0] || "";
    if (!nextName || nextName === selectedTag.name) {
      setDraftTagName(selectedTag.name);
      return;
    }
    onRenameTag(selectedTag.id, nextName);
  }

  function startTagDrag(event: PointerEvent<HTMLSpanElement>, tag: TTag, index: number) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const chip = event.currentTarget.closest<HTMLElement>("[data-tag-id]");
    if (!chip) return;
    const rect = chip.getBoundingClientRect();
    const listElement = listRef.current;
    setSelectedTagId(tag.id);
    setDragState({
      tag,
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
      x: rect.left,
      y: rect.top,
      startX: event.clientX,
      startY: event.clientY,
      insertIndex: index,
      indicatorStyle: listElement ? createInsertionIndicatorStyle(listElement, index) : { display: "none" },
      hasMoved: false,
    });
  }

  function renderTagChip(tag: TTag) {
    const selected = selectedTagId === tag.id;
    const dragging = dragState?.tag.id === tag.id;
    const originalIndex = tags.findIndex((item) => item.id === tag.id);
    return (
      <Button
        key={tag.id}
        data-tag-id={tag.id}
        data-tag-index={originalIndex}
        className={`${selected ? "active" : ""}${dragging ? " dragging" : ""}`}
        type="button"
        variant={selected ? "default" : "outline"}
        onClick={() => setSelectedTagId(tag.id)}
      >
        <span className="library-tag-manager__drag-handle" aria-hidden="true" onPointerDown={(event) => startTagDrag(event, tag, originalIndex)}>
          <GripVertical size={13} />
        </span>
        <span className={`library-tag-color-dot library-tag-color-dot--${normalizeLibraryTagColor(tag.color)}`} aria-hidden="true" />
        <span className="library-tag-manager__tag-name">{tag.name}</span>
      </Button>
    );
  }

  const floatingStyle: CSSProperties | undefined = dragState
    ? { left: dragState.x, top: dragState.y, width: dragState.width, height: dragState.height }
    : undefined;

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => {
        if (!open && !isCreating) onClose();
      }}>
        <DialogContent
          className="library-tag-manager max-w-none overflow-y-auto sm:max-w-none"
          onEscapeKeyDown={(event) => {
            if (isCreating || dragState) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (isCreating) event.preventDefault();
          }}
        >
          <DialogHeader className="library-tag-manager__head flex-row text-left">
            <div>
              <DialogTitle id={titleId}>{t("common:labels.manageTags")}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </div>
            <div className="library-tag-manager__head-actions">
              <label className="library-tag-manager__setting">
                <span>{t("common:labels.sameColorSingleFilter")}</span>
                <Switch
                  checked={sameColorSingleFilter}
                  onCheckedChange={onSameColorSingleFilterChange}
                  aria-label={t("common:labels.sameColorSingleFilter")}
                />
              </label>
              <DialogClose asChild>
                <Button variant="ghost" size="icon-sm" type="button" disabled={isCreating} aria-label={t("common:actions.close")} title={t("common:actions.close")}>
                  <X aria-hidden="true" />
                </Button>
              </DialogClose>
            </div>
          </DialogHeader>

          <div className="dialog-field">
            <span>{t("common:labels.newTag")}</span>
            <div className="tag-create-row">
              <Input value={newTagName} onChange={(event) => setNewTagName(event.target.value)} maxLength={24} placeholder={t("common:labels.tagNamePlaceholder")} />
              <Button
                type="button"
                disabled={isCreating}
                onClick={() => {
                  onCreateTag(newTagName);
                  setNewTagName("");
                }}
              >
                {t("common:actions.add")}
              </Button>
            </div>
          </div>

          <div className="library-tag-manager__body">
            <div ref={listRef} className={`library-tag-manager__list${dragState ? " sorting" : ""}`} aria-label={t("common:labels.tagList")}>
              {tags.map((tag) => renderTagChip(tag))}
              {dragState ? <div className="library-tag-manager__insert-indicator" style={dragState.indicatorStyle} /> : null}
              {!tags.length ? <div className="library-tag-manager__empty">{emptyText}</div> : null}
            </div>

            {selectedTag ? (
              <div className="library-tag-manager__editor">
                <label className="dialog-field">
                  <span>{t("common:labels.editTag")}</span>
                  <Input
                    value={draftTagName}
                    onChange={(event) => setDraftTagName(event.target.value)}
                    onBlur={submitActiveTagRename}
                    maxLength={24}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        submitActiveTagRename();
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setDraftTagName(selectedTag.name);
                      }
                    }}
                  />
                </label>
                <div className="dialog-field">
                  <span>{t("common:labels.tagColor")}</span>
                  <div className="library-tag-manager__color-options" role="radiogroup" aria-label={t("common:labels.tagColor")}>
                    {LIBRARY_TAG_COLORS.map((color) => {
                      const selected = normalizeLibraryTagColor(selectedTag.color) === color;
                      return (
                        <Button
                          key={color}
                          className={`library-tag-manager__color-option${selected ? " active" : ""}`}
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          role="radio"
                          aria-checked={selected}
                          aria-label={color}
                          title={color}
                          onClick={() => {
                            if (!selected) onChangeTagColor(selectedTag.id, color);
                          }}
                        >
                          <span className={`library-tag-color-dot library-tag-color-dot--${color}`} aria-hidden="true" />
                        </Button>
                      );
                    })}
                  </div>
                </div>
                <ConfirmingDeleteButton
                  label={t("common:actions.delete")}
                  confirmLabel={t("common:confirm.delete")}
                  resetKey={selectedTag.id}
                  onDelete={() => onDeleteTag(selectedTag.id)}
                />
              </div>
            ) : (
              <div className="library-tag-manager__editor library-tag-manager__editor--empty">{t("common:labels.emptyTagEditor")}</div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      {dragState
        ? createPortal(
            <div className="library-tag-manager__floating-tag" style={floatingStyle}>
              <span className="library-tag-manager__drag-handle" aria-hidden="true">
                <GripVertical size={13} />
              </span>
              <span className={`library-tag-color-dot library-tag-color-dot--${normalizeLibraryTagColor(dragState.tag.color)}`} aria-hidden="true" />
              <span className="library-tag-manager__tag-name">{dragState.tag.name}</span>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
