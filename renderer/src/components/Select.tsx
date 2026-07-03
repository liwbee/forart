import { Check, ChevronDown } from "lucide-react";
import { KeyboardEvent, ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  menuClassName?: string;
  optionClassName?: string;
  selectedOptionClassName?: string;
  placeholder?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  menuPlacement?: "top" | "bottom";
  portal?: boolean;
  maxMenuHeight?: number;
  renderValue?: (option: SelectOption) => ReactNode;
  renderOption?: (option: SelectOption, selected: boolean) => ReactNode;
}

function joinClassNames(...classNames: Array<string | false | undefined>) {
  return classNames.filter(Boolean).join(" ");
}

export function Select({
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
  className,
  triggerClassName,
  menuClassName,
  optionClassName,
  selectedOptionClassName,
  placeholder,
  open,
  onOpenChange,
  menuPlacement = "top",
  portal = false,
  maxMenuHeight = 184,
  renderValue,
  renderOption,
}: SelectProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [portalMenuStyle, setPortalMenuStyle] = useState({ left: 0, top: 0, width: 0, maxHeight: maxMenuHeight });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const initializedScrollRef = useRef("");
  const matchedOption = options.find((option) => option.value === value) || null;
  const selectedOption = matchedOption || (value && placeholder ? { value, label: placeholder } : options[0] || { value: "", label: placeholder || "" });
  const isOpen = Boolean((open ?? internalOpen) && !disabled);

  function setOpen(nextOpen: boolean) {
    if (disabled) return;
    if (open === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }

  function updatePortalMenuPosition() {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const viewportHeight = window.innerHeight || 0;
    const below = viewportHeight - rect.bottom - 10;
    const above = rect.top - 10;
    const openUp = menuPlacement === "top" || (menuPlacement !== "bottom" && below < 140 && above > below);
    const availableHeight = openUp ? above : below;
    const nextMaxHeight = Math.max(120, Math.min(maxMenuHeight, availableHeight));
    setPortalMenuStyle({
      left: rect.left,
      top: openUp ? Math.max(10, rect.top - nextMaxHeight - 7) : rect.bottom + 7,
      width: rect.width,
      maxHeight: nextMaxHeight,
    });
  }

  useEffect(() => {
    if (!isOpen) {
      initializedScrollRef.current = "";
      return;
    }
    if (portal) updatePortalMenuPosition();

    function handlePointerDown(event: globalThis.PointerEvent) {
      const target = event.target as Node | null;
      if (target && (triggerRef.current?.contains(target) || menuRef.current?.contains(target))) return;
      setOpen(false);
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    if (portal) {
      window.addEventListener("resize", updatePortalMenuPosition);
      window.addEventListener("scroll", updatePortalMenuPosition, true);
    }
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
      if (portal) {
        window.removeEventListener("resize", updatePortalMenuPosition);
        window.removeEventListener("scroll", updatePortalMenuPosition, true);
      }
    };
  }, [isOpen, portal, maxMenuHeight, menuPlacement]);

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape") setOpen(false);
  }

  const menu = isOpen ? (
    <div
      ref={(node) => {
        menuRef.current = node;
        if (!node) return;
        const scrollKey = `${selectedOption.value}:${options.length}`;
        if (initializedScrollRef.current === scrollKey) return;
        initializedScrollRef.current = scrollKey;
        window.requestAnimationFrame(() => {
          const selectedElement = node.querySelector<HTMLElement>('[data-selected="true"]');
          if (!selectedElement) return;
          node.scrollTop = Math.max(0, selectedElement.offsetTop - (node.clientHeight - selectedElement.offsetHeight) / 2);
        });
      }}
      className={joinClassNames("ic-composer-select__menu scrollbar-menu", portal && "ic-composer-select__menu--portal", menuClassName)}
      role="listbox"
      aria-label={ariaLabel}
      style={portal ? portalMenuStyle : { maxHeight: maxMenuHeight }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {options.map((option) => {
        const selected = Boolean(matchedOption && option.value === matchedOption.value);
        return (
          <button
            key={option.value}
            data-selected={selected ? "true" : undefined}
            type="button"
            className={joinClassNames(optionClassName, selected && (selectedOptionClassName || "selected"))}
            role="option"
            aria-selected={selected}
            onClick={() => {
              onChange(option.value);
              setOpen(false);
            }}
          >
            {renderOption ? (
              renderOption(option, selected)
            ) : (
              <span className={option.hint ? "ic-composer-select__option-text" : ""} title={option.hint || option.value || undefined}>
                {option.hint ? (
                  <>
                    <strong>{option.label}</strong>
                    <small>{option.hint}</small>
                  </>
                ) : option.label}
              </span>
            )}
            {selected ? <Check size={14} aria-hidden="true" /> : null}
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <div className={joinClassNames("ic-composer-select", isOpen && "open", disabled && "disabled", className)}>
      <button
        ref={triggerRef}
        type="button"
        className={joinClassNames("ic-composer-select__trigger", triggerClassName)}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        disabled={disabled}
        onClick={() => setOpen(!isOpen)}
        onKeyDown={handleTriggerKeyDown}
      >
        {renderValue ? renderValue(selectedOption) : <span title={selectedOption.label}>{selectedOption.label}</span>}
        <ChevronDown size={18} aria-hidden="true" />
      </button>
      {portal && menu ? createPortal(menu, document.body) : menu}
    </div>
  );
}
