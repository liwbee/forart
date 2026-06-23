import { ListFilter } from "lucide-react";
import { ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface LibraryFilterTag {
  id: string;
  name: string;
}

interface LibraryTagFilterButtonProps {
  tags: LibraryFilterTag[];
  activeTagId: string;
  allLabel: string;
  ariaLabel: string;
  onChange: (tagId: string) => void;
  className?: string;
  active?: boolean;
  menuContentBefore?: ReactNode;
}

function joinClassNames(...classNames: Array<string | false | undefined>) {
  return classNames.filter(Boolean).join(" ");
}

export function LibraryTagFilterButton({ tags, activeTagId, allLabel, ariaLabel, onChange, className, active, menuContentBefore }: LibraryTagFilterButtonProps) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState({ left: 0, top: 0, width: 320, maxHeight: 280 });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const activeTag = tags.find((tag) => tag.id === activeTagId) || null;

  function updateMenuPosition() {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth || 0;
    const viewportHeight = window.innerHeight || 0;
    const width = Math.min(360, Math.max(280, Math.min(viewportWidth - 20, rect.width + 282)));
    const left = Math.min(Math.max(10, rect.right - width), Math.max(10, viewportWidth - width - 10));
    const below = viewportHeight - rect.bottom - 10;
    const above = rect.top - 10;
    const openUp = below < 180 && above > below;
    const maxHeight = Math.max(140, Math.min(280, openUp ? above : below));
    setMenuStyle({
      left,
      top: openUp ? Math.max(10, rect.top - maxHeight - 7) : rect.bottom + 7,
      width,
      maxHeight,
    });
  }

  useEffect(() => {
    if (!open) return;
    updateMenuPosition();
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target && (triggerRef.current?.contains(target) || menuRef.current?.contains(target))) return;
      setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open]);

  const menu = open && typeof document !== "undefined" ? createPortal(
    <div
      ref={menuRef}
      className="library-tag-filter-menu"
      role="menu"
      aria-label={ariaLabel}
      style={menuStyle}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {menuContentBefore}
      <button
        type="button"
        role="menuitemradio"
        aria-checked={!activeTagId}
        className={!activeTagId ? "active" : ""}
        onClick={() => {
          onChange("");
          setOpen(false);
        }}
      >
        {allLabel}
      </button>
      {tags.map((tag) => (
        <button
          key={tag.id}
          type="button"
          role="menuitemradio"
          aria-checked={activeTagId === tag.id}
          className={activeTagId === tag.id ? "active" : ""}
          onClick={() => {
            onChange(tag.id);
            setOpen(false);
          }}
        >
          {tag.name}
        </button>
      ))}
      {!tags.length ? <div className="library-tag-filter-menu__empty">{allLabel}</div> : null}
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={joinClassNames("library-tag-filter-trigger", (active ?? Boolean(activeTagId)) && "active", className)}
        aria-label={activeTag ? `${ariaLabel}: ${activeTag.name}` : ariaLabel}
        title={activeTag ? activeTag.name : ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-pressed={active ?? Boolean(activeTagId)}
        onClick={() => setOpen((current) => !current)}
      >
        <ListFilter size={17} aria-hidden="true" />
      </button>
      {menu}
    </>
  );
}
