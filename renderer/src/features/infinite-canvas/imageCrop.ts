import {
  IMAGE_NODE_MAX_HEIGHT,
  IMAGE_NODE_MAX_WIDTH,
  IMAGE_NODE_MIN_HEIGHT,
  IMAGE_NODE_MIN_WIDTH,
  NODE_DEFAULTS,
} from "./constants";
import { clamp } from "./canvasGeometry";
import type { CanvasNode, CropAspectKey, CropRect } from "./types";

export function fitImageNodeSize(naturalWidth: number, naturalHeight: number) {
  if (!naturalWidth || !naturalHeight) return { w: NODE_DEFAULTS.imageLoader.w, h: NODE_DEFAULTS.imageLoader.h };
  let width = naturalWidth;
  let height = naturalHeight;
  const downScale = Math.min(IMAGE_NODE_MAX_WIDTH / width, IMAGE_NODE_MAX_HEIGHT / height, 1);
  width *= downScale;
  height *= downScale;

  if (width < IMAGE_NODE_MIN_WIDTH || height < IMAGE_NODE_MIN_HEIGHT) {
    const upScale = Math.max(IMAGE_NODE_MIN_WIDTH / width, IMAGE_NODE_MIN_HEIGHT / height);
    width *= upScale;
    height *= upScale;
  }

  return { w: Math.round(width), h: Math.round(height) };
}

export function readImageDimensions(url: string) {
  return new Promise<{ width: number; height: number } | null>((resolve) => {
    const image = new window.Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

export function imageContentRect(node: CanvasNode) {
  const naturalW = node.imageNaturalWidth || node.w;
  const naturalH = node.imageNaturalHeight || node.h;
  const imageRatio = naturalW / Math.max(1, naturalH);
  const nodeRatio = node.w / Math.max(1, node.h);
  if (imageRatio > nodeRatio) {
    const h = node.w / imageRatio;
    return { x: 0, y: (node.h - h) / 2, w: node.w, h };
  }
  const w = node.h * imageRatio;
  return { x: (node.w - w) / 2, y: 0, w, h: node.h };
}

export function initialCropRect(node: CanvasNode): CropRect {
  const content = imageContentRect(node);
  return {
    x: Math.round(content.x + content.w * 0.1),
    y: Math.round(content.y + content.h * 0.1),
    w: Math.round(content.w * 0.8),
    h: Math.round(content.h * 0.8),
  };
}

export function cropAspectRatio(aspect: CropAspectKey, node: CanvasNode) {
  if (aspect === "free") return null;
  if (aspect === "original") {
    const naturalW = node.imageNaturalWidth || node.w;
    const naturalH = node.imageNaturalHeight || node.h;
    return naturalW / Math.max(1, naturalH);
  }
  const [w, h] = aspect.split(":").map(Number);
  return w / h;
}

export function constrainCropRect(rect: CropRect, node: CanvasNode, aspect: CropAspectKey = "free") {
  const content = imageContentRect(node);
  const minSize = Math.min(80, Math.max(32, Math.min(content.w, content.h) * 0.2));
  const ratio = cropAspectRatio(aspect, node);
  let w = clamp(rect.w, minSize, content.w);
  let h = clamp(rect.h, minSize, content.h);
  if (ratio) {
    if (w / Math.max(1, h) > ratio) {
      w = h * ratio;
    } else {
      h = w / ratio;
    }
    if (w < minSize) {
      w = minSize;
      h = minSize / ratio;
    }
    if (h < minSize) {
      h = minSize;
      w = minSize * ratio;
    }
    const scale = Math.min(content.w / w, content.h / h, 1);
    w *= scale;
    h *= scale;
  }
  return {
    x: Math.round(clamp(rect.x, content.x, content.x + content.w - w)),
    y: Math.round(clamp(rect.y, content.y, content.y + content.h - h)),
    w: Math.round(w),
    h: Math.round(h),
  };
}

export function constrainCropResizeRect(rect: CropRect, node: CanvasNode, aspect: CropAspectKey = "free") {
  const content = imageContentRect(node);
  const minSize = Math.min(80, Math.max(32, Math.min(content.w, content.h) * 0.2));
  const ratio = cropAspectRatio(aspect, node);
  const maxW = content.x + content.w - rect.x;
  const maxH = content.y + content.h - rect.y;
  if (ratio) {
    let w = rect.w;
    let h = rect.h;
    if (Math.abs(rect.w) >= Math.abs(rect.h * ratio)) {
      h = w / ratio;
    } else {
      w = h * ratio;
    }
    if (w < minSize) {
      w = minSize;
      h = minSize / ratio;
    }
    if (h < minSize) {
      h = minSize;
      w = minSize * ratio;
    }
    const scale = Math.min(maxW / w, maxH / h, 1);
    w *= scale;
    h *= scale;
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.round(w),
      h: Math.round(h),
    };
  }
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    w: Math.round(clamp(rect.w, minSize, maxW)),
    h: Math.round(clamp(rect.h, minSize, maxH)),
  };
}

export function cropRectForAspect(rect: CropRect, node: CanvasNode, aspect: CropAspectKey) {
  const current = constrainCropRect(rect, node, "free");
  const ratio = cropAspectRatio(aspect, node);
  if (!ratio) return current;
  const centerX = current.x + current.w / 2;
  const centerY = current.y + current.h / 2;
  let w = current.w;
  let h = current.h;
  if (w / Math.max(1, h) > ratio) {
    w = h * ratio;
  } else {
    h = w / ratio;
  }
  return constrainCropRect({ x: centerX - w / 2, y: centerY - h / 2, w, h }, node, aspect);
}

export function cropImageToRect(url: string, naturalWidth: number, naturalHeight: number, rect: CropRect, contentRect: CropRect) {
  return new Promise<{ dataUrl: string; width: number; height: number } | null>((resolve) => {
    const image = new window.Image();
    image.onload = () => {
      const scaleX = naturalWidth / Math.max(1, contentRect.w);
      const scaleY = naturalHeight / Math.max(1, contentRect.h);
      const sx = Math.round((rect.x - contentRect.x) * scaleX);
      const sy = Math.round((rect.y - contentRect.y) * scaleY);
      const sw = Math.round(rect.w * scaleX);
      const sh = Math.round(rect.h * scaleY);
      const canvas = document.createElement("canvas");
      canvas.width = sw;
      canvas.height = sh;
      const context = canvas.getContext("2d");
      if (!context) {
        resolve(null);
        return;
      }
      context.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
      resolve({ dataUrl: canvas.toDataURL("image/png"), width: sw, height: sh });
    };
    image.onerror = () => resolve(null);
    image.src = url;
  });
}
