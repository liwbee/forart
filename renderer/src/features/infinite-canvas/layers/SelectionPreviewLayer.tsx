import { memo } from "react";
import { WORLD_CENTER } from "../canvasGeometry";

export interface SelectionPreviewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SelectionPreviewLayerProps {
  bounds: SelectionPreviewBounds | null;
  isVisible: boolean;
}

export const SelectionPreviewLayer = memo(function SelectionPreviewLayer({ bounds, isVisible }: SelectionPreviewLayerProps) {
  if (!isVisible || !bounds) return null;
  return (
    <div
      className="ic-group-frame ic-group-frame--preview"
      style={{
        left: WORLD_CENTER + bounds.x,
        top: WORLD_CENTER + bounds.y,
        width: bounds.width,
        height: bounds.height,
      }}
    />
  );
});
