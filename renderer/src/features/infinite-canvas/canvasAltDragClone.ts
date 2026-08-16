interface AltDragNodePosition {
  id: string;
  position: { x: number; y: number };
  zIndex?: number;
}

interface AltDragCanvasNode extends AltDragNodePosition {
  dragging?: boolean;
  selected?: boolean;
}

export interface AltDragCloneGestureState {
  cloneIdBySourceId: ReadonlyMap<string, string>;
  cloneZIndex: number;
  sourceNodes: AltDragNodePosition[];
}

export function projectAltDragOntoClones<NodeType extends AltDragCanvasNode>(
  nodes: NodeType[],
  gesture: AltDragCloneGestureState,
  draggedSourceNodes: AltDragNodePosition[],
  dragging: boolean,
): NodeType[] {
  const sourceStateById = new Map(gesture.sourceNodes.map((node) => [node.id, node]));
  const draggedSourceById = new Map(draggedSourceNodes.map((node) => [node.id, node]));
  const sourceIdByCloneId = new Map(
    [...gesture.cloneIdBySourceId].map(([sourceId, cloneId]) => [cloneId, sourceId]),
  );

  return nodes.map((node) => {
    const sourceState = sourceStateById.get(node.id);
    if (sourceState) {
      return {
        ...node,
        position: { ...sourceState.position },
        zIndex: sourceState.zIndex,
        selected: false,
        dragging: false,
      };
    }

    const sourceId = sourceIdByCloneId.get(node.id);
    if (!sourceId) return node;
    const draggedSource = draggedSourceById.get(sourceId);

    return {
      ...node,
      ...(draggedSource ? { position: { ...draggedSource.position } } : {}),
      zIndex: gesture.cloneZIndex,
      selected: true,
      dragging,
    };
  });
}
