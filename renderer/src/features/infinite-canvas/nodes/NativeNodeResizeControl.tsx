import ResizeIcon from "@iconify-react/pajamas/resize";
import { NodeResizeControl } from "@xyflow/react";
import { useTranslation } from "react-i18next";
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

  return (
    <NodeResizeControl
      nodeId={nodeId}
      position="bottom-right"
      minWidth={minWidth}
      minHeight={minHeight}
      maxWidth={maxWidth}
      maxHeight={maxHeight}
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
