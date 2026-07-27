import type { LucideIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "../../../lib/utils";

interface NativeNodeCaptionProps {
  icon: LucideIcon;
  title: string;
  editable?: boolean;
  renameLabel?: string;
  onRename?: (title: string) => void;
}

export function NativeNodeCaption({
  icon: Icon,
  title,
  editable = false,
  renameLabel,
  onRename,
}: NativeNodeCaptionProps) {
  const [editing, setEditing] = useState(false);
  const titleRef = useRef<HTMLSpanElement | null>(null);
  const cancelRef = useRef(false);

  useLayoutEffect(() => {
    if (!editing) return;
    const element = titleRef.current;
    if (!element) return;
    element.textContent = title;
    element.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [editing, title]);

  const commitRename = () => {
    if (cancelRef.current) {
      cancelRef.current = false;
      setEditing(false);
      return;
    }

    const nextTitle = String(titleRef.current?.textContent || "").trim();
    setEditing(false);
    if (nextTitle && nextTitle !== title) onRename?.(nextTitle);
  };

  return (
    <div
      className={cn("rf-native-node-caption", editable && "is-editable")}
    >
      <Icon aria-hidden="true" />
      <span
        ref={titleRef}
        className={cn("rf-native-node-caption-title", editing && "is-editing nodrag nopan nowheel")}
        title={editing ? undefined : title}
        contentEditable={editing ? "plaintext-only" : false}
        suppressContentEditableWarning
        role={editing ? "textbox" : undefined}
        aria-label={editing ? renameLabel : undefined}
        aria-multiline={editing ? false : undefined}
        onPointerDown={(event) => {
          if (editing) event.stopPropagation();
        }}
        onMouseDown={(event) => {
          if (editing) event.stopPropagation();
        }}
        onDoubleClick={editable && !editing ? (event) => {
          event.preventDefault();
          event.stopPropagation();
          cancelRef.current = false;
          setEditing(true);
        } : undefined}
        onInput={editing ? (event) => {
          const text = event.currentTarget.textContent || "";
          if (text.length <= 80) return;
          event.currentTarget.textContent = text.slice(0, 80);
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(event.currentTarget);
          range.collapse(false);
          selection?.removeAllRanges();
          selection?.addRange(range);
        } : undefined}
        onBlur={editing ? commitRename : undefined}
        onKeyDown={editing ? (event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            cancelRef.current = true;
            event.currentTarget.blur();
          }
        } : undefined}
      >
        {editing ? undefined : title}
      </span>
    </div>
  );
}
