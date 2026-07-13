import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import { cn } from "../lib/utils";

interface DraggableListRenderContext {
  isDragging: boolean;
  dragHandleProps: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  };
}

interface DraggableListProps<TItem> {
  items: TItem[];
  getId: (item: TItem) => string;
  onReorder: (items: TItem[]) => void;
  renderItem: (item: TItem, context: DraggableListRenderContext) => ReactNode;
  className?: string;
  itemClassName?: (item: TItem, context: { isDragging: boolean }) => string;
  scrollContainerRef?: { current: HTMLElement | null };
  disabled?: boolean;
  empty?: ReactNode;
}

interface DragState<TItem> {
  id: string;
  item: TItem;
  insertIndex: number;
  phase: "dragging" | "dropping";
  pointerY: number;
  pointerOffsetX: number;
  pointerOffsetY: number;
  layout: SortableLayout[];
  rect: {
    left: number;
    width: number;
    height: number;
  };
}

interface SortableLayout {
  id: string;
  top: number;
  height: number;
}

const AUTO_SCROLL_EDGE_SIZE = 72;
const AUTO_SCROLL_MAX_STEP = 18;
const REORDER_SPRING_STIFFNESS = 420;
const REORDER_SPRING_DAMPING = 34;
const REORDER_SPRING_REST_DELTA = 0.35;
const REORDER_SPRING_REST_SPEED = 18;
const SCROLLABLE_OVERFLOW_PATTERN = /(auto|scroll|overlay)/;

interface SpringValue {
  value: number;
  velocity: number;
  target: number;
}

function idsEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function emptyHandleProps() {
  return {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      event.preventDefault();
    },
  };
}

function findNearestVerticalScrollContainer(startElement: HTMLElement) {
  let element: HTMLElement | null = startElement.parentElement;
  while (element && element !== document.body) {
    if (element.dataset.slot === "scroll-area-viewport") return element;
    const style = window.getComputedStyle(element);
    const canScrollVertically = element.scrollHeight > element.clientHeight + 1;
    if (canScrollVertically && SCROLLABLE_OVERFLOW_PATTERN.test(style.overflowY)) return element;
    element = element.parentElement;
  }
  return null;
}

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (!window.matchMedia) return;
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);
    updatePreference();
    mediaQuery.addEventListener("change", updatePreference);
    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  return prefersReducedMotion;
}

