import {
  nativeCanvasNodeImages,
  nativeCanvasNodeTaskId,
  type NativeCanvasNode,
  type NativeGenerationResult,
} from "./nativeCanvas";
import { absoluteNodePosition, collectNativeCanvasSubtree } from "./nativeCanvasGroups";

/** 组内某个节点的一张图，按画布阅读顺序排列。 */
export interface GroupImageEntry {
  node: NativeCanvasNode;
  image: NativeGenerationResult;
  imageIndex: number;
  imageCount: number;
}

/**
 * 组图像调节面板里的一项：组内某个节点的一张图。
 * 多图节点（生成结果、动作裂变、批量洗图）会按序号展开成多项。
 */
export interface GroupImageAdjustTarget {
  /** 稳定标识：同一个节点的同一张图始终是同一个 key。 */
  key: string;
  nodeId: string;
  imageIndex: number;
  label: string;
  /** 轨道缩略图；没有缩略图时回退原图。 */
  thumbnailUrl: string;
  /** 正在生成的节点会列出但返回时标记，保存整组时跳过。 */
  taskId: string;
  /** 图片还在导入/处理中，此时调节没有意义。 */
  isAssetLoading: boolean;
}

export function groupImageAdjustTargetKey(nodeId: string, imageIndex: number) {
  return `${nodeId}#${imageIndex}`;
}

function isGroupNode(node: NativeCanvasNode) {
  return node.type === "groupNode" || node.data.kind === "group";
}

/**
 * 收集组内所有图片，按画布上的阅读顺序（先上后下、先左后右）排列。
 * 嵌套子组里的图片也算在内。
 */
export function collectGroupImageEntries(
  nodes: NativeCanvasNode[],
  groupId: string,
): GroupImageEntry[] {
  if (!groupId) return [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return collectNativeCanvasSubtree(groupId, nodes).flatMap((node) => {
    if (isGroupNode(node)) return [];
    const images = nativeCanvasNodeImages(node.data);
    if (!images.length) return [];
    const position = absoluteNodePosition(node, byId);
    return images.map((image, imageIndex) => ({
      // position 只参与排序，最后从结果里剥掉。
      position,
      entry: { node, image, imageIndex, imageCount: images.length } satisfies GroupImageEntry,
    }));
  })
    .sort((left, right) => (
      left.position.y - right.position.y
      || left.position.x - right.position.x
      || left.entry.node.id.localeCompare(right.entry.node.id)
      || left.entry.imageIndex - right.entry.imageIndex
    ))
    .map((item) => item.entry);
}

/** 组图像调节面板的轨道项：图片条目 + 展示用的标签与缩略图。 */
export function collectGroupImageAdjustTargets(
  nodes: NativeCanvasNode[],
  groupId: string,
): GroupImageAdjustTarget[] {
  return collectGroupImageEntries(nodes, groupId).map((entry) => {
    const label = String(entry.node.data.label || "").trim();
    return {
      key: groupImageAdjustTargetKey(entry.node.id, entry.imageIndex),
      nodeId: entry.node.id,
      imageIndex: entry.imageIndex,
      label: entry.imageCount > 1 ? `${label} · ${entry.imageIndex + 1}` : label,
      thumbnailUrl: String(entry.image.thumbUrl || entry.image.localUrl || entry.image.url || ""),
      taskId: nativeCanvasNodeTaskId(entry.node.data),
      isAssetLoading: entry.node.data.assetLoadState === "processing",
    };
  });
}
