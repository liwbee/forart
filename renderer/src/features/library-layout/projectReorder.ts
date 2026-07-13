import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { LibraryProjectSidebarProject } from "./LibraryProjectSidebar";

export interface LibraryProjectsQueryData<TProject extends LibraryProjectSidebarProject> {
  projects: TProject[];
}

function applyProjectOrder<TProject extends LibraryProjectSidebarProject>(projects: TProject[]) {
  return projects.map((project, index) => ({
    ...project,
    sort_order: index + 1,
  }));
}

export function getChangedProjectOrder<TProject extends LibraryProjectSidebarProject>(projects: TProject[]) {
  return applyProjectOrder(projects).filter((project, index) => project.sort_order !== projects[index]?.sort_order);
}

export function setOptimisticProjectOrder<TProject extends LibraryProjectSidebarProject>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  projects: TProject[],
) {
  void queryClient.cancelQueries({ queryKey });
  const previous = queryClient.getQueryData<LibraryProjectsQueryData<TProject>>(queryKey);
  queryClient.setQueryData<LibraryProjectsQueryData<TProject>>(queryKey, (current) => ({
    ...(current || { projects: [] }),
    projects: applyProjectOrder(projects),
  }));
  return previous;
}
