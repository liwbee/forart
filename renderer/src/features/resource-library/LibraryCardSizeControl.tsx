import { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDownAZ, ArrowUpAZ, CalendarArrowDown, CalendarArrowUp } from "lucide-react";

export type LibraryCardSizeKey = "model" | "outfit" | "action";
export type LibrarySortField = "name" | "created_at";
export type LibrarySortDirection = "asc" | "desc";

export type LibrarySortableItem = {
  name?: string | null;
  created_at?: string | null;
};

export type LibrarySortState = {
  field: LibrarySortField;
  direction: LibrarySortDirection;
};

const CARD_SIZE_PRESETS = [
  { id: "xs", label: "XS", width: 150 },
  { id: "s", label: "S", width: 180 },
  { id: "m", label: "M", width: 220 },
  { id: "l", label: "L", width: 260 },
  { id: "xl", label: "XL", width: 300 },
] as const;

const DEFAULT_PRESET_ID = "m";
const STORAGE_KEY = "forart.libraryCardSize";
const SORT_STORAGE_KEY = "forart.librarySort";
const SORT_CHANGE_EVENT = "forart-library-sort-change";
const DEFAULT_SORT_STATE: LibrarySortState = { field: "name", direction: "asc" };

type CardSizePresetId = (typeof CARD_SIZE_PRESETS)[number]["id"];

function isPresetId(value: string): value is CardSizePresetId {
  return CARD_SIZE_PRESETS.some((preset) => preset.id === value);
}

function loadPresetId(): CardSizePresetId {
  if (typeof window === "undefined") return DEFAULT_PRESET_ID;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY) || "";
    return isPresetId(stored) ? stored : DEFAULT_PRESET_ID;
  } catch {
    return DEFAULT_PRESET_ID;
  }
}

function savePresetId(presetId: CardSizePresetId) {
  try {
    window.localStorage.setItem(STORAGE_KEY, presetId);
  } catch {
    // UI preference only; ignore storage failures.
  }
}

function isSortField(value: string): value is LibrarySortField {
  return value === "name" || value === "created_at";
}

function isSortDirection(value: string): value is LibrarySortDirection {
  return value === "asc" || value === "desc";
}

function loadSortState(): LibrarySortState {
  if (typeof window === "undefined") return DEFAULT_SORT_STATE;
  try {
    const stored = window.localStorage.getItem(SORT_STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) as Partial<LibrarySortState> : {};
    const field = String(parsed.field || "");
    const direction = String(parsed.direction || "");
    return {
      field: isSortField(field) ? field : DEFAULT_SORT_STATE.field,
      direction: isSortDirection(direction) ? direction : DEFAULT_SORT_STATE.direction,
    };
  } catch {
    return DEFAULT_SORT_STATE;
  }
}

function saveSortState(sortState: LibrarySortState) {
  try {
    window.localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(sortState));
  } catch {
    // UI preference only; ignore storage failures.
  }
}

export function useLibraryCardSize(_libraryKey: LibraryCardSizeKey) {
  const [presetId, setPresetIdState] = useState<CardSizePresetId>(loadPresetId);
  const preset = CARD_SIZE_PRESETS.find((item) => item.id === presetId) || CARD_SIZE_PRESETS[2];

  const setPresetId = useCallback((nextPresetId: CardSizePresetId) => {
    setPresetIdState(nextPresetId);
    savePresetId(nextPresetId);
  }, []);

  const gridStyle = useMemo(() => ({
    "--library-card-width": `${preset.width}px`,
  }) as CSSProperties, [preset.width]);

  return {
    activePresetId: preset.id,
    activePresetIndex: CARD_SIZE_PRESETS.findIndex((item) => item.id === preset.id),
    activePresetLabel: preset.label,
    gridStyle,
    presets: CARD_SIZE_PRESETS,
    setPresetId,
  };
}

export function useLibrarySort() {
  const [sortState, setSortState] = useState<LibrarySortState>(loadSortState);

  const setField = useCallback((field: LibrarySortField) => {
    setSortState((current) => {
      const next = { ...current, field };
      saveSortState(next);
      window.dispatchEvent(new CustomEvent(SORT_CHANGE_EVENT, { detail: next }));
      return next;
    });
  }, []);

  const setDirection = useCallback((direction: LibrarySortDirection) => {
    setSortState((current) => {
      const next = { ...current, direction };
      saveSortState(next);
      window.dispatchEvent(new CustomEvent(SORT_CHANGE_EVENT, { detail: next }));
      return next;
    });
  }, []);

  useEffect(() => {
    function handleSortChange(event: Event) {
      const detail = (event as CustomEvent<Partial<LibrarySortState>>).detail || {};
      const field = String(detail.field || "");
      const direction = String(detail.direction || "");
      if (!isSortField(field) || !isSortDirection(direction)) return;
      setSortState({ field, direction });
    }

    window.addEventListener(SORT_CHANGE_EVENT, handleSortChange);
    return () => window.removeEventListener(SORT_CHANGE_EVENT, handleSortChange);
  }, []);

  return {
    sortField: sortState.field,
    sortDirection: sortState.direction,
    setSortField: setField,
    setSortDirection: setDirection,
  };
}

