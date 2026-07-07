export function normalizeTags(value: string | string[]): string[] {
  const rawItems = Array.isArray(value) ? value : String(value || "").split(/[,，；;\n]+/);
  const tags: string[] = [];

  for (const item of rawItems) {
    const tag = String(item || "").trim().replace(/\s+/g, " ");
    if (tag && !tags.includes(tag)) tags.push(tag.slice(0, 24));
  }

  return tags;
}

export function toggleTag(tags: string[], tagName: string) {
  const normalized = normalizeTags(tags);
  return normalized.includes(tagName) ? normalized.filter((tag) => tag !== tagName) : normalizeTags([...normalized, tagName]);
}
