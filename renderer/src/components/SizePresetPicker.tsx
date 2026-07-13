import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { selectTriggerClassName } from "./ui/select";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";

export interface SizePresetOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
  hint?: string;
}

interface SizePresetPickerLabels {
  trigger: string;
  resolution: string;
  aspectRatio: string;
  imageCount?: string;
  quality?: string;
}

interface SizePresetPickerProps<R extends string, A extends string> {
  open: boolean;
  resolution: R;
  aspectRatio: A;
  resolutionOptions: SizePresetOption<R>[];
  aspectRatioOptions: SizePresetOption<A>[];
  imageCount?: string;
  imageCountOptions?: SizePresetOption[];
  quality?: string;
  qualityOptions?: SizePresetOption[];
  labels: SizePresetPickerLabels;
  className?: string;
  triggerClassName?: string;
  panelClassName?: string;
  aspectRatioClassName?: string;
  panelSide?: "top" | "bottom";
  triggerSize?: "default" | "sm";
  triggerVariant?: "default" | "ghost";
  disabled?: boolean;
  formatTrigger?: (resolution: R, aspectRatio: A, quality?: string) => string;
  renderResolutionLabel?: (option: SizePresetOption<R>) => ReactNode;
  renderAspectRatioLabel?: (option: SizePresetOption<A>) => ReactNode;
  renderImageCountLabel?: (option: SizePresetOption) => ReactNode;
  renderQualityLabel?: (option: SizePresetOption) => ReactNode;
  onOpenChange: (open: boolean) => void;
  onResolutionChange: (value: R) => void;
  onAspectRatioChange: (value: A) => void;
  onImageCountChange?: (value: string) => void;
  onQualityChange?: (value: string) => void;
}

function ratioIconStyle(value: string) {
  if (value === "auto") {
    return {
      width: 18,
      height: 12,
    };
  }
  const [rawW, rawH] = value.split(":").map(Number);
  const w = rawW || 1;
  const h = rawH || 1;
  const isWide = w >= h;
  return {
    width: isWide ? 18 : Math.max(8, Math.round(18 * w / h)),
    height: isWide ? Math.max(8, Math.round(18 * h / w)) : 18,
  };
}