export function sortLibraryItems<T extends LibrarySortableItem>(items: T[], sortState: LibrarySortState) {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const multiplier = sortState.direction === "asc" ? 1 : -1;
      if (sortState.field === "created_at") {
        const leftTime = Date.parse(left.item.created_at || "");
        const rightTime = Date.parse(right.item.created_at || "");
        const timeOrder = (Number.isFinite(leftTime) ? leftTime : 0) - (Number.isFinite(rightTime) ? rightTime : 0);
        if (timeOrder) return timeOrder * multiplier;
      }

      const leftName = (left.item.name || "").trim();
      const rightName = (right.item.name || "").trim();
      const nameOrder = leftName.localeCompare(rightName, "zh-Hans-CN", {
        numeric: true,
        sensitivity: "base",
      });
      return nameOrder * multiplier || left.index - right.index;
    })
    .map(({ item }) => item);
}

export function LibraryCardSizeControl({
  activePresetId,
  activePresetIndex,
  activePresetLabel,
  presets,
  onSelectPreset,
}: {
  activePresetId: CardSizePresetId;
  activePresetIndex: number;
  activePresetLabel: string;
  presets: typeof CARD_SIZE_PRESETS;
  onSelectPreset: (presetId: CardSizePresetId) => void;
}) {
  const { t } = useTranslation();
  const safeIndex = Math.max(0, Math.min(presets.length - 1, activePresetIndex));

  return (
    <div className="library-card-size-control" role="group" aria-label={t("common:labels.cardSize")}>
      <span className="library-card-size-value">{activePresetLabel}</span>
      <input
        type="range"
        min={0}
        max={presets.length - 1}
        step={1}
        value={safeIndex}
        aria-label={t("common:labels.cardSize")}
        aria-valuetext={activePresetLabel}
        onChange={(event) => onSelectPreset(presets[Number(event.target.value)]?.id || activePresetId)}
      />
    </div>
  );
}

export function LibraryCardToolbar({
  activePresetId,
  activePresetIndex,
  activePresetLabel,
  presets,
  sortField,
  sortDirection,
  onSelectPreset,
  onSelectSortField,
  onSelectSortDirection,
}: {
  activePresetId: CardSizePresetId;
  activePresetIndex: number;
  activePresetLabel: string;
  presets: typeof CARD_SIZE_PRESETS;
  sortField: LibrarySortField;
  sortDirection: LibrarySortDirection;
  onSelectPreset: (presetId: CardSizePresetId) => void;
  onSelectSortField: (field: LibrarySortField) => void;
  onSelectSortDirection: (direction: LibrarySortDirection) => void;
}) {
  const { t } = useTranslation();
  const sortControlRef = useRef<HTMLDivElement | null>(null);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const sortOptions: Array<{
    field: LibrarySortField;
    direction: LibrarySortDirection;
    label: string;
    Icon: typeof ArrowUpAZ;
  }> = [
    { field: "name", direction: "asc", label: `${t("common:labels.name")} ${t("common:labels.ascending")}`, Icon: ArrowUpAZ },
    { field: "name", direction: "desc", label: `${t("common:labels.name")} ${t("common:labels.descending")}`, Icon: ArrowDownAZ },
    { field: "created_at", direction: "asc", label: `${t("common:labels.createdAt")} ${t("common:labels.ascending")}`, Icon: CalendarArrowUp },
    { field: "created_at", direction: "desc", label: `${t("common:labels.createdAt")} ${t("common:labels.descending")}`, Icon: CalendarArrowDown },
  ];
  const activeSortOption = sortOptions.find((option) => option.field === sortField && option.direction === sortDirection) || sortOptions[0];
  const ActiveSortIcon = activeSortOption.Icon;

  function selectSort(field: LibrarySortField, direction: LibrarySortDirection) {
    onSelectSortField(field);
    onSelectSortDirection(direction);
    setSortMenuOpen(false);
  }

  useEffect(() => {
    if (!sortMenuOpen) return undefined;
    function closeSortMenu(event: globalThis.PointerEvent) {
      if (sortControlRef.current?.contains(event.target as Node)) return;
      setSortMenuOpen(false);
    }
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setSortMenuOpen(false);
    }
    window.addEventListener("pointerdown", closeSortMenu);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", closeSortMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [sortMenuOpen]);

  return (
    <div className="library-card-toolbar" role="group" aria-label={t("common:labels.libraryViewOptions")}>
      <div ref={sortControlRef} className="library-card-sort-control">
        <button
          className={`library-card-sort-trigger${sortMenuOpen ? " active" : ""}`}
          type="button"
          aria-label={t("common:labels.sort")}
          aria-expanded={sortMenuOpen}
          title={activeSortOption.label}
          onClick={() => setSortMenuOpen((open) => !open)}
        >
          <ActiveSortIcon size={17} aria-hidden="true" />
          <span>{activeSortOption.label}</span>
        </button>
        {sortMenuOpen ? (
          <div className="library-card-sort-menu" role="menu" aria-label={t("common:labels.sort")}>
            {sortOptions.map(({ field, direction, label, Icon }) => {
              const active = sortField === field && sortDirection === direction;
              return (
                <button
                  key={`${field}-${direction}`}
                  className={active ? "active" : ""}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => selectSort(field, direction)}
                >
                  <Icon size={16} aria-hidden="true" />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      <LibraryCardSizeControl
        activePresetId={activePresetId}
        activePresetIndex={activePresetIndex}
        activePresetLabel={activePresetLabel}
        presets={presets}
        onSelectPreset={onSelectPreset}
      />
    </div>
  );
}
