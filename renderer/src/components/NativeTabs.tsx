import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

export interface NativeTabItem<TValue extends string> {
  value: TValue;
  label: ReactNode;
  icon?: LucideIcon;
  meta?: ReactNode;
}

interface NativeTabsProps<TValue extends string> {
  items: readonly NativeTabItem<TValue>[];
  value: TValue;
  onChange: (value: TValue) => void;
  ariaLabel: string;
  className?: string;
}

export function NativeTabs<TValue extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  className = "",
}: NativeTabsProps<TValue>) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRefs = useRef(new Map<TValue, HTMLButtonElement>());
  const [indicatorStyle, setIndicatorStyle] = useState({ x: 0, y: 0, width: 0, height: 0, ready: false });

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) {
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % items.length;
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + items.length) % items.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = items.length - 1;
    else return;

    event.preventDefault();
    const nextItem = items[nextIndex];
    if (!nextItem) return;
    onChange(nextItem.value);
    buttonRefs.current.get(nextItem.value)?.focus();
  }

  useLayoutEffect(() => {
    const root = rootRef.current;
    const activeButton = buttonRefs.current.get(value);
    if (!root || !activeButton) return;
    const tabsRoot = root;
    const selectedButton = activeButton;

    function updateIndicator() {
      const rootRect = tabsRoot.getBoundingClientRect();
      const buttonRect = selectedButton.getBoundingClientRect();
      setIndicatorStyle({
        x: buttonRect.left - rootRect.left,
        y: buttonRect.top - rootRect.top,
        width: buttonRect.width,
        height: buttonRect.height,
        ready: true,
      });
    }

    updateIndicator();
    const resizeObserver = new ResizeObserver(updateIndicator);
    resizeObserver.observe(tabsRoot);
    resizeObserver.observe(selectedButton);
    window.addEventListener("resize", updateIndicator);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateIndicator);
    };
  }, [items, value]);

  return (
    <div ref={rootRef} className={`native-tabs${className ? ` ${className}` : ""}`} role="tablist" aria-label={ariaLabel} aria-orientation="horizontal">
      <motion.span
        className="native-tabs__indicator"
        aria-hidden="true"
        initial={false}
        animate={{
          x: indicatorStyle.x,
          y: indicatorStyle.y,
          width: indicatorStyle.width,
          height: indicatorStyle.height,
          opacity: indicatorStyle.ready ? 1 : 0,
        }}
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
      />
      {items.map((item, index) => {
        const active = item.value === value;
        const Icon = item.icon;
        return (
          <Button
            key={item.value}
            ref={(node) => {
              if (node) buttonRefs.current.set(item.value, node);
              else buttonRefs.current.delete(item.value);
            }}
            type="button"
            variant="ghost"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            className={active ? "active" : ""}
            onClick={() => onChange(item.value)}
            onKeyDown={(event) => moveFocus(event, index)}
          >
            {Icon ? <Icon aria-hidden="true" /> : null}
            <span className="native-tabs__label">{item.label}</span>
            {item.meta !== undefined ? <small>{item.meta}</small> : null}
          </Button>
        );
      })}
    </div>
  );
}
