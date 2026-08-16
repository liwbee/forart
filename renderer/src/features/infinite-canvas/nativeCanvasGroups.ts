import type { NativeCanvasNode } from "./nativeCanvas";

function nodeDimension(node: NativeCanvasNode, dimension: "width" | "height") {
  const style = node.style && typeof node.style === "object"
    ? node.style as Record<string, unknown>
    : {};
  const measured = dimension === "width" ? node.measured?.width : node.measured?.height;
  const direct = dimension === "width" ? node.width : node.height;
  return Math.max(0, Number(measured || direct || style[dimension] || 0));
}

export function nativeCanvasChildIsOutsideParent(child: NativeCanvasNode, parent: NativeCanvasNode) {
  if (child.parentId !== parent.id) return false;
  const parentWidth = nodeDimension(parent, "width");
  const parentHeight = nodeDimension(parent, "height");
  if (!parentWidth || !parentHeight) return false;
  const centerX = child.position.x + nodeDimension(child, "width") / 2;
  const centerY = child.position.y + nodeDimension(child, "height") / 2;
  return centerX < 0 || centerX > parentWidth || centerY < 0 || centerY > parentHeight;
}

export function detachNativeCanvasNode(child: NativeCanvasNode, parent: NativeCanvasNode) {
  const detached: NativeCanvasNode = {
    ...child,
    dragging: false,
    position: {
      x: parent.position.x + child.position.x,
      y: parent.position.y + child.position.y,
    },
  };
  delete detached.parentId;
  delete detached.extent;
  delete detached.expandParent;
  return detached;
}

export function detachNativeCanvasChildrenOutsideParents(nodes: NativeCanvasNode[], candidateIds: ReadonlySet<string>) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let changed = false;
  const next = nodes.map((node) => {
    if (!candidateIds.has(node.id) || !node.parentId) return node;
    const parent = byId.get(node.parentId);
    if (!parent || !nativeCanvasChildIsOutsideParent(node, parent)) return node;
    changed = true;
    return detachNativeCanvasNode(node, parent);
  });
  return changed ? next : nodes;
}

export function ungroupNativeCanvasNodes(nodes: NativeCanvasNode[], groupId: string) {
  const group = nodes.find((node) => node.id === groupId);
  if (!group) return nodes;
  return nodes
    .filter((node) => node.id !== groupId)
    .map((node) => node.parentId === groupId
      ? { ...detachNativeCanvasNode(node, group), selected: true }
      : node.selected ? { ...node, selected: false } : node);
}

export function prepareNativeCanvasNodesForClipboard(sourceNodes: NativeCanvasNode[], allNodes: NativeCanvasNode[]) {
  const sourceIds = new Set(sourceNodes.map((node) => node.id));
  const allById = new Map(allNodes.map((node) => [node.id, node]));
  return sourceNodes.map((node) => {
    if (!node.parentId || sourceIds.has(node.parentId)) return node;
    const parent = allById.get(node.parentId);
    return parent ? detachNativeCanvasNode(node, parent) : node;
  });
}

export function collectNativeCanvasSubtree(rootId: string, nodes: NativeCanvasNode[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const childrenByParent = new Map<string, NativeCanvasNode[]>();
  nodes.forEach((node) => {
    if (!node.parentId) return;
    const children = childrenByParent.get(node.parentId) || [];
    children.push(node);
    childrenByParent.set(node.parentId, children);
  });
  const result: NativeCanvasNode[] = [];
  const visit = (id: string) => {
    const node = byId.get(id);
    if (!node) return;
    result.push(node);
    childrenByParent.get(id)?.forEach((child) => visit(child.id));
  };
  visit(rootId);
  return result;
}

function isNativeCanvasGroup(node: NativeCanvasNode) {
  return node.type === "groupNode" || node.data.kind === "group";
}

export function expandNativeCanvasGroupSelection(nodes: NativeCanvasNode[]) {
  const selectedGroupIds = new Set(
    nodes.filter((node) => node.selected && isNativeCanvasGroup(node)).map((node) => node.id),
  );
  if (!selectedGroupIds.size) return { nodes, groupIds: [] as string[] };
  const expandedIds = new Set<string>();
  selectedGroupIds.forEach((groupId) => {
    collectNativeCanvasSubtree(groupId, nodes).forEach((node) => {
      if (!isNativeCanvasGroup(node)) expandedIds.add(node.id);
    });
  });
  return {
    nodes: nodes.map((node) => {
      if (isNativeCanvasGroup(node)) return node.selected ? { ...node, selected: false } : node;
      return expandedIds.has(node.id) && !node.selected ? { ...node, selected: true } : node;
    }),
    groupIds: [] as string[],
  };
}

function absoluteNodePosition(node: NativeCanvasNode, byId: ReadonlyMap<string, NativeCanvasNode>) {
  let x = node.position.x;
  let y = node.position.y;
  let parentId = node.parentId;
  while (parentId) {
    const parent = byId.get(parentId);
    if (!parent) break;
    x += parent.position.x;
    y += parent.position.y;
    parentId = parent.parentId;
  }
  return { x, y };
}

export function groupNativeCanvasNodes(
  nodes: NativeCanvasNode[],
  selectedIds: ReadonlySet<string>,
  group: NativeCanvasNode,
) {
  const selectedGroup = { ...group, selected: true };
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const selectedNodes = nodes.filter((node) => selectedIds.has(node.id));
  const detached = new Map(selectedNodes.map((node) => [node.id, {
    ...node,
    parentId: undefined,
    position: absoluteNodePosition(node, byId),
  }]));
  const affectedGroupIds = new Set<string>();
  selectedNodes.forEach((node) => {
    let parentId = node.parentId;
    while (parentId) {
      affectedGroupIds.add(parentId);
      parentId = byId.get(parentId)?.parentId;
    }
  });
  let remainingNodes = nodes.filter((node) => !selectedIds.has(node.id));
  let removedEmptyGroup = true;
  while (removedEmptyGroup) {
    removedEmptyGroup = false;
    remainingNodes = remainingNodes.filter((node) => {
      if (!isNativeCanvasGroup(node) || !affectedGroupIds.has(node.id)) return true;
      if (remainingNodes.some((child) => child.parentId === node.id)) return true;
      removedEmptyGroup = true;
      if (node.parentId) affectedGroupIds.add(node.parentId);
      return false;
    });
  }
  const children = remainingNodes.map((node) => node.selected ? { ...node, selected: false } : node);
  const groupedChildren = selectedNodes.map((node) => {
    const detachedNode = detached.get(node.id)!;
    const child: NativeCanvasNode = {
      ...detachedNode,
      parentId: group.id,
      position: {
        x: detachedNode.position.x - group.position.x,
        y: detachedNode.position.y - group.position.y,
      },
      zIndex: Math.max(1, detachedNode.zIndex || 0),
      selected: false,
    };
    delete child.extent;
    delete child.expandParent;
    return child;
  });
  return [selectedGroup, ...children, ...groupedChildren];
}
