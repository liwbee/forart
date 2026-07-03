import { Cloud, Home, Layers, X } from "lucide-react";
import { PointerEvent, useRef, useState } from "react";
import type { TFunction } from "i18next";
import type { CanvasDocumentTab } from "./canvasTabs";

interface CanvasTabsBarProps {
  tabs: CanvasDocumentTab[];
  activeCanvasId: string;
  activeRemoteCanvasId?: string;
  showHome: boolean;
  onOpenHome: () => void;
  onOpenCanvas: (tab: CanvasDocumentTab) => void;
  onCloseCanvas: (tab: CanvasDocumentTab) => void;
  onReorderCanvas: (draggedCanvasId: string, targetIndex: number) => void;
  t: TFunction;
}

interface DragState {
  canvasId: string;
  pointerId: number;
  startClientX: number;
  currentClientX: number;
  startLeft: number;
  sourceIndex: number;
  targetIndex: number;
  tabWidth: number;
  hasMoved: boolean;
}

const DRAG_THRESHOLD = 4;

function getTargetIndex(draggedCenter: number, draggedCanvasId: string, tabs: CanvasDocumentTab[], tabElements: Map<string, HTMLElement>) {
  const otherTabs: Array<{ id: string; element: HTMLElement }> = [];
  tabs.forEach((tab) => {
    if (tab.id === draggedCanvasId) return;
    const element = tabElements.get(tab.id);
    if (element) otherTabs.push({ id: tab.id, element });
  });
  for (let index = 0; index < otherTabs.length; index += 1) {
    const item = otherTabs[index];
    const rect = item.element.getBoundingClientRect();
    if (draggedCenter < rect.left + rect.width / 2) return index;
  }
  return otherTabs.length;
}

export function CanvasTabsBar({
  tabs,
  activeCanvasId,
  activeRemoteCanvasId = "",
  showHome,
  onOpenHome,
  onOpenCanvas,
  onCloseCanvas,
  onReorderCanvas,
  t,
}: CanvasTabsBarProps) {
  const homeLabel = "Home";
  const tabRefs = useRef(new Map<string, HTMLDivElement>());
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [isReleasingDrag, setIsReleasingDrag] = useState(false);

  function startTabDrag(event: PointerEvent<HTMLDivElement>, tab: CanvasDocumentTab, index: number) {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest(".ic-canvas-tab__close")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    setDragState({
      canvasId: tab.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      currentClientX: event.clientX,
      startLeft: rect.left,
      sourceIndex: index,
      targetIndex: index,
      tabWidth: rect.width,
      hasMoved: false,
    });
  }

  function moveTabDrag(event: PointerEvent<HTMLDivElement>) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const deltaX = event.clientX - dragState.startClientX;
    const hasMoved = dragState.hasMoved || Math.abs(deltaX) >= DRAG_THRESHOLD;
    const draggedCenter = dragState.startLeft + deltaX + dragState.tabWidth / 2;
    const targetIndex = getTargetIndex(draggedCenter, dragState.canvasId, tabs, tabRefs.current);
    setDragState({
      ...dragState,
      currentClientX: event.clientX,
      targetIndex,
      hasMoved,
    });
  }

  function finishTabDrag(event: PointerEvent<HTMLDivElement>, tab: CanvasDocumentTab) {
    if (!dragState || event.pointerId !== dragState.pointerId || dragState.canvasId !== tab.id) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const shouldOpen = !dragState.hasMoved;
    const targetIndex = dragState.targetIndex;
    if (shouldOpen) {
      setDragState(null);
      onOpenCanvas(tab);
      return;
    }
    setIsReleasingDrag(true);
    setDragState(null);
    onReorderCanvas(tab.id, targetIndex);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setIsReleasingDrag(false));
    });
  }

  function cancelTabDrag(event: PointerEvent<HTMLDivElement>) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    setDragState(null);
  }

  function getTabDragStyle(tab: CanvasDocumentTab) {
    if (!dragState) return undefined;
    if (dragState.canvasId === tab.id) {
      return {
        transform: `translateX(${dragState.currentClientX - dragState.startClientX}px)`,
        zIndex: 5,
      };
    }
    const index = tabs.findIndex((item) => item.id === tab.id);
    const movingRight = dragState.targetIndex > dragState.sourceIndex;
    const movingLeft = dragState.targetIndex < dragState.sourceIndex;
    if (movingRight && index > dragState.sourceIndex && index <= dragState.targetIndex) {
      return { transform: `translateX(${-dragState.tabWidth}px)` };
    }
    if (movingLeft && index >= dragState.targetIndex && index < dragState.sourceIndex) {
      return { transform: `translateX(${dragState.tabWidth}px)` };
    }
    return undefined;
  }

  return (
    <div className="ic-tabs-bar nodrag" role="tablist" aria-label={t("infiniteCanvas:title")}>
      <button
        className={`ic-canvas-tab ic-canvas-tab--home${showHome ? " active" : ""}`}
        type="button"
        role="tab"
        aria-selected={showHome}
        title={homeLabel}
        onClick={onOpenHome}
      >
        <Home size={15} aria-hidden="true" />
        <span>{homeLabel}</span>
      </button>
      <div className={`ic-canvas-tabs-strip${dragState ? " is-reordering" : ""}${isReleasingDrag ? " is-releasing" : ""}`}>
        {tabs.map((tab, index) => {
          const title = tab.title || t("infiniteCanvas:untitledCanvas");
          const isRemote = tab.source === "remote";
          const isActive = !showHome && (isRemote ? tab.id === activeRemoteCanvasId : tab.id === activeCanvasId);
          const isDragging = dragState?.canvasId === tab.id;
          const TabIcon = isRemote ? Cloud : Layers;
          return (
            <div
              key={tab.id}
              ref={(element) => {
                if (element) tabRefs.current.set(tab.id, element);
                else tabRefs.current.delete(tab.id);
              }}
              data-canvas-id={tab.id}
              className={`ic-canvas-tab${isActive ? " active" : ""}${isDragging ? " is-dragging" : ""}`}
              title={title}
              style={getTabDragStyle(tab)}
              onPointerDown={(event) => startTabDrag(event, tab, index)}
              onPointerMove={moveTabDrag}
              onPointerUp={(event) => finishTabDrag(event, tab)}
              onPointerCancel={cancelTabDrag}
            >
              <button
                className="ic-canvas-tab__main"
                type="button"
                role="tab"
                aria-selected={isActive}
                tabIndex={-1}
              >
                <TabIcon size={15} aria-hidden="true" />
                <span>{title}</span>
              </button>
              <button
                className="ic-canvas-tab__close"
                type="button"
                aria-label={`${t("common:actions.close")}: ${title}`}
                title={t("common:actions.close")}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => onCloseCanvas(tab)}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
