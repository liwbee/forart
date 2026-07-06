import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { GripVertical } from "lucide-react";
import { useTranslation } from "react-i18next";
import { normalizeTags } from "../model-library/tagUtils";

export interface LibraryTagManagerTag {
  id: string;
  name: string;
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
  deleteConfirmTagId: string;
  titleId: string;
  description: string;
  emptyText: string;
  onClose: () => void;
  onCreateTag: (name: string) => void;
  onRenameTag: (tagId: string, name: string) => void;
  onDeleteTag: (tagId: string, isConfirming: boolean) => void;
  onReorderTags: (tags: TTag[]) => void;
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
  deleteConfirmTagId,
  titleId,
  description,
  emptyText,
  onClose,
  onCreateTag,
  onRenameTag,
  onDeleteTag,
  onReorderTags,
}: LibraryTagManagerDialogProps<TTag>) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement | null>(null);
  const [selectedTagId, setSelectedTagId] = useState("");
  const [newTagName, setNewTagName] = useState("");
  const [draftTagName, setDraftTagName] = useState("");
  const [dragState, setDragState] = useState<DragState<TTag> | null>(null);
  const dragStateRef = useRef<DragState<TTag> | null>(null);
  const selectedTag = tags.find((tag) => tag.id === selectedTagId) || null;

  useEffect(() => {
    if (!isOpen) {
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
      setDragState(null);
      dragStateRef.current = null;
      if (!current || !current.hasMoved) return;
      const draggedIndex = tags.findIndex((tag) => tag.id === current.tag.id);
      const nextTags = reorderTags(tags, draggedIndex, current.insertIndex);
      if (nextTags.some((tag, index) => tag.id !== tags[index]?.id)) onReorderTags(nextTags);
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
  }, [dragState, onReorderTags, tags]);

  if (!isOpen) return null;

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
      <button
        key={tag.id}
        data-tag-id={tag.id}
        data-tag-index={originalIndex}
        className={`${selected ? "active" : ""}${dragging ? " dragging" : ""}`}
        type="button"
        onClick={() => setSelectedTagId(tag.id)}
      >
        <span className="model-tag-manager__drag-handle" aria-hidden="true" onPointerDown={(event) => startTagDrag(event, tag, originalIndex)}>
          <GripVertical size={13} />
        </span>
        <span className="model-tag-manager__tag-name">{tag.name}</span>
      </button>
    );
  }

  const floatingStyle: CSSProperties | undefined = dragState
    ? { left: dragState.x, top: dragState.y, width: dragState.width, height: dragState.height }
    : undefined;

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="model-tag-manager" role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog__head">
          <h2 id={titleId}>{t("common:labels.manageTags")}</h2>
          <p>{description}</p>
        </div>

        <div className="dialog-field">
          <span>{t("common:labels.newTag")}</span>
          <div className="tag-create-row">
            <input value={newTagName} onChange={(event) => setNewTagName(event.target.value)} maxLength={24} placeholder={t("common:labels.tagNamePlaceholder")} />
            <button
              className="button primary"
              type="button"
              disabled={isCreating}
              onClick={() => {
                onCreateTag(newTagName);
                setNewTagName("");
              }}
            >
              {t("common:actions.add")}
            </button>
          </div>
        </div>

        <div className="model-tag-manager__body">
          <div ref={listRef} className={`model-tag-manager__list${dragState ? " sorting" : ""}`} aria-label={t("common:labels.tagList")}>
            {tags.map((tag) => renderTagChip(tag))}
            {dragState ? <div className="model-tag-manager__insert-indicator" style={dragState.indicatorStyle} /> : null}
            {!tags.length ? <div className="model-tag-manager__empty">{emptyText}</div> : null}
          </div>

          {selectedTag ? (
            <div className="model-tag-manager__editor">
              <label className="dialog-field">
                <span>{t("common:labels.editTag")}</span>
                <input
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
              <button
                className={`button danger${deleteConfirmTagId === selectedTag.id ? " confirming" : ""}`}
                type="button"
                onClick={() => onDeleteTag(selectedTag.id, deleteConfirmTagId === selectedTag.id)}
              >
                {deleteConfirmTagId === selectedTag.id ? t("common:confirm.delete") : t("common:actions.delete")}
              </button>
            </div>
          ) : (
            <div className="model-tag-manager__editor model-tag-manager__editor--empty">{t("common:labels.emptyTagEditor")}</div>
          )}
        </div>
      </section>
      {dragState
        ? createPortal(
            <div className="model-tag-manager__floating-tag" style={floatingStyle}>
              <span className="model-tag-manager__drag-handle" aria-hidden="true">
                <GripVertical size={13} />
              </span>
              <span className="model-tag-manager__tag-name">{dragState.tag.name}</span>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
