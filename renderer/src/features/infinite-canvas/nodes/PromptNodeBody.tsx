import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { CanvasNode } from "../types";

interface PromptNodeBodyProps {
  node: CanvasNode;
  isEditing: boolean;
  onEditingChange: (editing: boolean) => void;
  onPatch: (patch: Partial<CanvasNode>) => void;
  onCommit?: (text: string) => void;
}

export function PromptNodeBody({ node, isEditing, onEditingChange, onPatch, onCommit }: PromptNodeBodyProps) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const committedRef = useRef(false);

  useEffect(() => {
    if (!isEditing) return;
    committedRef.current = false;
    textareaRef.current?.focus();
    textareaRef.current?.select();
  }, [isEditing]);

  function enterEditing() {
    onEditingChange(true);
  }

  function commitText(text: string) {
    if (committedRef.current) return;
    committedRef.current = true;
    onCommit?.(text);
  }

  return (
    <div className="ic-node-body nowheel">
      {isEditing ? (
        <textarea
          ref={textareaRef}
          className="nodrag nopan nowheel ic-prompt-textarea"
          value={node.text || ""}
          placeholder={t("infiniteCanvas.promptPlaceholder")}
          onBlur={(event) => {
            commitText(event.target.value);
            onEditingChange(false);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            commitText(event.currentTarget.value);
            onEditingChange(false);
          }}
          onChange={(event) => onPatch({ text: event.target.value })}
        />
      ) : (
        <div
          className={`ic-prompt-textarea ic-prompt-display${node.text ? "" : " empty"}`}
          onPointerDown={(event) => {
            if (event.button !== 0 || event.detail < 2) return;
            event.preventDefault();
            event.stopPropagation();
            enterEditing();
          }}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            enterEditing();
          }}
        >
          {node.text || t("infiniteCanvas.promptPlaceholder")}
        </div>
      )}
    </div>
  );
}
