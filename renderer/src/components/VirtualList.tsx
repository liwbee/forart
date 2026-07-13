import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode, type Ref, type WheelEvent } from "react";
import { useVirtualizer, type VirtualItem, type Virtualizer } from "@tanstack/react-virtual";
import { AppScrollArea } from "./AppScrollArea";
import { cn } from "../lib/utils";

type VirtualListAxis = "vertical" | "horizontal";
type VirtualListItemMode = "absolute" | "flow";
export type VirtualListController = Virtualizer<HTMLDivElement, Element>;

interface VirtualListProps<TItem> {
  items: TItem[];
  estimateSize: number;
  getItemKey: (item: TItem, index: number) => string | number;
  renderItem: (item: TItem, index: number, virtualItem: VirtualItem) => ReactNode;
  className?: string;
  viewportClassName?: string;
  viewportRef?: Ref<HTMLDivElement>;
  virtualizerRef?: Ref<VirtualListController>;
  spacerClassName?: string;
  trackClassName?: string;
  itemClassName?: string | ((item: TItem, index: number, virtualItem: VirtualItem) => string);
  itemRole?: string;
  empty?: ReactNode;
  axis?: VirtualListAxis;
  overscan?: number;
  measureItems?: boolean;
  itemMode?: VirtualListItemMode;
  scrollbars?: "vertical" | "horizontal" | "both" | "none";
  role?: string;
  ariaLabel?: string;
  onWheel?: (event: WheelEvent<HTMLDivElement>) => void;
}

function assignRef<TValue>(ref: Ref<TValue> | undefined, value: TValue | null) {
  if (!ref) return;
  if (typeof ref === "function") {
    ref(value);
    return;
  }
  (ref as { current: TValue | null }).current = value;
}

export function VirtualList<TItem>({
  items,
  estimateSize,
  getItemKey,
  renderItem,
  className,
  viewportClassName,
  viewportRef,
  virtualizerRef,
  spacerClassName,
  trackClassName,
  itemClassName,
  itemRole,
  empty = null,
  axis = "vertical",
  overscan = 6,
  measureItems = false,
  itemMode = "absolute",
  scrollbars = axis === "horizontal" ? "horizontal" : "vertical",
  role,
  ariaLabel,
  onWheel,
}: VirtualListProps<TItem>) {
  const internalViewportRef = useRef<HTMLDivElement | null>(null);
  const horizontal = axis === "horizontal";
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => internalViewportRef.current,
    estimateSize: () => estimateSize,
    horizontal,
    overscan,
    getItemKey: (index) => {
      const item = items[index];
      return item ? getItemKey(item, index) : index;
    },
    measureElement: measureItems ? (element) => element.getBoundingClientRect()[horizontal ? "width" : "height"] : undefined,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const firstStart = virtualItems[0]?.start || 0;

  useEffect(() => {
    assignRef(virtualizerRef, virtualizer);
    return () => assignRef(virtualizerRef, null);
  }, [virtualizerRef, virtualizer]);

  const viewportRefCallback = useMemo(() => (node: HTMLDivElement | null) => {
    internalViewportRef.current = node;
    assignRef(viewportRef, node);
  }, [viewportRef]);

  function itemClass(item: TItem, index: number, virtualItem: VirtualItem) {
    return typeof itemClassName === "function" ? itemClassName(item, index, virtualItem) : itemClassName;
  }

  const spacerStyle: CSSProperties = horizontal ? { width: totalSize || undefined } : { height: totalSize || undefined };
  const trackStyle: CSSProperties | undefined = itemMode === "flow"
    ? { transform: horizontal ? `translateX(${firstStart}px)` : `translateY(${firstStart}px)` }
    : undefined;

  return (
    <AppScrollArea
      className={className}
      viewportClassName={viewportClassName}
      viewportRef={viewportRefCallback}
      scrollbars={scrollbars}
      role={role}
      aria-label={ariaLabel}
      onWheel={onWheel}
    >
      {items.length ? (
        <div className={spacerClassName} style={spacerStyle}>
          <div className={trackClassName} style={trackStyle}>
            {virtualItems.map((virtualItem) => {
              const item = items[virtualItem.index];
              if (!item) return null;
              const absoluteStyle = itemMode === "absolute"
                ? { transform: horizontal ? `translateX(${virtualItem.start}px)` : `translateY(${virtualItem.start}px)` }
                : undefined;
              return (
                <div
                  key={virtualItem.key}
                  ref={measureItems ? virtualizer.measureElement : undefined}
                  data-index={virtualItem.index}
                  className={cn(itemClass(item, virtualItem.index, virtualItem))}
                  role={itemRole}
                  style={absoluteStyle}
                >
                  {renderItem(item, virtualItem.index, virtualItem)}
                </div>
              );
            })}
          </div>
        </div>
      ) : empty}
    </AppScrollArea>
  );
}
