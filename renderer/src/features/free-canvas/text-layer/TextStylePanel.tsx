import type { CSSProperties } from "react";
import { PopoverContent } from "../../../components/ui/popover";
import { Slider } from "../../../components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "../../../components/ui/toggle-group";
import type { FreeCanvasTextItem } from "../types";

const TEXT_COLOR_SWATCHES = [
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
    <PopoverContent
      className="free-canvas-editor__tool-panel"
      side="top"
      sideOffset={12}
      collisionPadding={16}
      onOpenAutoFocus={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <label className="free-canvas-editor__field">
        <span>
          {fontSizeLabel}
          <strong>{Math.round(item.fontSize)}</strong>
        </span>
        <Slider
          aria-label={fontSizeLabel}
          min={18}
          max={180}
          step={1}
          value={[item.fontSize]}
          onValueChange={(values) => onFontSizeChange(values[0])}
        />
      </label>
    </PopoverContent>
  );
}

export function TextColorPanel({
  item,
  textColorLabel,
  onColorChange,
}: TextColorPanelProps) {
  return (
    <PopoverContent
      className="free-canvas-editor__tool-panel free-canvas-editor__color-panel"
      side="top"
      sideOffset={12}
      collisionPadding={16}
      onOpenAutoFocus={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="free-canvas-editor__field">
        <span>{textColorLabel}</span>
        <ToggleGroup
          className="free-canvas-editor__color-grid"
          type="single"
          variant="outline"
          size="sm"
          spacing={8}
          value={item.color.toLowerCase()}
          aria-label={textColorLabel}
          onValueChange={(color) => {
            if (color) onColorChange(color);
          }}
        >
          {TEXT_COLOR_SWATCHES.map((color) => (
            <ToggleGroupItem
              key={color}
              className="free-canvas-editor__color-swatch"
              value={color}
              aria-label={`${textColorLabel} ${color}`}
              title={color}
              style={{ "--free-canvas-text-color": color } as CSSProperties}
            />
          ))}
        </ToggleGroup>
      </div>
    </PopoverContent>
  );
}
