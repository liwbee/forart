import { NodeToolbar, Position, useNodes, useReactFlow, type NodeProps } from "@xyflow/react";
import { FolderKanban, Trash2, Ungroup } from "lucide-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../components/ui/button";
import { useNativeCanvasActions } from "../canvasActions";
import { useNativeCanvasInteractionStore } from "../canvasInteractionStore";
import type { NativeCanvasNode } from "../nativeCanvas";
import { ungroupNativeCanvasNodes } from "../nativeCanvasGroups";
import { NativeNodeCaption } from "./NativeNodeCaption";
import { NativeNodeResizeControl } from "./NativeNodeResizeControl";

/** React Flow's native parent/container node. Children use parentId and relative positions. */
export const NativeCanvasGroupNode = memo(function NativeCanvasGroupNode({ id, data, selected, dragging }: NodeProps<NativeCanvasNode>) {
  const { t } = useTranslation();
  const nodes = useNodes<NativeCanvasNode>();
  const { deleteElements, setNodes } = useReactFlow<NativeCanvasNode>();
  const actions = useNativeCanvasActions();
  const toolbarNodeId = useNativeCanvasInteractionStore((state) => state.toolbarNodeId);
  const children = nodes.filter((node) => node.parentId === id);
  const minWidth = Math.max(260, ...children.map((node) => (
    node.position.x + Number(node.measured?.width || node.width || node.style?.width || 0) + 28
  )));
  const minHeight = Math.max(180, ...children.map((node) => (
    node.position.y + Number(node.measured?.height || node.height || node.style?.height || 0) + 28
  )));
  return (
    <>
      <NativeNodeCaption
        icon={FolderKanban}
        title={String(data.label || t("infiniteCanvas:group"))}
        editable
        renameLabel={t("common:actions.rename")}
        onRename={(label) => actions.patchNodeData(id, { label })}
      />
      <NodeToolbar
        nodeId={id}
        isVisible={selected && toolbarNodeId === id && !dragging}
        position={Position.Top}
        offset={44}
        className="rf-native-group-toolbar nodrag nopan nowheel"
      >
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            setNodes((current) => ungroupNativeCanvasNodes(current, id));
          }}
        >
          <Ungroup aria-hidden="true" />
          <span>{t("infiniteCanvas:ungroupNodes")}</span>
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            void deleteElements({ nodes: [{ id }] });
          }}
        >
          <Trash2 aria-hidden="true" />
          <span>{t("infiniteCanvas:deleteGroup")}</span>
        </Button>
      </NodeToolbar>
      <div className={`rf-native-group-node${selected ? " is-selected" : ""}`}>
        {selected ? (
          <NativeNodeResizeControl
            nodeId={id}
            minWidth={minWidth}
            minHeight={minHeight}
            maxWidth={3000}
            maxHeight={3000}
          />
        ) : null}
      </div>
    </>
  );
});
