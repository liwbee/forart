import { KeyboardEvent, type FocusEvent, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { FreeCanvasTextItem } from "../types";
import { measureTextLayer, TEXT_LAYER_LINE_HEIGHT } from "./measureTextLayer";

interface FreeCanvasTextLayerProps {
  item: FreeCanvasTextItem;
  editing: boolean;
  editLabel: string;
  onTextChange: (text: string) => void;
  onMeasureChange: (size: { width: number; height: number }) => void;
  onStopEditing: (event?: FocusEvent<HTMLTextAreaElement>) => void;
}

export function FreeCanvasTextLayer({
  item,
  editing,
  editLabel,
  onTextChange,
  onMeasureChange,
  onStopEditing,
}: FreeCanvasTextLayerProps) {
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  const textStyle = {
    color: item.color,
    fontFamily: item.fontFamily,
    fontSize: `${item.fontSize}px`,
    fontWeight: item.fontWeight,
    lineHeight: TEXT_LAYER_LINE_HEIGHT,
    textAlign: item.align,
    whiteSpace: item.autoSize ? "pre" : "pre-wrap",
  };

  const publishMeasuredSize = useCallback(() => {
    const measuredSize = measureTextLayer(item);
    const nextWidth = measuredSize.width;
    const nextHeight = measuredSize.height;
    if (Math.abs(nextWidth - item.width) > 0.5 || Math.abs(nextHeight - item.height) > 0.5) {
      onMeasureChange({ width: nextWidth, height: nextHeight });
    }
  }, [item, onMeasureChange]);

  useLayoutEffect(() => {
    publishMeasuredSize();
  }, [editing, item.text, item.fontSize, item.fontFamily, item.fontWeight, item.autoSize, item.width, publishMeasuredSize]);

  useEffect(() => {
    if (!editing) return;
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
    publishMeasuredSize();
  }, [editing, publishMeasuredSize]);

  function handleEditorInput(text: string) {
    onTextChange(text);
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    event.stopPropagation();
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.currentTarget.blur();
    }
  }

  if (editing) {
    return (
      <textarea
        ref={editorRef}
        className="free-canvas-editor__canvas-text free-canvas-editor__canvas-text-editor"
        aria-label={editLabel}
        value={item.text}
        wrap={item.autoSize ? "off" : "soft"}
        spellCheck={false}
        style={textStyle}
        onChange={(event) => handleEditorInput(event.target.value)}
        onBlur={onStopEditing}
        onKeyDown={handleEditorKeyDown}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerMove={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
      />
    );
  }

  return (
    <span className="free-canvas-editor__canvas-text" style={textStyle}>
      {item.text || " "}
    </span>
  );
}
