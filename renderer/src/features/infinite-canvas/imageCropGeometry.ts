export type ImageCropAspect = "original" | "free" | "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "16:9" | "9:16";

/**
 * 裁剪选区的百分比表示（和 react-image-crop 的 PercentCrop 结构一致）。
 * 单独声明一份是为了让这套几何换算保持零依赖，可以直接被单元测试引用。
 */
export interface PercentCrop {
  unit: "%";
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 刚进入裁剪时的默认选区：整张图（自由比例）。 */
export const FULL_CROP: PercentCrop = { unit: "%", x: 0, y: 0, width: 100, height: 100 };

export function numericAspect(aspect: ImageCropAspect, naturalWidth: number, naturalHeight: number) {
  if (aspect === "free") return undefined;
  if (aspect === "original") return naturalWidth / naturalHeight;
  const [width, height] = aspect.split(":").map(Number);
  return width > 0 && height > 0 ? width / height : undefined;
}

function clampNumber(value: number, min: number, max: number) {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * 切换比例时重排选区：**长边保持像素长度不变**，短边按新比例换算，中心点尽量不动。
 *
 * 以前换比例会把选区重置成"整图居中"，所以每换一次比例都要重新框一遍；
 * 现在以当前选区中心为锚点重新贴合新比例，来回切换不会丢掉已经框好的位置。
 * 自由比例（aspect 为 free）不改变选区，只是放开比例约束。
 */
export function resizeCropToAspect(
  crop: PercentCrop,
  naturalWidth: number,
  naturalHeight: number,
  aspect: ImageCropAspect,
): PercentCrop {
  const targetAspect = numericAspect(aspect, naturalWidth, naturalHeight);
  if (targetAspect === undefined || !(targetAspect > 0) || !(naturalWidth > 0) || !(naturalHeight > 0)) return crop;

  const currentWidth = Math.max(1, (crop.width / 100) * naturalWidth);
  const currentHeight = Math.max(1, (crop.height / 100) * naturalHeight);
  const longEdge = Math.max(currentWidth, currentHeight);
  const isLandscapeCrop = currentWidth >= currentHeight;

  let nextWidth = isLandscapeCrop ? longEdge : longEdge * targetAspect;
  let nextHeight = isLandscapeCrop ? longEdge / targetAspect : longEdge;

  // 换算后超出画布时整体等比缩小，保证选区始终落在图片内部。
  const shrink = Math.min(1, naturalWidth / nextWidth, naturalHeight / nextHeight);
  nextWidth *= shrink;
  nextHeight *= shrink;

  const centerX = ((crop.x + crop.width / 2) / 100) * naturalWidth;
  const centerY = ((crop.y + crop.height / 2) / 100) * naturalHeight;
  const nextX = clampNumber(centerX - nextWidth / 2, 0, naturalWidth - nextWidth);
  const nextY = clampNumber(centerY - nextHeight / 2, 0, naturalHeight - nextHeight);

  return {
    unit: "%",
    x: (nextX / naturalWidth) * 100,
    y: (nextY / naturalHeight) * 100,
    width: (nextWidth / naturalWidth) * 100,
    height: (nextHeight / naturalHeight) * 100,
  };
}
