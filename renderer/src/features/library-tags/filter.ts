import { normalizeLibraryTagColor, type LibraryTagColorLike } from "./tagColors";

export interface LibraryTagFilter {
  includeTagIds: string[];
  excludeTagIds: string[];
  untaggedOnly: boolean;
}

export const EMPTY_LIBRARY_TAG_FILTER: LibraryTagFilter = {
  includeTagIds: [],
  excludeTagIds: [],
  untaggedOnly: false,
};

export function createLibraryTagFilter(includeTagIds: string[] = [], excludeTagIds: string[] = [], untaggedOnly = false): LibraryTagFilter {
  if (untaggedOnly) {
    return {
      includeTagIds: [],
      excludeTagIds: [],
      untaggedOnly: true,
    };
  }
  return {
    includeTagIds: Array.from(new Set(includeTagIds.filter(Boolean))),
    excludeTagIds: Array.from(new Set(excludeTagIds.filter(Boolean))).filter((tagId) => !includeTagIds.includes(tagId)),
    untaggedOnly: false,
  };
}

export function cleanLibraryTagFilter(filter: LibraryTagFilter, validTagIds: readonly string[]): LibraryTagFilter {
  const valid = new Set(validTagIds);
  return createLibraryTagFilter(
    filter.includeTagIds.filter((tagId) => valid.has(tagId)),
    filter.excludeTagIds.filter((tagId) => valid.has(tagId)),
    filter.untaggedOnly,
  );
}

export function applySameColorSingleIncludeFilter<TTag extends SameColorFilterTagLike>(
  filter: LibraryTagFilter,
  tags: readonly TTag[],
  enabled: boolean,
): LibraryTagFilter {
  if (!enabled || filter.untaggedOnly) return createLibraryTagFilter(filter.includeTagIds, filter.excludeTagIds, filter.untaggedOnly);

  const tagsById = new Map(tags.map((tag) => [tag.id, tag]));
  const seenColors = new Set<string>();
  const reversedIncludeTagIds = [...filter.includeTagIds].reverse();
  const nextIncludeTagIds = reversedIncludeTagIds.filter((tagId) => {
    const color = normalizeLibraryTagColor(tagsById.get(tagId)?.color);
    if (color === "default") return true;
    if (seenColors.has(color)) return false;
    seenColors.add(color);
    return true;
  }).reverse();

  return createLibraryTagFilter(nextIncludeTagIds, filter.excludeTagIds, false);
}

export function createLibraryTagFilterWithSameColorInclude<TTag extends SameColorFilterTagLike>(
  includeTagIds: string[] = [],
  excludeTagIds: string[] = [],
  tags: readonly TTag[] = [],
  sameColorSingleInclude = false,
): LibraryTagFilter {
  return applySameColorSingleIncludeFilter(createLibraryTagFilter(includeTagIds, excludeTagIds), tags, sameColorSingleInclude);
}

export function toggleLibraryTagFilterInclude<TTag extends SameColorFilterTagLike>(
  filter: LibraryTagFilter,
  tagId: string,
  tags: readonly TTag[],
  sameColorSingleInclude: boolean,
): LibraryTagFilter {
  return createLibraryTagFilterWithSameColorInclude(
    filter.includeTagIds.includes(tagId)
      ? filter.includeTagIds.filter((activeTagId) => activeTagId !== tagId)
      : [...filter.includeTagIds, tagId],
    filter.excludeTagIds.filter((activeTagId) => activeTagId !== tagId),
    tags,
    sameColorSingleInclude,
  );
}

export function libraryTagFilterKey(filter: LibraryTagFilter) {
  return [
    [...filter.includeTagIds].sort().join(","),
    [...filter.excludeTagIds].sort().join(","),
    filter.untaggedOnly ? "untagged" : "",
  ].join("|");
}

export function hasLibraryTagFilter(filter: LibraryTagFilter) {
  return Boolean(filter.includeTagIds.length || filter.excludeTagIds.length || filter.untaggedOnly);
}

export function countLibraryTags<T extends { tags: readonly string[] }>(items: readonly T[], tags: readonly LibraryFilterTagLike[]) {
  const tagIdsByName = new Map(tags.map((tag) => [tag.name, tag.id]));
  const counts: Record<string, number> = {};
  tags.forEach((tag) => {
    counts[tag.id] = 0;
  });
  items.forEach((item) => {
    item.tags.forEach((tagName) => {
      const tagId = tagIdsByName.get(tagName);
      if (tagId) counts[tagId] = (counts[tagId] || 0) + 1;
    });
  });
  return counts;
}

interface LibraryFilterTagLike {
  id: string;
  name: string;
}

interface SameColorFilterTagLike extends LibraryTagColorLike {
  id: string;
}
