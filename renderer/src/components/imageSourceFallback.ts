export function initialImageSource(primarySource: unknown, fallbackSource: unknown): string {
  return String(primarySource || fallbackSource || "").trim();
}

export function nextImageSourceAfterError(currentSource: unknown, fallbackSource: unknown): string {
  const current = String(currentSource || "").trim();
  const fallback = String(fallbackSource || "").trim();
  return fallback && fallback !== current ? fallback : "";
}
