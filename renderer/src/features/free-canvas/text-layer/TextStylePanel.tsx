import type { CSSProperties } from "react";
import type { FreeCanvasTextItem } from "../types";

export const TEXT_COLOR_SWATCHES = [
  "#111827",
  "#ffffff",
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
] as const;

interface FontSizePanelProps {
  item: FreeCanvasTextItem;
  fontSizeLabel: string;
  onFontSizeChange: (fontSize: number) => void;
}

interface TextColorPanelProps {
  item: FreeCanvasTextItem;
  textColorLabel: string;
  onColorChange: (color: string) => void;
}

export function FontSizePanel({
  item,
  fontSizeLabel,
  onFontSizeChange,
}: FontSizePanelProps) {
  return (
    <div className="free-canvas-editor__tool-panel" onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
      <label className="free-canvas-editor__field">
        <span>
          {fontSizeLabel}
          <strong>{Math.round(item.fontSize)}</strong>
        </span>
        <input
          type="range"
          min="18"
          max="180"
          value={item.fontSize}
          onChange={(event) => onFontSizeChange(Number(event.target.value))}
        />
      </label>
    </div>
  );
}

export function TextColorPanel({
  item,
  textColorLabel,
  onColorChange,
}: TextColorPanelProps) {
  return (
    <div className="free-canvas-editor__tool-panel free-canvas-editor__color-panel" onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
      <div className="free-canvas-editor__field">
        <span>{textColorLabel}</span>
        <div className="free-canvas-editor__color-grid">
          {TEXT_COLOR_SWATCHES.map((color) => (
            <button
              key={color}
              type="button"
              className={item.color.toLowerCase() === color.toLowerCase() ? "active" : ""}
              aria-label={`${textColorLabel} ${color}`}
              title={color}
              style={{ "--free-canvas-text-color": color } as CSSProperties}
              onClick={() => onColorChange(color)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
