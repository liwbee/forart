import { Ban, ListFilter } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppScrollArea } from "../../components/AppScrollArea";
import { Button } from "../../components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { createLibraryTagFilter, toggleLibraryTagFilterInclude, type LibraryTagFilter } from "./filter";
import { normalizeLibraryTagColor, type LibraryTagColor } from "./tagColors";

export interface LibraryFilterTag {
  id: string;
  name: string;
  color?: LibraryTagColor | string | null;
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
  sameColorSingleFilter?: boolean;
}

function joinClassNames(...classNames: Array<string | false | undefined>) {
  return classNames.filter(Boolean).join(" ");
}

export function LibraryTagFilterButton({ tags, tagFilter, tagCounts, allLabel, ariaLabel, onChange, className, active, menuContentBefore, sameColorSingleFilter = false }: LibraryTagFilterButtonProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const includeTagSet = new Set(tagFilter.includeTagIds);
  const excludeTagSet = new Set(tagFilter.excludeTagIds);
  const activeTagNames = [
    ...tags.filter((tag) => includeTagSet.has(tag.id)).map((tag) => tag.name),
    ...tags.filter((tag) => excludeTagSet.has(tag.id)).map((tag) => t("common:labels.excludedTag", { name: tag.name })),
  ];

  function toggleIncludeTag(tagId: string) {
    onChange(toggleLibraryTagFilterInclude(tagFilter, tagId, tags, sameColorSingleFilter));
  }

  function toggleExcludeTag(tagId: string) {
    onChange(createLibraryTagFilter(
      tagFilter.includeTagIds.filter((activeTagId) => activeTagId !== tagId),
      excludeTagSet.has(tagId) ? tagFilter.excludeTagIds.filter((activeTagId) => activeTagId !== tagId) : [...tagFilter.excludeTagIds, tagId],
    ));
  }

  const menu = (
    <AppScrollArea className="library-tag-filter-menu__scroll" viewportClassName="library-tag-filter-menu__viewport">
      {menuContentBefore}
      <Button
        type="button"
        variant={!tagFilter.includeTagIds.length && !tagFilter.excludeTagIds.length && !tagFilter.untaggedOnly ? "default" : "ghost"}
        role="menuitemcheckbox"
        aria-checked={!tagFilter.includeTagIds.length && !tagFilter.excludeTagIds.length && !tagFilter.untaggedOnly}
        className={!tagFilter.includeTagIds.length && !tagFilter.excludeTagIds.length && !tagFilter.untaggedOnly ? "active" : ""}
        onClick={() => {
          onChange(createLibraryTagFilter());
        }}
      >
        {allLabel}
      </Button>
      {tags.map((tag) => {
        const included = includeTagSet.has(tag.id);
        const excluded = excludeTagSet.has(tag.id);
        const selected = included || excluded;
        const count = tagCounts?.[tag.id] || 0;
        const disabled = tagCounts !== undefined && count <= 0 && !selected;
        return (
          <div
            key={tag.id}
            className={`library-tag-filter-menu__tag${included ? " library-tag-filter-menu__tag--include" : ""}${excluded ? " library-tag-filter-menu__tag--exclude" : ""}${disabled ? " library-tag-filter-menu__tag--empty" : ""}`}
          >
            <Button
              type="button"
              variant="ghost"
              role="menuitemcheckbox"
              aria-checked={selected}
              className="library-tag-filter-menu__include"
              disabled={disabled}
              onClick={() => toggleIncludeTag(tag.id)}
            >
              <span className={`library-tag-color-dot library-tag-color-dot--${normalizeLibraryTagColor(tag.color)}`} aria-hidden="true" />
              <span>{tag.name}</span>
              <span className="library-tag-filter-menu__count">{count}</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={disabled}
              className="library-tag-filter-menu__exclude"
              aria-label={t("common:labels.excludeTag", { name: tag.name })}
              title={t("common:labels.excludeTag", { name: tag.name })}
              onClick={(event) => {
                event.stopPropagation();
                toggleExcludeTag(tag.id);
              }}
            >
              <Ban aria-hidden="true" />
            </Button>
          </div>
        );
      })}
      {!tags.length ? <div className="library-tag-filter-menu__empty">{allLabel}</div> : null}
    </AppScrollArea>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={joinClassNames("library-tag-filter-trigger", (active ?? Boolean(tagFilter.includeTagIds.length || tagFilter.excludeTagIds.length || tagFilter.untaggedOnly)) && "active", className)}
          aria-label={activeTagNames.length ? `${ariaLabel}: ${activeTagNames.join(", ")}` : ariaLabel}
          title={activeTagNames.length ? activeTagNames.join(", ") : ariaLabel}
          aria-haspopup="menu"
          aria-pressed={active ?? Boolean(tagFilter.includeTagIds.length || tagFilter.excludeTagIds.length || tagFilter.untaggedOnly)}
        >
          <ListFilter aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="library-tag-filter-menu"
        side="bottom"
        sideOffset={7}
        align="end"
        collisionPadding={10}
        role="menu"
        aria-label={ariaLabel}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {menu}
      </PopoverContent>
    </Popover>
  );
}
