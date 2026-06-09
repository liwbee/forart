import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { CanvasNode } from "../types";

interface PromptNodeBodyProps {
  node: CanvasNode;
  isEditing: boolean;
  onEditingChange: (editing: boolean) => void;
  onPatch: (patch: Partial<CanvasNode>) => void;
}

export function PromptNodeBody({ node, isEditing, onEditingChange, onPatch }: PromptNodeBodyProps) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!isEditing) return;
    textareaRef.current?.focus();
    textareaRef.current?.select();
  }, [isEditing]);

  function enterEditing() {
    onEditingChange(true);
  }

  return (
    <div className="ic-node-body nowheel">
      {isEditing ? (
        <textarea
          ref={textareaRef}
          className="nodrag nopan nowheel ic-prompt-textarea"
          value={node.text || ""}
          placeholder={t("infiniteCanvas.promptPlaceholder")}
          onBlur={() => onEditingChange(false)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
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
