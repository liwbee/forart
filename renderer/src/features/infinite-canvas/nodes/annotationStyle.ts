import type { CSSProperties } from "react";
import type { NativeCanvasAnnotationStyle } from "../nativeCanvas";

export interface ResolvedAnnotationStyle {
  color?: string;
  fontSize: number;
  bold: boolean;
  textAlign: "left" | "center" | "right";
  lineHeight: number;
}

export function resolveAnnotationStyle(style?: NativeCanvasAnnotationStyle): ResolvedAnnotationStyle {
  const fontSize = Math.max(10, Math.min(120, Math.round(Number(style?.fontSize || 20))));
  const textAlign = style?.textAlign === "center" || style?.textAlign === "right"
    ? style.textAlign
    : "left";
  return {
    color: style?.color || undefined,
    fontSize,
    bold: Boolean(style?.bold),
    textAlign,
    lineHeight: Math.round(fontSize * 1.5),
  };
}

export function annotationTextCss(style: ResolvedAnnotationStyle): CSSProperties {
  return {
    color: style.color,
    fontSize: `${style.fontSize}px`,
    fontWeight: style.bold ? 700 : 500,
    textAlign: style.textAlign,
    lineHeight: `${style.lineHeight}px`,
  };
}
