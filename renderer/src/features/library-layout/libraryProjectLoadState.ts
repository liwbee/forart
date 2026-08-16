export type LibraryProjectLoadState = "loading" | "error" | "storage-unavailable" | "empty" | "ready";

interface QueryStateSnapshot {
  isPending: boolean;
  isSuccess: boolean;
}

interface LibraryProjectLoadStateInput {
  hasFailure: boolean;
  storageConfigured: boolean;
  storageQuery: QueryStateSnapshot;
  projectsQuery: QueryStateSnapshot;
  projectCount: number;
}

export function getLibraryProjectLoadState({
  hasFailure,
  storageConfigured,
  storageQuery,
  projectsQuery,
  projectCount,
}: LibraryProjectLoadStateInput): LibraryProjectLoadState {
  if (hasFailure) return "error";
  if (storageQuery.isPending) return "loading";
  if (storageQuery.isSuccess && !storageConfigured) return "storage-unavailable";
  if (projectsQuery.isPending) return "loading";
  if (projectsQuery.isSuccess) return projectCount > 0 ? "ready" : "empty";
  return "loading";
}
