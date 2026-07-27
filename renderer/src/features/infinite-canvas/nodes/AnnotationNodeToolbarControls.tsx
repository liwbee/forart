import { AlignCenter, AlignLeft, AlignRight, Bold, Palette } from "lucide-react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { AppSelect } from "../../../components/AppSelect";
import { Button } from "../../../components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import { Separator } from "../../../components/ui/separator";
import { Toggle } from "../../../components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "../../../components/ui/toggle-group";
import { useNativeCanvasActions } from "../canvasActions";
import type { NativeCanvasAnnotationStyle } from "../nativeCanvas";
import { resolveAnnotationStyle } from "./annotationStyle";

const FONT_SIZE_OPTIONS = [12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64, 72, 96]
  .map((fontSize) => ({ value: String(fontSize), label: String(fontSize) }));

const COLOR_OPTIONS = [
  { value: "theme", color: "var(--text-primary)" },
  { value: "#ffffff", color: "#ffffff" },
  { value: "#ef4444", color: "#ef4444" },
  { value: "#f97316", color: "#f97316" },
  { value: "#f59e0b", color: "#f59e0b" },
  { value: "#22c55e", color: "#22c55e" },
  { value: "#06b6d4", color: "#06b6d4" },
  { value: "#3b82f6", color: "#3b82f6" },
  { value: "#8b5cf6", color: "#8b5cf6" },
  { value: "#ec4899", color: "#ec4899" },
] as const;

interface AnnotationNodeToolbarControlsProps {
  nodeId: string;
  style?: NativeCanvasAnnotationStyle;
}

export function AnnotationNodeToolbarControls({ nodeId, style }: AnnotationNodeToolbarControlsProps) {
  const { t } = useTranslation();
  const actions = useNativeCanvasActions();
  const resolved = resolveAnnotationStyle(style);
  const selectedColor = style?.color || "theme";
  const patchStyle = (patch: Partial<NativeCanvasAnnotationStyle>) => {
    actions.patchNodeData(nodeId, {
      annotationStyle: { ...style, ...patch },
    });
  };

  return (
    <div className="rf-native-annotation-toolbar nodrag nopan nowheel">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="rf-native-annotation-color-trigger"
            aria-label={t("infiniteCanvas:annotationTextColor")}
            title={t("infiniteCanvas:annotationTextColor")}
          >
            <Palette aria-hidden="true" />
            <span style={{ "--annotation-color": resolved.color || "var(--text-primary)" } as CSSProperties} />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="rf-native-annotation-color-panel"
          side="top"
          sideOffset={8}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <ToggleGroup
            type="single"
            value={selectedColor}
            className="rf-native-annotation-color-grid"
            aria-label={t("infiniteCanvas:annotationTextColor")}
            onValueChange={(color) => {
              if (color) patchStyle({ color: color === "theme" ? undefined : color });
            }}
          >
            {COLOR_OPTIONS.map((option) => (
              <ToggleGroupItem
                key={option.value}
                value={option.value}
                className="rf-native-annotation-color-swatch"
                aria-label={option.value === "theme" ? t("infiniteCanvas:annotationThemeColor") : option.color}
                title={option.value === "theme" ? t("infiniteCanvas:annotationThemeColor") : option.color}
                style={{ "--annotation-color": option.color } as CSSProperties}
              >
                <span aria-hidden="true" />
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </PopoverContent>
      </Popover>

      <AppSelect
        className="rf-native-annotation-font-size"
        value={String(resolved.fontSize)}
        options={FONT_SIZE_OPTIONS}
        ariaLabel={t("infiniteCanvas:annotationFontSize")}
        menuPlacement="top"
        size="sm"
        variant="ghost"
        onChange={(fontSize) => patchStyle({ fontSize: Number(fontSize) })}
      />

      <Separator orientation="vertical" className="rf-native-annotation-toolbar-separator" />

      <Toggle
        pressed={resolved.bold}
        size="sm"
        aria-label={t("infiniteCanvas:annotationBold")}
        title={t("infiniteCanvas:annotationBold")}
        onPressedChange={(bold) => patchStyle({ bold })}
      >
        <Bold aria-hidden="true" />
      </Toggle>

      <Separator orientation="vertical" className="rf-native-annotation-toolbar-separator" />

      <ToggleGroup
        type="single"
        value={resolved.textAlign}
        size="sm"
        spacing={0}
        aria-label={t("infiniteCanvas:annotationAlignment")}
        onValueChange={(textAlign) => {
          if (textAlign === "left" || textAlign === "center" || textAlign === "right") patchStyle({ textAlign });
        }}
      >
        <ToggleGroupItem value="left" aria-label={t("infiniteCanvas:annotationAlignLeft")} title={t("infiniteCanvas:annotationAlignLeft")}>
          <AlignLeft aria-hidden="true" />
        </ToggleGroupItem>
        <ToggleGroupItem value="center" aria-label={t("infiniteCanvas:annotationAlignCenter")} title={t("infiniteCanvas:annotationAlignCenter")}>
          <AlignCenter aria-hidden="true" />
        </ToggleGroupItem>
        <ToggleGroupItem value="right" aria-label={t("infiniteCanvas:annotationAlignRight")} title={t("infiniteCanvas:annotationAlignRight")}>
          <AlignRight aria-hidden="true" />
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}
