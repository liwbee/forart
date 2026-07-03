export interface LibraryTagFilter {
  includeTagIds: string[];
  excludeTagIds: string[];
}

export const EMPTY_LIBRARY_TAG_FILTER: LibraryTagFilter = {
  includeTagIds: [],
  excludeTagIds: [],
};

export function createLibraryTagFilter(includeTagIds: string[] = [], excludeTagIds: string[] = []): LibraryTagFilter {
  return {
    includeTagIds: Array.from(new Set(includeTagIds.filter(Boolean))),
    excludeTagIds: Array.from(new Set(excludeTagIds.filter(Boolean))).filter((tagId) => !includeTagIds.includes(tagId)),
  };
}

export function cleanLibraryTagFilter(filter: LibraryTagFilter, validTagIds: readonly string[]): LibraryTagFilter {
  const valid = new Set(validTagIds);
  return createLibraryTagFilter(
    filter.includeTagIds.filter((tagId) => valid.has(tagId)),
    filter.excludeTagIds.filter((tagId) => valid.has(tagId)),
  );
}

export function libraryTagFilterKey(filter: LibraryTagFilter) {
  return [
    [...filter.includeTagIds].sort().join(","),
    [...filter.excludeTagIds].sort().join(","),
  ].join("|");
}

export function hasLibraryTagFilter(filter: LibraryTagFilter) {
  return Boolean(filter.includeTagIds.length || filter.excludeTagIds.length);
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
