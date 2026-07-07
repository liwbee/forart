export const LIBRARY_TAG_COLORS = ["default", "red", "yellow", "brown", "blue", "green", "purple"] as const;

export type LibraryTagColor = (typeof LIBRARY_TAG_COLORS)[number];

export interface LibraryTagColorLike {
  color?: LibraryTagColor | string | null;
}

export interface LibraryTagNameColorLike extends LibraryTagColorLike {
  name: string;
}

const LIBRARY_TAG_COLOR_SET = new Set<string>(LIBRARY_TAG_COLORS);

export function normalizeLibraryTagColor(value: unknown): LibraryTagColor {
  const next = String(value || "").trim();
  return LIBRARY_TAG_COLOR_SET.has(next) ? (next as LibraryTagColor) : "default";
}

export function createLibraryTagsByName<TTag extends LibraryTagNameColorLike>(tags: readonly TTag[]) {
  return new Map(tags.map((tag) => [tag.name, { ...tag, color: normalizeLibraryTagColor(tag.color) }]));
}
