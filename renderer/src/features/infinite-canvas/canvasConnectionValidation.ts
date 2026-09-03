import type { NativeCanvasEdge, NativeCanvasNode } from "./nativeCanvas";
import { NATIVE_CANVAS_NODE_DEFINITIONS } from "./nativeCanvas";
import { edgeDataForConnection } from "./generation/imageGenerationInputs";

export interface NativeCanvasConnectionCandidate {
  source: string | null;
  sourceHandle?: string | null;
  target: string | null;
  targetHandle?: string | null;
}

const TYPED_INPUT_NODE_KINDS = new Set([
  "imageGenerator",
  "actionFission",
  "smartReverse",
]);

export function isNativeCanvasConnectionValid(
  connection: NativeCanvasConnectionCandidate,
  nodes: NativeCanvasNode[],
  edges: NativeCanvasEdge[],
) {
  if (!connection.source || !connection.target || connection.source === connection.target) return false;

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const source = nodeMap.get(connection.source);
  const target = nodeMap.get(connection.target);
  if (!source || !target) return false;

  const sourceDefinition = NATIVE_CANVAS_NODE_DEFINITIONS[source.data.kind];
  const targetDefinition = NATIVE_CANVAS_NODE_DEFINITIONS[target.data.kind];
  if (!sourceDefinition.providesOutput || !targetDefinition.acceptsInput) return false;

  // A pair of nodes represents one logical input relationship, even when the
  // target exposes multiple handles. Reconnecting the same pair is a duplicate.
  if (edges.some((edge) => edge.source === source.id && edge.target === target.id)) return false;

  const edgeData = edgeDataForConnection(
    source.data.kind,
    target.data.kind,
    target.id,
    edges,
    connection.targetHandle,
  );

  return !TYPED_INPUT_NODE_KINDS.has(target.data.kind) || Boolean(edgeData);
}
