const ANNOTATION_MIN_WIDTH = 48;
const ANNOTATION_MIN_HEIGHT = 34;
const measureElements = new WeakMap<Document, HTMLDivElement>();

interface AnnotationMeasureStyle {
  fontSize: number;
  lineHeight: number;
  bold: boolean;
  textAlign: "left" | "center" | "right";
}

export function normalizeAnnotationTextForMeasurement(text: string, fallback: string) {
  return String(text || fallback)
    .replace(/\r\n?|\n/g, "\n")
    .split("\n")
    .map((line) => line || " ")
    .join("\n");
}

function getMeasureElement(ownerDocument: Document) {
  const existing = measureElements.get(ownerDocument);
  if (existing?.isConnected) return existing;

  const element = ownerDocument.createElement("div");
  element.className = "rf-native-annotation-measure";
  element.dir = "auto";
  element.tabIndex = -1;
  ownerDocument.body.appendChild(element);
  measureElements.set(ownerDocument, element);
  return element;
}

export function measureAnnotationText(text: string, fallback: string, style: AnnotationMeasureStyle) {
  if (typeof document === "undefined") {
    return { width: ANNOTATION_MIN_WIDTH, height: ANNOTATION_MIN_HEIGHT };
  }

  const element = getMeasureElement(document);
  element.style.fontSize = `${style.fontSize}px`;
  element.style.lineHeight = `${style.lineHeight}px`;
  element.style.fontWeight = style.bold ? "700" : "500";
  element.style.fontStyle = "normal";
  element.style.textAlign = style.textAlign;
  element.textContent = normalizeAnnotationTextForMeasurement(text, fallback);
  const bounds = element.getBoundingClientRect();

  // The extra horizontal pixel prevents fractional glyph widths from wrapping
  // after the two frame-border pixels are removed from the node's content box.
  return {
    width: Math.max(ANNOTATION_MIN_WIDTH, Math.ceil(bounds.width) + 3),
    height: Math.max(ANNOTATION_MIN_HEIGHT, Math.ceil(bounds.height) + 2),
  };
}
