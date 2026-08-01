import type { NativeCanvasNode, NativeCanvasNodeData } from "./nativeCanvas";
import { getImageGeneratorNodeSize, getImageNodeSize } from "./imageNodeSizing";

function positiveNumber(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function resizeAroundCenter(
  node: NativeCanvasNode,
  data: NativeCanvasNodeData,
  size: { width: number; height: number },
): NativeCanvasNode {
  const currentWidth = positiveNumber(node.style?.width) || positiveNumber(node.measured?.width) || size.width;
  const currentHeight = positiveNumber(node.style?.height) || positiveNumber(node.measured?.height) || size.height;
  return {
    ...node,
    data,
    position: {
      x: node.position.x + (currentWidth - size.width) / 2,
      y: node.position.y + (currentHeight - size.height) / 2,
    },
    style: { ...node.style, ...size },
  };
}

export function applyNativeNodeDataPatch(
  node: NativeCanvasNode,
  patch: Partial<NativeCanvasNodeData>,
): NativeCanvasNode {
  const data = { ...node.data, ...patch };
  if (data.kind !== "imageGenerator") return { ...node, data };

  const primary = data.generatedImages?.find((result) => result.localUrl || result.url);
  const resultChanged = Object.prototype.hasOwnProperty.call(patch, "generatedImages");
  const dimensionsChanged = Object.prototype.hasOwnProperty.call(patch, "imageNaturalWidth")
    || Object.prototype.hasOwnProperty.call(patch, "imageNaturalHeight");

  if (primary && (resultChanged || dimensionsChanged)) {
    const width = positiveNumber(primary.width) || positiveNumber(data.imageNaturalWidth);
    const height = positiveNumber(primary.height) || positiveNumber(data.imageNaturalHeight);
    if (width && height) {
      const nextData = { ...data, imageNaturalWidth: width, imageNaturalHeight: height };
      return resizeAroundCenter(node, nextData, getImageNodeSize(width, height));
    }
  }

  if (!primary && Object.prototype.hasOwnProperty.call(patch, "imageAspectRatio")) {
    return resizeAroundCenter(node, data, getImageGeneratorNodeSize(data.imageAspectRatio));
  }

  return { ...node, data };
}
