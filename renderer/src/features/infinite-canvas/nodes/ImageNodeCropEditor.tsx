import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactCrop, { type PercentCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";

import { ImageWithFallback } from "../../../components/ImageWithFallback";
import { cn } from "../../../lib/utils";
import type { CanvasImageCropRect } from "../canvasActions";
import {
  FULL_CROP,
  numericAspect,
  resizeCropToAspect,
  type ImageCropAspect,
} from "../imageCropGeometry";

export type { ImageCropAspect };

interface ImageNodeCropEditorProps {
  src: string;
  fallbackSrc?: string;
  alt: string;
  aspect: ImageCropAspect;
  sourceWidth?: number;
  sourceHeight?: number;
  onSelectionChange: (selection: CanvasImageCropRect | null) => void;
}

export function ImageNodeCropEditor({
  src,
  fallbackSrc,
  alt,
  aspect,
  sourceWidth,
  sourceHeight,
  onSelectionChange,
}: ImageNodeCropEditorProps) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [crop, setCrop] = useState<PercentCrop>(FULL_CROP);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  // 选区的最新值放在 ref 里：切换比例的 effect 只需要依赖 aspect，
  // 不会因为选区自身变化而重复触发（否则会和 ReactCrop 的 onChange 打架）。
  const cropRef = useRef<PercentCrop>(FULL_CROP);
  const onSelectionChangeRef = useRef(onSelectionChange);

  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange;
  }, [onSelectionChange]);

  /**
   * 测量可用区域。ReactCrop 的盒子必须正好等于图片的显示区域：
   * 否则图片会撑出节点（4:3 的图放进 180×120 的节点就会高出一截），底边和四角手柄
   * 落到节点外面，按下去命中的是画布 —— 拖动没反应，还会触发画布框选把裁剪模式顶掉。
   */
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const measure = () => {
      const style = window.getComputedStyle(element);
      const paddingX = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
      const paddingY = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
      setContainerSize({
        width: Math.max(0, element.clientWidth - (Number.isFinite(paddingX) ? paddingX : 0)),
        height: Math.max(0, element.clientHeight - (Number.isFinite(paddingY) ? paddingY : 0)),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const updateCrop = useCallback((nextCrop: PercentCrop) => {
    cropRef.current = nextCrop;
    setCrop(nextCrop);
    // 上报百分比选区：像素换算交给主进程，避免把预览图（可能是缩略图）的坐标系带进裁剪结果。
    onSelectionChangeRef.current({
      unit: "percent",
      x: nextCrop.x,
      y: nextCrop.y,
      width: nextCrop.width,
      height: nextCrop.height,
    });
  }, []);

  // 换比例时保留长边、移动短边，而不是重置回整图居中。
  useEffect(() => {
    const { width, height } = imageSize;
    if (!(width > 0) || !(height > 0)) return;
    updateCrop(resizeCropToAspect(cropRef.current, width, height, aspect));
  }, [aspect, imageSize, updateCrop]);

  const imageAspect = imageSize.width > 0 && imageSize.height > 0 ? imageSize.width / imageSize.height : 0;
  const cropAreaWidth = imageAspect > 0 && containerSize.width > 0 && containerSize.height > 0
    ? Math.max(1, Math.min(containerSize.width, containerSize.height * imageAspect))
    : 0;
  const cropAreaStyle = cropAreaWidth > 0
    ? { width: `${cropAreaWidth}px`, height: `${cropAreaWidth / imageAspect}px` }
    : undefined;
  // 选区还盖着整张图时，拖动它本体是移不动的（上下左右都已经贴边）。
  // 这种情况放开 keepSelection，并在 CSS 里让选区本体不吃指针事件，
  // 于是"在图上随便一拉"就是从零开始框一个新选区（和 PS 一致）。
  const isFullCrop = crop.x <= 0.01 && crop.y <= 0.01 && crop.width >= 99.99 && crop.height >= 99.99;

  return (
    <div
      ref={containerRef}
      className={cn("rf-native-image-crop-editor nodrag nopan nowheel", isFullCrop && "is-full-crop")}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <ReactCrop
        className="rf-native-image-crop-editor__area"
        style={cropAreaStyle}
        crop={crop}
        aspect={imageSize.width > 0 && imageSize.height > 0
          ? numericAspect(aspect, imageSize.width, imageSize.height)
          : undefined}
        keepSelection={!isFullCrop}
        ruleOfThirds
        minWidth={16}
        minHeight={16}
        onChange={(_pixelCrop, percentCrop) => {
          if (!(imageSize.width > 0) || !(imageSize.height > 0)) return;
          // 放开 keepSelection 后，"只点一下不拖"也会报一个零尺寸选区，丢掉它。
          if (percentCrop.width < 1 || percentCrop.height < 1) return;
          updateCrop(percentCrop);
        }}
      >
        <ImageWithFallback
          ref={imageRef}
          src={src}
          fallbackSrc={fallbackSrc}
          alt={alt}
          draggable={false}
          onLoad={(event) => {
            const image = event.currentTarget;
            const nextSize = {
              width: Number(sourceWidth) > 0 ? Number(sourceWidth) : image.naturalWidth,
              height: Number(sourceHeight) > 0 ? Number(sourceHeight) : image.naturalHeight,
            };
            setImageSize(nextSize);
            updateCrop(FULL_CROP);
          }}
        />
      </ReactCrop>
    </div>
  );
}
