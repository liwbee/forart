export function sortByName<T>(items: T[], getName: (item: T) => string | null | undefined) {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftName = (getName(left.item) || "").trim();
      const rightName = (getName(right.item) || "").trim();
      const nameOrder = leftName.localeCompare(rightName, "zh-Hans-CN", {
        numeric: true,
        sensitivity: "base",
      });
      return nameOrder || left.index - right.index;
    })
    .map(({ item }) => item);
}
