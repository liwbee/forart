import * as React from "react"
import { CheckIcon, ChevronDownIcon } from "lucide-react"
import { Select as SelectPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

const selectTriggerClassName = "group flex w-fit items-center justify-between gap-2 rounded-md border border-input bg-card px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow,border-color,background] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-[placeholder]:text-muted-foreground data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 dark:bg-input/30 dark:hover:bg-input/30 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground"

function Select({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectGroup({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default"
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-overlay-trigger="select"
      data-size={size}
      className={cn(
        selectTriggerClassName,
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="size-4 opacity-50 transition-transform duration-150 group-data-[state=open]:rotate-180" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  position = "item-aligned",
  align = "center",
  onPointerDown,
  onPointerUp,
  onMouseDown,
  onClick,
  onWheel,
  onPointerDownOutside,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  const viewportRef = React.useRef<HTMLDivElement | null>(null)
  const skipCloseAutoFocusRef = React.useRef(false)
  const [isScrollable, setIsScrollable] = React.useState(false)

  React.useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const updateScrollable = () => {
      setIsScrollable(viewport.scrollHeight > viewport.clientHeight + 1)
    }

    updateScrollable()
    const observer = new ResizeObserver(updateScrollable)
    observer.observe(viewport)
    Array.from(viewport.children).forEach((child) => observer.observe(child))
    return () => observer.disconnect()
  }, [children])

  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        data-scrollable={isScrollable ? "true" : "false"}
        className={cn(
          "nodrag nopan nowheel relative z-50 max-h-(--radix-select-content-available-height) min-w-[8rem] origin-(--radix-select-content-transform-origin) overflow-hidden rounded-md border border-border/60 bg-popover text-popover-foreground shadow-sm data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          className
        )}
        position={position}
        align={align}
        onPointerDown={(event) => {
          onPointerDown?.(event)
          event.stopPropagation()
        }}
        onPointerUp={(event) => {
          onPointerUp?.(event)
          event.stopPropagation()
        }}
        onMouseDown={(event) => {
          onMouseDown?.(event)
          event.stopPropagation()
        }}
        onClick={(event) => {
          onClick?.(event)
          event.stopPropagation()
        }}
        onWheel={(event) => {
          onWheel?.(event)
          event.stopPropagation()
        }}
        onPointerDownOutside={(event) => {
          onPointerDownOutside?.(event)
          if (event.defaultPrevented) return
          const target = event.detail.originalEvent.target
          skipCloseAutoFocusRef.current = target instanceof Element
            && Boolean(target.closest("[data-overlay-trigger]"))
        }}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event)
          if (!event.defaultPrevented && skipCloseAutoFocusRef.current) {
            event.preventDefault()
          }
          skipCloseAutoFocusRef.current = false
        }}
        {...props}
      >
        <SelectPrimitive.Viewport
          ref={viewportRef}
          data-slot="select-viewport"
          data-scrollable={isScrollable ? "true" : "false"}
          className={cn(
            "scrollbar-menu max-h-60 overflow-y-auto p-1",
            position === "popper" &&
              "w-full min-w-[calc(var(--radix-select-trigger-width)+var(--app-select-scrollbar-extra,0px))] scroll-my-1 data-[scrollable=true]:[--app-select-scrollbar-extra:8px]"
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn("px-2 py-1.5 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "group relative my-0.5 flex min-h-7 w-full cursor-default items-center gap-2 rounded-sm py-1 pr-8 pl-2 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[state=checked]:bg-[var(--select-item-selected-bg)] data-[state=checked]:text-[var(--select-item-selected-text)] data-[state=checked]:font-medium data-[highlighted]:bg-[var(--select-item-hover-bg)] data-[highlighted]:text-[var(--select-item-hover-text)] data-[highlighted]:data-[state=checked]:bg-[var(--select-item-selected-bg)] data-[highlighted]:data-[state=checked]:text-[var(--select-item-selected-text)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className
      )}
      {...props}
    >
      <span
        data-slot="select-item-indicator"
        className="absolute right-2 flex size-3.5 items-center justify-center"
      >
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText asChild>
        <span
          data-slot="select-item-text"
          className="block min-w-0 flex-1 truncate pr-1 transition-transform duration-150 ease-out group-data-[highlighted]:translate-x-0.5"
        >
          {children}
        </span>
      </SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  selectTriggerClassName,
}