export function SizePresetPicker<R extends string, A extends string>({
  open,
  resolution,
  aspectRatio,
  resolutionOptions,
  aspectRatioOptions,
  imageCount,
  imageCountOptions = [],
  quality,
  qualityOptions = [],
  labels,
  className,
  triggerClassName,
  panelClassName,
  aspectRatioClassName,
  panelSide = "top",
  triggerSize = "default",
  triggerVariant = "default",
  disabled = false,
  formatTrigger = (currentResolution, currentAspectRatio, currentQuality) => (
    [currentResolution.toUpperCase(), currentQuality, currentAspectRatio].filter(Boolean).join(" • ")
  ),
  renderResolutionLabel,
  renderAspectRatioLabel,
  renderImageCountLabel,
  renderQualityLabel,
  onOpenChange,
  onResolutionChange,
  onAspectRatioChange,
  onImageCountChange,
  onQualityChange,
}: SizePresetPickerProps<R, A>) {
  const isOpen = open && !disabled;
  const hasResolutionOptions = resolutionOptions.length > 0;

  return (
    <Popover
      open={isOpen}
      onOpenChange={(nextOpen) => {
        if (!disabled) onOpenChange(nextOpen);
      }}
    >
      <div className={cn("ic-composer-size relative w-full min-w-0", disabled && "disabled", className)}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant={triggerVariant === "ghost" ? "ghost" : "outline"}
            size={triggerSize}
            className={cn(
              selectTriggerClassName,
              "ic-composer-size__trigger w-full min-w-0",
              triggerVariant === "default"
                ? "bg-card"
                : "border-transparent bg-transparent shadow-none hover:bg-transparent dark:hover:bg-transparent data-[state=open]:bg-transparent",
              triggerClassName,
            )}
            aria-label={labels.trigger}
            disabled={disabled}
          >
            <span className="min-w-0 flex-1 truncate text-left tabular-nums">
              {formatTrigger(resolution, aspectRatio, quality)}
            </span>
            <ChevronDown className="opacity-50 transition-transform duration-150 group-data-[state=open]:rotate-180" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className={cn(
            "ic-composer-size__panel scrollbar-menu grid max-h-[min(28rem,calc(100vh-4rem))] w-[min(20rem,calc(100vw-2rem))] gap-4 overflow-y-auto border-border/60 p-3 shadow-lg",
            panelClassName,
          )}
          side={panelSide}
          sideOffset={8}
          align="start"
          collisionPadding={16}
          aria-label={labels.trigger}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {qualityOptions.length && quality && labels.quality && onQualityChange ? (
            <div className="ic-composer-size__section grid gap-2">
              <span className="text-xs font-medium text-muted-foreground">{labels.quality}</span>
              <ToggleGroup
                className="ic-composer-size__quality grid w-full auto-cols-fr grid-flow-col gap-1.5"
                type="single"
                variant="outline"
                size="sm"
                spacing={1}
                value={quality}
                aria-label={labels.quality}
                onValueChange={(value) => {
                  if (value) onQualityChange(value);
                }}
              >
                {qualityOptions.map((option) => (
                  <ToggleGroupItem
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                    title={option.hint}
                    className="w-full shrink border-border/70 px-2 shadow-none data-[state=on]:border-foreground/70"
                  >
                    {renderQualityLabel ? renderQualityLabel(option) : option.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          ) : null}
          {hasResolutionOptions ? (
            <div className="ic-composer-size__section grid gap-2">
              <span className="text-xs font-medium text-muted-foreground">{labels.resolution}</span>
              <ToggleGroup
                className="ic-composer-size__resolution grid w-full auto-cols-fr grid-flow-col gap-1.5"
                type="single"
                variant="outline"
                size="sm"
                spacing={1}
                value={resolution}
                aria-label={labels.resolution}
                onValueChange={(value) => {
                  if (value) onResolutionChange(value as R);
                }}
              >
                {resolutionOptions.map((option) => (
                  <ToggleGroupItem
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                    title={option.hint}
                    className="w-full shrink border-border/70 px-2 shadow-none data-[state=on]:border-foreground/70"
                  >
                    {renderResolutionLabel ? renderResolutionLabel(option) : option.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          ) : null}
          <div className="ic-composer-size__section grid gap-2">
            <span className="text-xs font-medium text-muted-foreground">{labels.aspectRatio}</span>
            <ToggleGroup
              className={cn(
                "ic-composer-size__ratios grid w-full grid-cols-5 items-stretch gap-1.5",
                aspectRatioClassName,
              )}
              type="single"
              variant="outline"
              size="sm"
              spacing={1}
              value={aspectRatio}
              aria-label={labels.aspectRatio}
              onValueChange={(value) => {
                if (value) onAspectRatioChange(value as A);
              }}
            >
              {aspectRatioOptions.map((option) => (
                <ToggleGroupItem
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  title={option.hint}
                  className="h-14 w-full min-w-0 shrink flex-col gap-1 border-border/70 px-1 py-1.5 shadow-none data-[state=on]:border-foreground/70"
                >
                  <i
                    className="block shrink-0 rounded-[1px] border border-current opacity-70"
                    aria-hidden="true"
                    style={ratioIconStyle(option.value)}
                  />
                  <span className="max-w-full truncate text-xs font-normal tabular-nums">
                    {renderAspectRatioLabel ? renderAspectRatioLabel(option) : option.label}
                  </span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          {imageCountOptions.length && imageCount && labels.imageCount && onImageCountChange ? (
            <div className="ic-composer-size__section grid gap-2">
              <span className="text-xs font-medium text-muted-foreground">{labels.imageCount}</span>
              <ToggleGroup
                className="ic-composer-size__count grid w-full auto-cols-fr grid-flow-col gap-1.5"
                type="single"
                variant="outline"
                size="sm"
                spacing={1}
                value={imageCount}
                aria-label={labels.imageCount}
                onValueChange={(value) => {
                  if (value) onImageCountChange(value);
                }}
              >
                {imageCountOptions.map((option) => (
                  <ToggleGroupItem
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                    title={option.hint}
                    className="w-full shrink border-border/70 px-2 shadow-none data-[state=on]:border-foreground/70"
                  >
                    {renderImageCountLabel ? renderImageCountLabel(option) : option.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          ) : null}
        </PopoverContent>
      </div>
    </Popover>
  );
}
