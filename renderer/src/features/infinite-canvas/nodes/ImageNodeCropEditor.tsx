import { useCallback, useEffect, useRef, useState } from "react";
import ReactCrop, { type PercentCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";

import type { CanvasImageCropRect } from "../canvasActions";

export type ImageCropAspect = "original" | "free" | "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "16:9" | "9:16";

interface ImageNodeCropEditorProps {
  src: string;
  alt: string;
  aspect: ImageCropAspect;
  onSelectionChange: (selection: CanvasImageCropRect | null) => void;
}

function numericAspect(aspect: ImageCropAspect, naturalWidth: number, naturalHeight: number) {
  if (aspect === "free") return undefined;
  if (aspect === "original") return naturalWidth / naturalHeight;
  const [width, height] = aspect.split(":").map(Number);
  return width > 0 && height > 0 ? width / height : undefined;
}

function centeredCrop(naturalWidth: number, naturalHeight: number, aspect: ImageCropAspect): PercentCrop {
  const targetAspect = numericAspect(aspect, naturalWidth, naturalHeight);
  if (!targetAspect) return { unit: "%", x: 0, y: 0, width: 100, height: 100 };

  const sourceAspect = naturalWidth / naturalHeight;
  if (targetAspect >= sourceAspect) {
    const height = (sourceAspect / targetAspect) * 100;
    return { unit: "%", x: 0, y: (100 - height) / 2, width: 100, height };
  }

  const width = (targetAspect / sourceAspect) * 100;
  return { unit: "%", x: (100 - width) / 2, y: 0, width, height: 100 };
}

function naturalCrop(crop: PercentCrop, naturalWidth: number, naturalHeight: number): CanvasImageCropRect {
  const x = Math.max(0, Math.round((crop.x / 100) * naturalWidth));
  const y = Math.max(0, Math.round((crop.y / 100) * naturalHeight));
  const width = Math.max(1, Math.min(naturalWidth - x, Math.round((crop.width / 100) * naturalWidth)));
  const height = Math.max(1, Math.min(naturalHeight - y, Math.round((crop.height / 100) * naturalHeight)));
  return { x, y, width, height };
}

export function ImageNodeCropEditor({ src, alt, aspect, onSelectionChange }: ImageNodeCropEditorProps) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<PercentCrop>();
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });

  const updateCrop = useCallback((nextCrop: PercentCrop, width: number, height: number) => {
    setCrop(nextCrop);
    onSelectionChange(naturalCrop(nextCrop, width, height));
  }, [onSelectionChange]);

  useEffect(() => {
    if (!(imageSize.width > 0) || !(imageSize.height > 0)) return;
    updateCrop(centeredCrop(imageSize.width, imageSize.height, aspect), imageSize.width, imageSize.height);
  }, [aspect, imageSize.height, imageSize.width, updateCrop]);

  return (
    <div
      className="rf-native-image-crop-editor nodrag nopan nowheel"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <ReactCrop
        crop={crop}
        aspect={imageSize.width > 0 && imageSize.height > 0
          ? numericAspect(aspect, imageSize.width, imageSize.height)
          : undefined}
        keepSelection
        ruleOfThirds
        minWidth={16}
        minHeight={16}
        onChange={(_pixelCrop, percentCrop) => {
          if (!(imageSize.width > 0) || !(imageSize.height > 0)) return;
          updateCrop(percentCrop, imageSize.width, imageSize.height);
        }}
      >
        <img
          ref={imageRef}
          src={src}
          alt={alt}
          draggable={false}
          onLoad={(event) => {
            const image = event.currentTarget;
            const nextSize = { width: image.naturalWidth, height: image.naturalHeight };
            setImageSize(nextSize);
            updateCrop(centeredCrop(nextSize.width, nextSize.height, aspect), nextSize.width, nextSize.height);
          }}
        />
      </ReactCrop>
    </div>
  );
}
