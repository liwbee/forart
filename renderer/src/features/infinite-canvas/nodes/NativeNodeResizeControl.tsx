import ResizeIcon from "@iconify-react/pajamas/resize";
import { NodeResizeControl } from "@xyflow/react";
import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNativeCanvasActions } from "../canvasActions";
import type { NativeCanvasNodeResizeConfig } from "../nativeCanvas";

interface NativeNodeResizeControlProps extends NativeCanvasNodeResizeConfig {
  nodeId: string;
}

export function NativeNodeResizeControl({
  nodeId,
  minWidth,
  minHeight,
  maxWidth,
  maxHeight,
}: NativeNodeResizeControlProps) {
  const { t } = useTranslation();
  const actions = useNativeCanvasActions();
  const resizingRef = useRef(false);
  const beginResize = useCallback(() => {
    if (resizingRef.current) return;
    resizingRef.current = true;
    actions.beginHistoryGesture();
  }, [actions]);
  const endResize = useCallback(() => {
    if (!resizingRef.current) return;
    resizingRef.current = false;
    queueMicrotask(actions.endHistoryGesture);
  }, [actions]);

  useEffect(() => () => {
    if (!resizingRef.current) return;
    resizingRef.current = false;
    actions.endHistoryGesture();
  }, [actions]);

  return (
    <NodeResizeControl
      nodeId={nodeId}
      position="bottom-right"
      minWidth={minWidth}
      minHeight={minHeight}
      maxWidth={maxWidth}
      maxHeight={maxHeight}
      onResizeStart={beginResize}
      onResizeEnd={endResize}
      className="rf-native-node-resize-control nodrag"
      style={{
        left: "auto",
        top: "auto",
        right: 6,
        bottom: 6,
        translate: "none",
      }}
    >
      <span title={t("infiniteCanvas:dragResize")}>
        <ResizeIcon aria-hidden="true" />
      </span>
    </NodeResizeControl>
  );
}
