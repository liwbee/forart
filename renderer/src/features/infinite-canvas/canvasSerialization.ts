import type { ActionFissionState } from "./action-fission/actionFissionTypes";
import type { CanvasNode } from "./types";

function sanitizeActionFissionForSave(state: ActionFissionState | undefined): ActionFissionState | undefined {
  if (!state) return state;
  return {
    ...state,
    rows: state.rows.map((row) => ({
      ...row,
      resultThumbUrl: row.resultThumbUrl?.startsWith("blob:") ? "" : row.resultThumbUrl,
    })),
  };
}

export function sanitizeCanvasNodeForSave(node: CanvasNode): CanvasNode {
  return {
    ...node,
    thumbUrl: node.thumbUrl?.startsWith("blob:") ? "" : node.thumbUrl,
    running: false,
    generationStatus: "",
    actionFission: sanitizeActionFissionForSave(node.actionFission),
  };
}

export function sanitizeCanvasNodesForSave(nodes: CanvasNode[]): CanvasNode[] {
  return nodes.map(sanitizeCanvasNodeForSave);
}
