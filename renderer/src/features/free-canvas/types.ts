interface FreeCanvasShapeBase {
  id: string;
  type: "image" | "text";
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
}

export interface FreeCanvasImageItem extends FreeCanvasShapeBase {
  type: "image";
  src: string;
  naturalWidth?: number;
  naturalHeight?: number;
}

export interface FreeCanvasTextItem extends FreeCanvasShapeBase {
  type: "text";
  text: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: number;
  color: string;
  align: "left" | "center" | "right";
  autoSize: boolean;
}

export type FreeCanvasEditorItem = FreeCanvasImageItem | FreeCanvasTextItem;

export interface FreeCanvasDocument {
  items: FreeCanvasEditorItem[];
}

export interface FreeCanvasViewport {
  scale: number;
  x: number;
  y: number;
}

export interface FreeCanvasSize {
  width: number;
  height: number;
}
