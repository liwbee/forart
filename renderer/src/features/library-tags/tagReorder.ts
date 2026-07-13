import type { QueryClient, QueryKey } from "@tanstack/react-query";

export interface LibraryTagOrderItem {
  id: string;
  sort_order: number;
}

export interface LibraryTagsQueryData<TTag extends LibraryTagOrderItem> {
  tags: TTag[];
}

function applyTagOrder<TTag extends LibraryTagOrderItem>(tags: TTag[]) {
  return tags.map((tag, index) => ({
    ...tag,
    sort_order: index + 1,
  }));
}

export function getChangedTagOrder<TTag extends LibraryTagOrderItem>(tags: TTag[]) {
  return applyTagOrder(tags).filter((tag, index) => tag.sort_order !== tags[index]?.sort_order);
}

export function setOptimisticTagOrder<TTag extends LibraryTagOrderItem>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  tags: TTag[],
) {
  void queryClient.cancelQueries({ queryKey });
  const previous = queryClient.getQueryData<LibraryTagsQueryData<TTag>>(queryKey);
  queryClient.setQueryData<LibraryTagsQueryData<TTag>>(queryKey, (current) => ({
    ...(current || { tags: [] }),
    tags: applyTagOrder(tags),
  }));
  return previous;
}
