import { Ban, ListFilter } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createLibraryTagFilter, type LibraryTagFilter } from "./filter";

export interface LibraryFilterTag {
  id: string;
  name: string;
}

interface LibraryTagFilterButtonProps {
  tags: LibraryFilterTag[];
  tagFilter: LibraryTagFilter;
  tagCounts?: Record<string, number>;
  allLabel: string;
  ariaLabel: string;
  onChange: (tagFilter: LibraryTagFilter) => void;
  className?: string;
  active?: boolean;
  menuContentBefore?: ReactNode;
}

function joinClassNames(...classNames: Array<string | false | undefined>) {
  return classNames.filter(Boolean).join(" ");
}

export function LibraryTagFilterButton({ tags, tagFilter, tagCounts = {}, allLabel, ariaLabel, onChange, className, active, menuContentBefore }: LibraryTagFilterButtonProps) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState({ left: 0, top: 0, width: 320, maxHeight: 280 });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const includeTagSet = new Set(tagFilter.includeTagIds);
  const excludeTagSet = new Set(tagFilter.excludeTagIds);
  const activeTagNames = [
    ...tags.filter((tag) => includeTagSet.has(tag.id)).map((tag) => tag.name),
    ...tags.filter((tag) => excludeTagSet.has(tag.id)).map((tag) => `不含 ${tag.name}`),
  ];

  function toggleIncludeTag(tagId: string) {
    onChange(createLibraryTagFilter(
      includeTagSet.has(tagId) ? tagFilter.includeTagIds.filter((activeTagId) => activeTagId !== tagId) : [...tagFilter.includeTagIds, tagId],
      tagFilter.excludeTagIds.filter((activeTagId) => activeTagId !== tagId),
    ));
  }

  function toggleExcludeTag(tagId: string) {
    onChange(createLibraryTagFilter(
      tagFilter.includeTagIds.filter((activeTagId) => activeTagId !== tagId),
      excludeTagSet.has(tagId) ? tagFilter.excludeTagIds.filter((activeTagId) => activeTagId !== tagId) : [...tagFilter.excludeTagIds, tagId],
    ));
  }

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
        role="menuitemcheckbox"
        aria-checked={!tagFilter.includeTagIds.length && !tagFilter.excludeTagIds.length && !tagFilter.untaggedOnly}
        className={!tagFilter.includeTagIds.length && !tagFilter.excludeTagIds.length && !tagFilter.untaggedOnly ? "active" : ""}
        onClick={() => {
          onChange(createLibraryTagFilter());
        }}
      >
        {allLabel}
      </button>
      {tags.map((tag) => {
        const included = includeTagSet.has(tag.id);
        const excluded = excludeTagSet.has(tag.id);
        return (
          <button
            key={tag.id}
            type="button"
            role="menuitemcheckbox"
            aria-checked={included || excluded}
            className={`library-tag-filter-menu__tag${included ? " library-tag-filter-menu__tag--include" : ""}${excluded ? " library-tag-filter-menu__tag--exclude" : ""}`}
            onClick={() => {
              toggleIncludeTag(tag.id);
            }}
          >
            <span>{tag.name}</span>
            <span className="library-tag-filter-menu__count">{tagCounts[tag.id] || 0}</span>
            <span
              role="button"
              tabIndex={0}
              className="library-tag-filter-menu__exclude"
              aria-label={`排除 ${tag.name}`}
              title={`排除 ${tag.name}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                toggleExcludeTag(tag.id);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                event.stopPropagation();
                toggleExcludeTag(tag.id);
              }}
            >
              <Ban size={12} aria-hidden="true" />
            </span>
          </button>
        );
      })}
      {!tags.length ? <div className="library-tag-filter-menu__empty">{allLabel}</div> : null}
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={joinClassNames("library-tag-filter-trigger", (active ?? Boolean(tagFilter.includeTagIds.length || tagFilter.excludeTagIds.length || tagFilter.untaggedOnly)) && "active", className)}
        aria-label={activeTagNames.length ? `${ariaLabel}: ${activeTagNames.join(", ")}` : ariaLabel}
        title={activeTagNames.length ? activeTagNames.join(", ") : ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-pressed={active ?? Boolean(tagFilter.includeTagIds.length || tagFilter.excludeTagIds.length || tagFilter.untaggedOnly)}
        onClick={() => setOpen((current) => !current)}
      >
        <ListFilter size={17} aria-hidden="true" />
      </button>
      {menu}
    </>
  );
}
