import type { FreeCanvasTextItem } from "../types";

const TEXT_LAYER_MIN_WIDTH = 96;
const TEXT_LAYER_MIN_HEIGHT = 24;
const TEXT_LAYER_PADDING_X = 6;
const TEXT_LAYER_PADDING_Y = 4;

export const TEXT_LAYER_LINE_HEIGHT = 1.25;

let measureElement: HTMLDivElement | null = null;

function getMeasureElement() {
  if (typeof document === "undefined") return null;
  if (measureElement) return measureElement;

  measureElement = document.createElement("div");
  measureElement.setAttribute("aria-hidden", "true");
  measureElement.style.position = "fixed";
  measureElement.style.left = "-10000px";
  measureElement.style.top = "-10000px";
  measureElement.style.zIndex = "-1";
  measureElement.style.visibility = "hidden";
  measureElement.style.pointerEvents = "none";
  measureElement.style.whiteSpace = "pre";
  measureElement.style.display = "inline-block";
  measureElement.style.boxSizing = "content-box";
  measureElement.style.contain = "layout style";
  document.body.appendChild(measureElement);
  return measureElement;
}

export function measureTextLayer(item: Pick<FreeCanvasTextItem, "text" | "fontSize" | "fontFamily" | "fontWeight"> & Partial<Pick<FreeCanvasTextItem, "autoSize" | "width">>) {
  const lineHeight = item.fontSize * TEXT_LAYER_LINE_HEIGHT;
  const lines = item.text.split("\n");
  const fixedWidth = item.autoSize === false && item.width ? Math.max(TEXT_LAYER_MIN_WIDTH, item.width) : null;
  if (typeof document === "undefined") {
    const longestLineLength = Math.max(...lines.map((line) => line.length), 1);
    return {
      width: fixedWidth ?? Math.max(TEXT_LAYER_MIN_WIDTH, Math.ceil(longestLineLength * item.fontSize * 0.6) + TEXT_LAYER_PADDING_X * 2),
      height: Math.max(TEXT_LAYER_MIN_HEIGHT, Math.ceil(lines.length * lineHeight) + TEXT_LAYER_PADDING_Y * 2),
    };
  }

  const element = getMeasureElement();
  if (!element) {
    return {
      width: TEXT_LAYER_MIN_WIDTH,
      height: Math.max(TEXT_LAYER_MIN_HEIGHT, Math.ceil(lineHeight)),
    };
  }

  element.textContent = item.text.endsWith("\n") ? `${item.text}\u00a0` : item.text || " ";
  element.style.fontFamily = item.fontFamily;
  element.style.fontSize = `${item.fontSize}px`;
  element.style.fontWeight = String(item.fontWeight);
  element.style.lineHeight = `${TEXT_LAYER_LINE_HEIGHT}`;
  element.style.whiteSpace = fixedWidth ? "pre-wrap" : "pre";
  element.style.width = fixedWidth ? `${Math.max(1, fixedWidth - TEXT_LAYER_PADDING_X * 2)}px` : "auto";
  element.style.maxWidth = fixedWidth ? `${Math.max(1, fixedWidth - TEXT_LAYER_PADDING_X * 2)}px` : "none";

  const rect = element.getBoundingClientRect();
  const measuredHeight = Math.max(rect.height || lineHeight, lines.length * lineHeight);
  return {
    width: fixedWidth ?? Math.max(TEXT_LAYER_MIN_WIDTH, Math.ceil(rect.width || TEXT_LAYER_MIN_WIDTH) + TEXT_LAYER_PADDING_X * 2),
    height: Math.max(TEXT_LAYER_MIN_HEIGHT, Math.ceil(measuredHeight) + TEXT_LAYER_PADDING_Y * 2),
  };
}
