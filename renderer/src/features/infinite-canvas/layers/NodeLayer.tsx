import { Link2 } from "lucide-react";
import { memo, PointerEvent } from "react";
import type { useTranslation } from "react-i18next";
import { useCanvasStore } from "../canvasStore";
import { useCanvasUiStore } from "../canvasUiStore";
import { WORLD_CENTER } from "../canvasGeometry";
import { acceptsIncomingConnections, isImageLikeNode } from "../nodePredicates";
import { getNodeDefinition } from "../nodes/registry";
import type { CanvasNode, CanvasNodeType, CropRect } from "../types";

export interface NodeBodyRenderState {
  cropRect: CropRect | null;
  isDownloadBusy: boolean;
  openSelectId: string;
  isEditingPrompt: boolean;
}

interface NodeLayerProps {
  imageCropNodeId: string;
  imageCropRect: CropRect | null;
  downloadNodeId: string;
  downloadTone: "busy" | "ready" | "error" | "";
  openSelectId: string;
  editingPromptId: string;
  linkDraftFromId: string;
  renderNodeBody: (node: CanvasNode, state: NodeBodyRenderState) => React.ReactNode;
  startNodeDrag: (event: PointerEvent<HTMLDivElement>, node: CanvasNode) => void;
  finishLink: (event: PointerEvent<HTMLElement>, target: CanvasNode) => void;
  handleNodeDoubleClick: (event: React.MouseEvent<HTMLDivElement>, node: CanvasNode) => void;
  startNodeResize: (event: PointerEvent<HTMLButtonElement>, node: CanvasNode) => void;
  startLink: (event: PointerEvent<HTMLButtonElement>, node: CanvasNode) => void;
  setHoveredId: ReturnType<typeof useCanvasUiStore.getState>["setHoveredId"];
  getKindLabel: (type: CanvasNodeType) => string;
  t: ReturnType<typeof useTranslation>["t"];
}

interface CanvasNodeItemProps extends Omit<NodeLayerProps, "imageCropNodeId" | "imageCropRect" | "downloadNodeId" | "downloadTone" | "openSelectId" | "editingPromptId" | "linkDraftFromId"> {
  nodeId: string;
  isCropping: boolean;
  cropRect: CropRect | null;
  isDownloadBusy: boolean;
  itemOpenSelectId: string;
  isEditingPrompt: boolean;
  isConnecting: boolean;
}

const CanvasNodeItem = memo(function CanvasNodeItem({
  nodeId,
  isCropping,
  cropRect,
  isDownloadBusy,
  itemOpenSelectId,
  isEditingPrompt,
  isConnecting,
  renderNodeBody,
  startNodeDrag,
  finishLink,
  handleNodeDoubleClick,
  startNodeResize,
  startLink,
  setHoveredId,
  getKindLabel,
  t,
}: CanvasNodeItemProps) {
  const node = useCanvasStore((state) => state.nodeLookup.get(nodeId));
  const selected = useCanvasUiStore((state) => state.selectedIds.has(nodeId));
  const hovered = useCanvasUiStore((state) => state.hoveredId === nodeId);
  const related = useCanvasUiStore((state) => {
    const selectedIds = state.selectedIds;
    const connections = useCanvasStore.getState().connections;
    if (!selectedIds.size) return false;
    return connections.some((connection) => (
      (connection.from === nodeId && selectedIds.has(connection.to))
      || (connection.to === nodeId && selectedIds.has(connection.from))
      || (selectedIds.has(nodeId) && (connection.from === nodeId || connection.to === nodeId))
    ));
  });

  if (!node) return null;
  const hasCustomNodeBody = ["image", "libtvUpload", "imageGenerator", "lovart", "libtvImage", "prompt", "libtvPrompt"].includes(node.type);

  return (
    <div
      className={`ic-node ic-node--${node.type}${isImageLikeNode(node) && node.url ? " has-image" : ""}${node.running ? " is-running" : ""}${selected ? " selected" : ""}${hovered ? " hovered" : ""}${related ? " related" : ""}${isConnecting ? " connecting" : ""}`}
      style={{ left: WORLD_CENTER + node.x, top: WORLD_CENTER + node.y, width: node.w, height: node.h }}
      onPointerDown={(event) => startNodeDrag(event, node)}
      onPointerUp={(event) => finishLink(event, node)}
      onDoubleClick={(event) => handleNodeDoubleClick(event, node)}
      onPointerEnter={() => setHoveredId(node.id)}
      onPointerLeave={() => setHoveredId((current) => (current === node.id ? "" : current))}
    >
      {acceptsIncomingConnections(node) ? (
        <button className="ic-port ic-port--in nodrag" type="button" title={t("infiniteCanvas.connectHere")} onPointerUp={(event) => finishLink(event, node)}>
          <Link2 size={13} aria-hidden="true" />
        </button>
      ) : null}
      <button className="ic-port ic-port--out nodrag" type="button" title={t("infiniteCanvas.dragLink")} onPointerDown={(event) => startLink(event, node)}>
        <Link2 size={13} aria-hidden="true" />
      </button>
      {!hasCustomNodeBody ? (
        <>
          <div className="ic-node-head">
            <span className="ic-node-kind">{(() => {
              const Icon = getNodeDefinition(node.type).icon;
              return <Icon size={16} aria-hidden="true" />;
            })()}{getKindLabel(node.type)}</span>
          </div>
          <div className="ic-node-title">{node.title}</div>
        </>
      ) : null}
      {renderNodeBody(node, {
        cropRect,
        isDownloadBusy,
        openSelectId: itemOpenSelectId,
        isEditingPrompt,
      })}
      {selected && !isCropping && !isImageLikeNode(node) ? <button className="ic-resize-handle nodrag" type="button" aria-label={t("infiniteCanvas.dragResize")} onPointerDown={(event) => startNodeResize(event, node)} /> : null}
    </div>
  );
});

export const NodeLayer = memo(function NodeLayer({
  imageCropNodeId,
  imageCropRect,
  downloadNodeId,
  downloadTone,
  openSelectId,
  editingPromptId,
  linkDraftFromId,
  renderNodeBody,
  startNodeDrag,
  finishLink,
  handleNodeDoubleClick,
  startNodeResize,
  startLink,
  setHoveredId,
  getKindLabel,
  t,
}: NodeLayerProps) {
  const nodeIds = useCanvasStore((state) => state.nodeIds);
  return (
    <>
      {nodeIds.map((nodeId) => (
        <CanvasNodeItem
          key={nodeId}
          nodeId={nodeId}
          isCropping={imageCropNodeId === nodeId}
          cropRect={imageCropNodeId === nodeId ? imageCropRect : null}
          isDownloadBusy={downloadNodeId === nodeId && downloadTone === "busy"}
          itemOpenSelectId={openSelectId.startsWith(`${nodeId}:`) ? openSelectId : ""}
          isEditingPrompt={editingPromptId === nodeId}
          isConnecting={linkDraftFromId === nodeId}
          renderNodeBody={renderNodeBody}
          startNodeDrag={startNodeDrag}
          finishLink={finishLink}
          handleNodeDoubleClick={handleNodeDoubleClick}
          startNodeResize={startNodeResize}
          startLink={startLink}
          setHoveredId={setHoveredId}
          getKindLabel={getKindLabel}
          t={t}
        />
      ))}
    </>
  );
});
