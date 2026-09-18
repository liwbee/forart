import type { NativeCanvasNode, NativeCanvasNodeData } from "./nativeCanvas";
import { getImageGeneratorNodeSize, getImageNodeSize } from "./imageNodeSizing";

function positiveNumber(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

/**
 * 生成节点按主图比例调整尺寸时只改尺寸，**绝不移动位置**。
 * 位置由用户掌控：数据补丁（生成结果、下载状态、补写尺寸……）不应该把节点挪走，
 * 展开态下的临时尺寸也不该被当成中心回正的基准。
 */
function resizeKeepingPosition(
  node: NativeCanvasNode,
  data: NativeCanvasNodeData,
  size: { width: number; height: number },
): NativeCanvasNode {
  return { ...node, data, style: { ...node.style, ...size } };
}

export function applyNativeNodeDataPatch(
  node: NativeCanvasNode,
  patch: Partial<NativeCanvasNodeData>,
): NativeCanvasNode {
  const data = { ...node.data, ...patch };
  if (data.kind !== "imageGenerator") return { ...node, data };
  // 展开态下 style 是网格的临时尺寸：数据补丁不插手尺寸，等折叠时由展开逻辑收回去，
  // 否则网格会被挤在"折叠尺寸"的框里，看起来就是折叠/展开尺寸对不上。
  if (data.multiImageExpanded) return { ...node, data };

  const primary = data.generatedImages?.find((result) => result.localUrl || result.url);
  const resultChanged = Object.prototype.hasOwnProperty.call(patch, "generatedImages");
  const dimensionsChanged = Object.prototype.hasOwnProperty.call(patch, "imageNaturalWidth")
    || Object.prototype.hasOwnProperty.call(patch, "imageNaturalHeight");

  if (primary && (resultChanged || dimensionsChanged)) {
    const width = positiveNumber(primary.width) || positiveNumber(data.imageNaturalWidth);
    const height = positiveNumber(primary.height) || positiveNumber(data.imageNaturalHeight);
    if (width && height) {
      const nextData = { ...data, imageNaturalWidth: width, imageNaturalHeight: height };
      return resizeKeepingPosition(node, nextData, getImageNodeSize(width, height));
    }
  }

  if (!primary && (
    Object.prototype.hasOwnProperty.call(patch, "imageAspectRatio")
    || Object.prototype.hasOwnProperty.call(patch, "imageCustomSize")
  )) {
    return resizeKeepingPosition(node, data, getImageGeneratorNodeSize(data.imageCustomSize || data.imageAspectRatio));
  }

  return { ...node, data };
}
