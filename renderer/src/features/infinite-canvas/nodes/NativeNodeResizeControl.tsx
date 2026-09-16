import { NodeResizeControl, useReactFlow, useUpdateNodeInternals, type ResizeParams } from "@xyflow/react";
import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNativeCanvasActions } from "../canvasActions";
import { snapResizeDimension } from "../batchNodeSizing";
import type { NativeCanvasNode, NativeCanvasNodeResizeConfig } from "../nativeCanvas";
import { ResizeHandleIcon } from "./canvasNodeIcons";

interface NativeNodeResizeControlProps extends NativeCanvasNodeResizeConfig {
  nodeId: string;
}

export function NativeNodeResizeControl({
  nodeId,
  minWidth,
  minHeight,
  maxWidth,
  maxHeight,
  widthStep,
  heightStep,
  widthSnapOrigin = minWidth,
  heightSnapOrigin = minHeight,
}: NativeNodeResizeControlProps) {
  const { t } = useTranslation();
  const actions = useNativeCanvasActions();
  const { setNodes } = useReactFlow<NativeCanvasNode>();
  const updateNodeInternals = useUpdateNodeInternals();
  const resizingRef = useRef(false);
  const lastSnappedSizeRef = useRef<{ width: number; height: number } | null>(null);
  const pendingSizeRef = useRef<{ width: number; height: number } | null>(null);
  const snapScheduledRef = useRef(false);
  const remeasureFrameRef = useRef<number | null>(null);
  const snapSize = useCallback((params: ResizeParams) => ({
      width: snapResizeDimension(params.width, widthStep, widthSnapOrigin, minWidth, maxWidth),
      height: snapResizeDimension(params.height, heightStep, heightSnapOrigin, minHeight, maxHeight),
  }), [heightSnapOrigin, heightStep, maxHeight, maxWidth, minHeight, minWidth, widthSnapOrigin, widthStep]);
  const scheduleRemeasure = useCallback(() => {
    if (remeasureFrameRef.current !== null) return;
    remeasureFrameRef.current = window.requestAnimationFrame(() => {
      remeasureFrameRef.current = null;
      updateNodeInternals(nodeId);
    });
  }, [nodeId, updateNodeInternals]);
  const queueSnappedSize = useCallback((params: ResizeParams) => {
    if (!widthStep && !heightStep) return;
    const nextSize = snapSize(params);
    lastSnappedSizeRef.current = nextSize;
    pendingSizeRef.current = nextSize;
    if (snapScheduledRef.current) return;
    snapScheduledRef.current = true;
    queueMicrotask(() => {
      snapScheduledRef.current = false;
      const size = pendingSizeRef.current;
      pendingSizeRef.current = null;
      if (!size) return;
      setNodes((current) => current.map((node) => node.id === nodeId ? {
        ...node,
        width: size.width,
        height: size.height,
        style: { ...node.style, width: size.width, height: size.height },
      } : node));
      // React Flow's resize engine reports the raw pointer dimensions through
      // `measured` before this snapped style update lands. NodeToolbar and the
      // parameter panel are portals that position from that measured rect;
      // remeasure after the DOM receives the snapped size so both overlays
      // share the node body's actual bounds.
      scheduleRemeasure();
    });
  }, [nodeId, scheduleRemeasure, setNodes, snapSize, widthStep, heightStep]);
  const shouldResize = useCallback((_event: unknown, params: ResizeParams & { direction: number[] }) => {
    if (!widthStep && !heightStep) return true;
    const nextSize = snapSize(params);
    const previousSize = lastSnappedSizeRef.current;
    return !previousSize || nextSize.width !== previousSize.width || nextSize.height !== previousSize.height;
  }, [heightStep, snapSize, widthStep]);
  const beginResize = useCallback(() => {
    if (resizingRef.current) return;
    lastSnappedSizeRef.current = null;
    resizingRef.current = true;
    actions.beginHistoryGesture();
  }, [actions]);
  const endResize = useCallback((_event: unknown, params: ResizeParams) => {
    if (!resizingRef.current) return;
    queueSnappedSize(params);
    resizingRef.current = false;
    queueMicrotask(actions.endHistoryGesture);
  }, [actions, queueSnappedSize]);

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
      onResize={widthStep || heightStep ? (_event, params) => queueSnappedSize(params) : undefined}
      shouldResize={widthStep || heightStep ? shouldResize : undefined}
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
        <ResizeHandleIcon aria-hidden="true" />
      </span>
    </NodeResizeControl>
  );
}
