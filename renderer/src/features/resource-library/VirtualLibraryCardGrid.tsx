import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

type VirtualGridCell<TItem> =
  | { key: string; kind: "leading" }
  | { key: string; kind: "item"; item: TItem; index: number };

interface VirtualLibraryCardGridProps<TItem> {
  items: TItem[];
  getItemKey: (item: TItem) => string;
  renderItem: (item: TItem, index: number) => ReactNode;
  renderLeadingItem?: () => ReactNode;
  style?: CSSProperties;
  itemAspectRatio?: number;
}

const DEFAULT_CARD_WIDTH = 220;
const DEFAULT_GRID_GAP = 20;

function findScrollParent(element: HTMLElement | null) {
  let parent = element?.parentElement || null;
  while (parent && parent !== document.body) {
    const styles = window.getComputedStyle(parent);
    if (/(auto|scroll|overlay)/.test(styles.overflowY)) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return null;
}

function readSpaceValue(name: string, fallback: number) {
  const root = window.getComputedStyle(document.documentElement).getPropertyValue(name);
  const value = Number.parseFloat(root);
  return Number.isFinite(value) ? value : fallback;
}

export function VirtualLibraryCardGrid<TItem>({
  items,
  getItemKey,
  renderItem,
  renderLeadingItem,
  style,
  itemAspectRatio = 1,
}: VirtualLibraryCardGridProps<TItem>) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  const [layout, setLayout] = useState({
    columnCount: 1,
    rowHeight: DEFAULT_CARD_WIDTH * itemAspectRatio,
    rowSize: DEFAULT_CARD_WIDTH * itemAspectRatio + DEFAULT_GRID_GAP,
  });

  const cells = useMemo<Array<VirtualGridCell<TItem>>>(() => {
    const nextCells: Array<VirtualGridCell<TItem>> = renderLeadingItem ? [{ key: "__library-leading-card", kind: "leading" }] : [];
    items.forEach((item, index) => {
      nextCells.push({ key: getItemKey(item), kind: "item", item, index });
    });
    return nextCells;
  }, [getItemKey, items, renderLeadingItem]);

  const rows = useMemo(() => {
    const nextRows: Array<Array<VirtualGridCell<TItem>>> = [];
    for (let index = 0; index < cells.length; index += layout.columnCount) {
      nextRows.push(cells.slice(index, index + layout.columnCount));
    }
    return nextRows;
  }, [cells, layout.columnCount]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => layout.rowSize,
    overscan: 4,
  });

  useEffect(() => {
    const gridElement = rootRef.current;
    if (!gridElement) return undefined;
    const measuredElement: HTMLDivElement = gridElement;

    setScrollElement(findScrollParent(measuredElement));

    function updateLayout() {
      const width = measuredElement.clientWidth;
      if (!width) return;
      const styles = window.getComputedStyle(measuredElement);
      const configuredCardWidth = Number.parseFloat(styles.getPropertyValue("--library-card-width")) || DEFAULT_CARD_WIDTH;
      const gap = readSpaceValue("--space-5", DEFAULT_GRID_GAP);
      const minCardWidth = Math.min(width, configuredCardWidth);
      const columnCount = Math.max(1, Math.floor((width + gap) / (minCardWidth + gap)));
      const columnWidth = (width - gap * (columnCount - 1)) / columnCount;
      const rowHeight = columnWidth * itemAspectRatio;
      setLayout({
        columnCount,
        rowHeight,
        rowSize: rowHeight + gap,
      });
    }

    updateLayout();
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateLayout) : null;
    resizeObserver?.observe(measuredElement);
    window.addEventListener("resize", updateLayout);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateLayout);
    };
  }, [itemAspectRatio]);

  useEffect(() => {
    virtualizer.measure();
  }, [layout.rowSize, virtualizer]);

  const virtualRows = virtualizer.getVirtualItems();

  return (
    <div ref={rootRef} className="library-virtual-card-grid" style={style}>
      <div className="library-virtual-card-grid__spacer" style={{ height: virtualizer.getTotalSize() || undefined }}>
        {virtualRows.map((virtualRow) => {
          const row = rows[virtualRow.index];
          if (!row) return null;
          return (
            <div
              key={virtualRow.key}
              className="library-virtual-card-grid__row"
              style={{
                gridTemplateColumns: `repeat(${layout.columnCount}, minmax(0, 1fr))`,
                height: layout.rowHeight,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {row.map((cell) => (
                <div key={cell.key} className="library-virtual-card-grid__cell">
                  {cell.kind === "leading" ? renderLeadingItem?.() : renderItem(cell.item, cell.index)}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
