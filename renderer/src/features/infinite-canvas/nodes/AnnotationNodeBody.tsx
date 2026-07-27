import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useReactFlow, useUpdateNodeInternals } from "@xyflow/react";
import { Textarea } from "../../../components/ui/textarea";
import { useNativeCanvasActions } from "../canvasActions";
import { useNativeCanvasInteractionStore } from "../canvasInteractionStore";
import type { NativeCanvasAnnotationStyle, NativeCanvasEdge, NativeCanvasNode } from "../nativeCanvas";
import { annotationTextCss, resolveAnnotationStyle } from "./annotationStyle";
import { measureAnnotationText } from "./annotationTextMeasure";

interface AnnotationNodeBodyProps {
  nodeId: string;
  text: string;
  textStyle?: NativeCanvasAnnotationStyle;
}

export function AnnotationNodeBody({ nodeId, text, textStyle }: AnnotationNodeBodyProps) {
  const { t } = useTranslation();
  const actions = useNativeCanvasActions();
  const { setNodes } = useReactFlow<NativeCanvasNode, NativeCanvasEdge>();
  const updateNodeInternals = useUpdateNodeInternals();
  const editing = useNativeCanvasInteractionStore((state) => state.editingNodeId === nodeId);
  const beginNodeEditing = useNativeCanvasInteractionStore((state) => state.beginNodeEditing);
  const endNodeEditing = useNativeCanvasInteractionStore((state) => state.endNodeEditing);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const cancelRef = useRef(false);
  const [draft, setDraft] = useState(text);
  const [fontRevision, setFontRevision] = useState(0);
  const defaultText = t("infiniteCanvas:annotationDefaultText");
  const measuredText = editing ? draft : text;
  const resolvedStyle = resolveAnnotationStyle(textStyle);
  const cssStyle = annotationTextCss(resolvedStyle);

  useEffect(() => {
    if (!editing) {
      setDraft(text);
      return;
    }

    cancelRef.current = false;
    setDraft(text);
    const frame = window.requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editing, text]);

  useEffect(() => {
    let canceled = false;
    void document.fonts?.ready.then(() => {
      if (!canceled) setFontRevision((revision) => revision + 1);
    });
    return () => {
      canceled = true;
    };
  }, []);

  useLayoutEffect(() => {
    const { width, height } = measureAnnotationText(measuredText, defaultText, resolvedStyle);
    setNodes((nodes) => {
      let changed = false;
      const nextNodes = nodes.map((node) => {
        if (node.id !== nodeId) return node;
        const currentWidth = Number(node.style?.width || node.measured?.width || 0);
        const currentHeight = Number(node.style?.height || node.measured?.height || 0);
        if (Math.abs(currentWidth - width) < 0.5 && Math.abs(currentHeight - height) < 0.5) return node;
        changed = true;
        return { ...node, style: { ...node.style, width, height } };
      });
      return changed ? nextNodes : nodes;
    });
    const frame = window.requestAnimationFrame(() => updateNodeInternals(nodeId));
    return () => window.cancelAnimationFrame(frame);
  }, [
    defaultText,
    fontRevision,
    measuredText,
    nodeId,
    resolvedStyle.bold,
    resolvedStyle.fontSize,
    resolvedStyle.lineHeight,
    resolvedStyle.textAlign,
    setNodes,
    updateNodeInternals,
  ]);

  const finishEditing = () => {
    if (cancelRef.current) {
      cancelRef.current = false;
      setDraft(text);
      endNodeEditing(nodeId);
      return;
    }

    const nextText = draft.trim() ? draft : defaultText;
    if (nextText !== text) actions.setNodeText(nodeId, nextText);
    endNodeEditing(nodeId);
  };

  return (
    <>
      {editing && !actions.readOnly ? (
      <Textarea
        ref={inputRef}
        className="rf-native-annotation-input nodrag nopan nowheel"
        value={draft}
        wrap="off"
        spellCheck={false}
        style={cssStyle}
        aria-label={t("infiniteCanvas:annotation")}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerMove={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={finishEditing}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            cancelRef.current = true;
            event.currentTarget.blur();
          } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
      ) : (
        <span
          className="rf-native-annotation-text"
          style={cssStyle}
          onDoubleClick={(event) => {
            if (actions.readOnly) return;
            event.preventDefault();
            event.stopPropagation();
            beginNodeEditing(nodeId);
          }}
        >
          {text || defaultText}
        </span>
      )}
    </>
  );
}