export function DraggableList<TItem>({
  items,
  getId,
  onReorder,
  renderItem,
  className,
  itemClassName,
  scrollContainerRef,
  disabled = false,
  empty = null,
}: DraggableListProps<TItem>) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const itemsRef = useRef(items);
  const dragStateRef = useRef<DragState<TItem> | null>(null);
  const autoScrollFrameRef = useRef(0);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const overlayFrameRef = useRef(0);
  const overlayTopRef = useRef(0);
  const overlaySpringRef = useRef<SpringValue | null>(null);
  const autoScrollContainerRef = useRef<HTMLElement | null>(null);
  const rowSpringFrameRef = useRef(0);
  const rowSpringLastTimeRef = useRef(0);
  const rowSpringsRef = useRef(new Map<string, SpringValue>());
  const cleanupRef = useRef<(() => void) | null>(null);
  const pendingDropOrderRef = useRef<string[] | null>(null);
  const [dragState, setDragState] = useState<DragState<TItem> | null>(null);
  const shouldReduceMotion = usePrefersReducedMotion();

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useLayoutEffect(() => {
    const pendingOrder = pendingDropOrderRef.current;
    if (!pendingOrder || !idsEqual(items.map(getId), pendingOrder)) return;
    pendingDropOrderRef.current = null;
    itemsRef.current = items;
    setCurrentDragState(null);
  }, [items]);

  useEffect(() => {
    if (!dragState || dragState.phase !== "dragging") return;
    setOverlayTop(dragState.pointerY - dragState.pointerOffsetY, "none");
  }, [dragState]);

  useEffect(() => {
    return () => {
      pendingDropOrderRef.current = null;
      stopDragListeners();
      cancelOverlayAnimation();
      clearRowSpringAnimation();
    };
  }, []);

  const draggingId = dragState?.id || "";

  function setCurrentDragState(next: DragState<TItem> | null) {
    if (next) {
      animateRowsTo(next);
    } else {
      clearRowSpringAnimation();
    }
    dragStateRef.current = next;
    setDragState(next);
  }

  function getSortableRows() {
    const list = listRef.current;
    return list ? Array.from(list.querySelectorAll<HTMLElement>("[data-draggable-list-id]")) : [];
  }

  function captureSortableLayout() {
    const list = listRef.current;
    if (!list) return [];
    const listRect = list.getBoundingClientRect();
    return getSortableRows().map((row) => ({
      id: row.dataset.draggableListId || "",
      top: row.getBoundingClientRect().top - listRect.top,
      height: row.getBoundingClientRect().height,
    })).filter((row) => row.id);
  }

  function buildTransformMap(current: DragState<TItem>) {
    const ids = items.map(getId);
    const remainingIds = ids.filter((id) => id !== current.id);
    const insertIndex = Math.max(0, Math.min(current.insertIndex, remainingIds.length));
    const targetIds = [...remainingIds];
    targetIds.splice(insertIndex, 0, current.id);
    const targetIndexById = new Map(targetIds.map((id, index) => [id, index]));
    const transforms = new Map<string, number>();

    ids.forEach((id, index) => {
      if (id === current.id) return;
      const targetIndex = targetIndexById.get(id);
      const sourceSlot = current.layout[index];
      const targetSlot = targetIndex === undefined ? undefined : current.layout[targetIndex];
      if (!sourceSlot || !targetSlot) return;
      transforms.set(id, targetSlot.top - sourceSlot.top);
    });

    return transforms;
  }

  function stopDragListeners() {
    if (autoScrollFrameRef.current) cancelAnimationFrame(autoScrollFrameRef.current);
    autoScrollFrameRef.current = 0;
    cleanupRef.current?.();
    cleanupRef.current = null;
  }

  function cancelOverlayAnimation() {
    if (overlayFrameRef.current) cancelAnimationFrame(overlayFrameRef.current);
    overlayFrameRef.current = 0;
    overlaySpringRef.current = null;
  }

  function setOverlayTop(top: number, transition: string) {
    overlayTopRef.current = top;
    const overlay = overlayRef.current;
    if (!overlay) return;
    overlay.style.transition = transition;
    overlay.style.transform = `translate3d(0, ${top}px, 0)`;
  }

  function scheduleOverlayTop(top: number) {
    overlayTopRef.current = top;
    if (overlayFrameRef.current) return;
    overlayFrameRef.current = requestAnimationFrame(() => {
      overlayFrameRef.current = 0;
      setOverlayTop(overlayTopRef.current, "none");
    });
  }

  function stepSpring(spring: SpringValue, deltaSeconds: number) {
    const displacement = spring.value - spring.target;
    const acceleration = (-REORDER_SPRING_STIFFNESS * displacement) - (REORDER_SPRING_DAMPING * spring.velocity);
    const nextVelocity = spring.velocity + acceleration * deltaSeconds;
    const nextValue = spring.value + nextVelocity * deltaSeconds;
    spring.velocity = nextVelocity;
    spring.value = nextValue;
    return Math.abs(nextVelocity) <= REORDER_SPRING_REST_SPEED && Math.abs(nextValue - spring.target) <= REORDER_SPRING_REST_DELTA;
  }

  function animateRowsTo(current: DragState<TItem>) {
    const rows = getSortableRows();
    const targets = buildTransformMap(current);

    if (shouldReduceMotion) {
      rows.forEach((row) => {
        const id = row.dataset.draggableListId || "";
        const target = id === current.id ? 0 : targets.get(id) || 0;
        row.style.transform = target ? `translate3d(0, ${target}px, 0)` : "";
        row.style.willChange = target ? "transform" : "";
      });
      return;
    }

    rows.forEach((row) => {
      const id = row.dataset.draggableListId || "";
      if (!id) return;
      const target = id === current.id ? 0 : targets.get(id) || 0;
      const spring = rowSpringsRef.current.get(id) || { value: target, velocity: 0, target };
      spring.target = target;
      rowSpringsRef.current.set(id, spring);
      row.style.willChange = target ? "transform" : "";
    });

    if (!rowSpringFrameRef.current) {
      rowSpringLastTimeRef.current = performance.now();
      rowSpringFrameRef.current = requestAnimationFrame(runRowSpringAnimation);
    }
  }

  function runRowSpringAnimation(timestamp: number) {
    const deltaSeconds = Math.min(0.032, Math.max(0.001, (timestamp - rowSpringLastTimeRef.current) / 1000));
    rowSpringLastTimeRef.current = timestamp;

    let running = false;
    const rowsById = new Map(getSortableRows().map((row) => [row.dataset.draggableListId || "", row]));
    rowSpringsRef.current.forEach((spring, id) => {
      const done = stepSpring(spring, deltaSeconds);
      const row = rowsById.get(id);
      if (row) {
        row.style.transform = Math.abs(spring.value) > 0.1 ? `translate3d(0, ${spring.value}px, 0)` : "";
        row.style.willChange = Math.abs(spring.target) > 0.1 || !done ? "transform" : "";
      }
      if (done) {
        spring.value = spring.target;
        spring.velocity = 0;
      } else {
        running = true;
      }
    });

    if (running) {
      rowSpringFrameRef.current = requestAnimationFrame(runRowSpringAnimation);
      return;
    }

    rowSpringFrameRef.current = 0;
  }

  function clearRowSpringAnimation() {
    if (rowSpringFrameRef.current) cancelAnimationFrame(rowSpringFrameRef.current);
    rowSpringFrameRef.current = 0;
    rowSpringLastTimeRef.current = 0;
    rowSpringsRef.current.clear();
    getSortableRows().forEach((row) => {
      row.style.transform = "";
      row.style.willChange = "";
    });
  }

  function animateOverlayToTop(targetTop: number, onComplete: () => void) {
    cancelOverlayAnimation();
    if (shouldReduceMotion) {
      setOverlayTop(targetTop, "none");
      onComplete();
      return;
    }

    overlaySpringRef.current = {
      value: overlayTopRef.current,
      velocity: 0,
      target: targetTop,
    };
    overlayFrameRef.current = requestAnimationFrame(function runOverlaySpring() {
      const spring = overlaySpringRef.current;
      if (!spring) return;
      const done = stepSpring(spring, 1 / 60);
      setOverlayTop(spring.value, "none");
      if (done) {
        setOverlayTop(spring.target, "none");
        cancelOverlayAnimation();
        onComplete();
        return;
      }
      overlayFrameRef.current = requestAnimationFrame(runOverlaySpring);
    });
  }

  function updateInsertIndex(pointerY: number) {
    const current = dragStateRef.current;
    const list = listRef.current;
    if (!current || !list) return;

    const listTop = list.getBoundingClientRect().top;
    let compactIndex = 0;
    let nextInsertIndex = current.layout.length - 1;
    for (const row of current.layout) {
      if (row.id === current.id) continue;
      const rowTop = listTop + row.top;
      if (pointerY < rowTop + row.height / 2) {
        nextInsertIndex = compactIndex;
        break;
      }
      compactIndex += 1;
      nextInsertIndex = compactIndex;
    }

    if (nextInsertIndex !== current.insertIndex) {
      setCurrentDragState({ ...current, insertIndex: nextInsertIndex });
    }
  }

  function runAutoScroll() {
    const current = dragStateRef.current;
    const container = scrollContainerRef?.current ?? autoScrollContainerRef.current;
    if (!current) {
      autoScrollFrameRef.current = 0;
      return;
    }
    if (!container) {
      autoScrollFrameRef.current = 0;
      return;
    }

    const rect = container.getBoundingClientRect();
    const distanceToTop = current.pointerY - rect.top;
    const distanceToBottom = rect.bottom - current.pointerY;
    let delta = 0;

    if (distanceToTop < AUTO_SCROLL_EDGE_SIZE) {
      const strength = Math.max(0, Math.min(1, (AUTO_SCROLL_EDGE_SIZE - distanceToTop) / AUTO_SCROLL_EDGE_SIZE));
      delta = -AUTO_SCROLL_MAX_STEP * strength * strength;
    } else if (distanceToBottom < AUTO_SCROLL_EDGE_SIZE) {
      const strength = Math.max(0, Math.min(1, (AUTO_SCROLL_EDGE_SIZE - distanceToBottom) / AUTO_SCROLL_EDGE_SIZE));
      delta = AUTO_SCROLL_MAX_STEP * strength * strength;
    }

    if (delta) container.scrollTop += delta;
    updateInsertIndex(current.pointerY);
    autoScrollFrameRef.current = requestAnimationFrame(runAutoScroll);
  }

  function startDrag(item: TItem, sourceIndex: number, event: ReactPointerEvent<HTMLElement>) {
    if (disabled || event.button !== 0 || dragStateRef.current) return;
    const rowElement = event.currentTarget.closest<HTMLElement>("[data-draggable-list-item]");
    if (!rowElement) return;

    event.preventDefault();
    event.stopPropagation();

    stopDragListeners();
    const rect = rowElement.getBoundingClientRect();
    const layout = captureSortableLayout();
    autoScrollContainerRef.current = scrollContainerRef?.current ?? findNearestVerticalScrollContainer(rowElement);
    const nextDragState: DragState<TItem> = {
      id: getId(item),
      item,
      insertIndex: sourceIndex,
      phase: "dragging",
      pointerY: event.clientY,
      pointerOffsetX: event.clientX - rect.left,
      pointerOffsetY: event.clientY - rect.top,
      layout,
      rect: {
        left: rect.left,
        width: rect.width,
        height: rect.height,
      },
    };
    overlayTopRef.current = event.clientY - nextDragState.pointerOffsetY;
    setCurrentDragState(nextDragState);

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      const current = dragStateRef.current;
      if (!current || current.phase !== "dragging") return;
      const next = {
        ...current,
        pointerY: moveEvent.clientY,
      };
      dragStateRef.current = next;
      scheduleOverlayTop(moveEvent.clientY - current.pointerOffsetY);
      updateInsertIndex(moveEvent.clientY);
    };

    const handlePointerUp = () => commitDrag();
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    cleanupRef.current = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };

    if (autoScrollContainerRef.current) {
      autoScrollFrameRef.current = requestAnimationFrame(runAutoScroll);
    }
  }

  function commitDrag() {
    const current = dragStateRef.current;
    stopDragListeners();
    if (!current) return;
    if (current.phase === "dropping") return;

    const targetTop = getDropTargetTop(current);
    const nextDragState = { ...current, phase: "dropping" as const };
    setCurrentDragState(nextDragState);
    if (shouldReduceMotion || Math.abs(targetTop - overlayTopRef.current) < 0.5) {
      finishDrop(nextDragState);
      return;
    }

    const overlay = overlayRef.current;
    if (!overlay) {
      finishDrop(nextDragState);
      return;
    }

    setOverlayTop(overlayTopRef.current, "none");
    void overlay.offsetHeight;
    animateOverlayToTop(targetTop, () => finishDrop(nextDragState));
  }

  function getDropTargetTop(current: DragState<TItem>) {
    const list = listRef.current;
    if (!list) return overlayTopRef.current;
    const ids = itemsRef.current.map(getId);
    const remainingIds = ids.filter((id) => id !== current.id);
    const insertIndex = Math.max(0, Math.min(current.insertIndex, remainingIds.length));
    const targetIds = [...remainingIds];
    targetIds.splice(insertIndex, 0, current.id);
    const targetIndex = targetIds.indexOf(current.id);
    const targetSlot = current.layout[targetIndex];
    return targetSlot ? list.getBoundingClientRect().top + targetSlot.top : overlayTopRef.current;
  }

  function finishDrop(current: DragState<TItem>) {
    cancelOverlayAnimation();

    const sourceItems = itemsRef.current;
    const remaining = sourceItems.filter((item) => getId(item) !== current.id);
    const insertIndex = Math.max(0, Math.min(current.insertIndex, remaining.length));
    const nextItems = [...remaining];
    nextItems.splice(insertIndex, 0, current.item);
    const orderChanged = !idsEqual(nextItems.map(getId), sourceItems.map(getId));
    autoScrollContainerRef.current = null;
    if (orderChanged) {
      pendingDropOrderRef.current = nextItems.map(getId);
      try {
        onReorder(nextItems);
        return;
      } catch (error) {
        pendingDropOrderRef.current = null;
        flushSync(() => setCurrentDragState(null));
        throw error;
      }
    }
    flushSync(() => {
      setCurrentDragState(null);
    });
  }

  function renderRow(item: TItem, renderIndex: number) {
    const id = getId(item);
    const isDragging = id === draggingId;
    const dragHandleProps = {
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => startDrag(item, renderIndex, event),
    };
    const style = dragState ? {
      opacity: isDragging ? 0 : 1,
      pointerEvents: isDragging ? "none" : undefined,
      willChange: isDragging ? undefined : "transform",
    } satisfies CSSProperties : undefined;
    return (
      <div
        key={id}
        data-draggable-list-id={id}
        data-draggable-list-item="true"
        className={cn("draggable-list__item", itemClassName?.(item, { isDragging }))}
        style={style}
      >
        {renderItem(item, { isDragging, dragHandleProps })}
      </div>
    );
  }

  return (
    <>
      <div ref={listRef} className={cn("draggable-list", className)}>
        {items.length ? items.map((item, index) => renderRow(item, index)) : empty}
      </div>
      {dragState ? createPortal(
        <div
          className="draggable-list__overlay"
          ref={overlayRef}
          style={{
            left: dragState.rect.left,
            top: 0,
            width: dragState.rect.width,
            transform: `translate3d(0, ${dragState.pointerY - dragState.pointerOffsetY}px, 0)`,
          }}
          aria-hidden="true"
        >
          {renderItem(dragState.item, { isDragging: true, dragHandleProps: emptyHandleProps() })}
        </div>,
        document.body,
      ) : null}
    </>
  );
}
