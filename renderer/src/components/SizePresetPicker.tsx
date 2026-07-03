import { ChevronDown } from "lucide-react";
import { ReactNode, useEffect, useRef } from "react";

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
}

interface SizePresetPickerProps<R extends string, A extends string> {
  open: boolean;
  resolution: R;
  aspectRatio: A;
  resolutionOptions: SizePresetOption<R>[];
  aspectRatioOptions: SizePresetOption<A>[];
  labels: SizePresetPickerLabels;
  className?: string;
  triggerClassName?: string;
  panelClassName?: string;
  aspectRatioClassName?: string;
  disabled?: boolean;
  formatTrigger?: (resolution: R, aspectRatio: A) => string;
  renderResolutionLabel?: (option: SizePresetOption<R>) => ReactNode;
  renderAspectRatioLabel?: (option: SizePresetOption<A>) => ReactNode;
  onOpenChange: (open: boolean) => void;
  onResolutionChange: (value: R) => void;
  onAspectRatioChange: (value: A) => void;
}

function joinClassNames(...classNames: Array<string | false | undefined>) {
  return classNames.filter(Boolean).join(" ");
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
  labels,
  className,
  triggerClassName,
  panelClassName,
  aspectRatioClassName,
  disabled = false,
  formatTrigger = (currentResolution, currentAspectRatio) => `${currentResolution.toUpperCase()} / ${currentAspectRatio}`,
  renderResolutionLabel,
  renderAspectRatioLabel,
  onOpenChange,
  onResolutionChange,
  onAspectRatioChange,
}: SizePresetPickerProps<R, A>) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const isOpen = open && !disabled;
  const hasResolutionOptions = resolutionOptions.length > 0;

  useEffect(() => {
    if (!isOpen) return;

    function closeOnPointerDown(event: globalThis.PointerEvent) {
      const target = event.target as Node | null;
      if (target && rootRef.current?.contains(target)) return;
      onOpenChange(false);
    }

    function closeOnKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") onOpenChange(false);
    }

    window.addEventListener("pointerdown", closeOnPointerDown, true);
    window.addEventListener("keydown", closeOnKeyDown);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown, true);
      window.removeEventListener("keydown", closeOnKeyDown);
    };
  }, [isOpen, onOpenChange]);

  return (
    <div ref={rootRef} className={joinClassNames("ic-composer-size", isOpen && "open", disabled && "disabled", className)}>
      <button
        type="button"
        className={joinClassNames("ic-composer-select__trigger ic-composer-size__trigger", triggerClassName)}
        aria-label={labels.trigger}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        disabled={disabled}
        onClick={() => onOpenChange(!isOpen)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onOpenChange(false);
        }}
      >
        <span>{formatTrigger(resolution, aspectRatio)}</span>
        <ChevronDown size={18} aria-hidden="true" />
      </button>
      {isOpen ? (
        <div
          className={joinClassNames("ic-composer-size__panel scrollbar-menu", panelClassName)}
          role="dialog"
          aria-label={labels.trigger}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {hasResolutionOptions ? (
            <div className="ic-composer-size__section">
              <span>{labels.resolution}</span>
              <div className="ic-composer-size__resolution" role="radiogroup" aria-label={labels.resolution}>
                {resolutionOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={option.value === resolution ? "selected" : ""}
                    role="radio"
                    aria-checked={option.value === resolution}
                    disabled={option.disabled}
                    title={option.hint}
                    onClick={() => onResolutionChange(option.value)}
                  >
                    {renderResolutionLabel ? renderResolutionLabel(option) : option.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="ic-composer-size__section">
            <span>{labels.aspectRatio}</span>
            <div className={joinClassNames("ic-composer-size__ratios", aspectRatioClassName)} role="radiogroup" aria-label={labels.aspectRatio}>
              {aspectRatioOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={option.value === aspectRatio ? "selected" : ""}
                  role="radio"
                  aria-checked={option.value === aspectRatio}
                  disabled={option.disabled}
                  title={option.hint}
                  onClick={() => onAspectRatioChange(option.value)}
                >
                  <i aria-hidden="true" style={ratioIconStyle(option.value)} />
                  <span>{renderAspectRatioLabel ? renderAspectRatioLabel(option) : option.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
