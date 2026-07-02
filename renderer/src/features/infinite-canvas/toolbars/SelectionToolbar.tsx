import { Layers } from "lucide-react";
import { memo } from "react";
import type { useTranslation } from "react-i18next";
import type { Viewport } from "../types";

export interface SelectionToolbarBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SelectionToolbarProps {
  bounds: SelectionToolbarBounds | null;
  selectedCount: number;
  stageSize: { width: number; height: number };
  viewport: Viewport;
  isHidden: boolean;
  onCreateGroup: () => void;
  t: ReturnType<typeof useTranslation>["t"];
}

export const SelectionToolbar = memo(function SelectionToolbar({
  bounds,
  selectedCount,
  stageSize,
  viewport,
  isHidden,
  onCreateGroup,
  t,
}: SelectionToolbarProps) {
  if (!bounds || selectedCount < 2 || isHidden) return null;
  const left = stageSize.width / 2 + (bounds.x + bounds.width / 2) * viewport.scale + viewport.x;
  const top = stageSize.height / 2 + bounds.y * viewport.scale + viewport.y;
  return (
    <div
      className="ic-selection-toolbar nodrag"
      style={{
        left,
        top,
      }}
      role="toolbar"
      aria-label={t("infiniteCanvas:selectionActions")}
    >
      <span>{t("infiniteCanvas:selectedCount", { count: selectedCount })}</span>
      <button type="button" onClick={onCreateGroup}>
        <Layers size={14} aria-hidden="true" />
        <span>{t("infiniteCanvas:groupSelection")}</span>
      </button>
    </div>
  );
});
