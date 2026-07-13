import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { cn } from "../lib/utils";

export interface AppSelectOption {
  value: string;
  label: string;
}

interface AppSelectProps {
  value: string;
  options: AppSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  menuPlacement?: "top" | "bottom";
  size?: "default" | "sm";
  variant?: "default" | "ghost";
}

const EMPTY_VALUE = "__forart_empty_select_value__";

function toRadixValue(value: string) {
  return value === "" ? EMPTY_VALUE : value;
}

function fromRadixValue(value: string) {
  return value === EMPTY_VALUE ? "" : value;
}

export function AppSelect({
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
  className,
  placeholder,
  open,
  onOpenChange,
  menuPlacement = "top",
  size = "default",
  variant = "default",
}: AppSelectProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const matchedOption = options.find((option) => option.value === value) || null;
  const selectedOption = matchedOption || (value && placeholder ? { value, label: placeholder } : options[0] || { value: "", label: placeholder || "" });
  const isOpen = Boolean((open ?? internalOpen) && !disabled);
  const openState = open === undefined ? undefined : isOpen;
  const side = menuPlacement === "bottom" ? "bottom" : "top";
  const closeSelect = () => {
    if (open === undefined) setInternalOpen(false);
    onOpenChange?.(false);
  };

  return (
    <div className={cn("app-select w-full min-w-0", className)}>
      <Select
        value={toRadixValue(value)}
        disabled={disabled}
        open={openState}
        onOpenChange={(nextOpen) => {
          if (disabled) return;
          if (open === undefined) setInternalOpen(nextOpen);
          onOpenChange?.(nextOpen);
        }}
        onValueChange={(nextValue) => onChange(fromRadixValue(nextValue))}
      >
        <SelectTrigger
          className={cn(
            "w-full min-w-0 active:translate-y-px",
            variant === "ghost" && "border-transparent bg-transparent shadow-none hover:bg-accent/60 data-[state=open]:bg-accent/60 dark:bg-transparent dark:hover:bg-accent/40",
          )}
          aria-label={ariaLabel}
          size={size}
          onPointerDown={(event) => {
            if (!isOpen) return;
            event.preventDefault();
            closeSelect();
          }}
        >
          <SelectValue placeholder={placeholder || selectedOption.label} />
        </SelectTrigger>
        <SelectContent
          side={side}
          sideOffset={4}
          align="start"
          position="popper"
          aria-label={ariaLabel}
        >
          {options.map((option) => {
            return (
              <SelectItem
                key={option.value || EMPTY_VALUE}
                value={toRadixValue(option.value)}
                title={option.value || undefined}
                className="my-1 min-h-8 py-1.5"
              >
                {option.label}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}
