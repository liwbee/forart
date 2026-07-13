import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { actionLibraryKeys, listActionProjects, listActions, listActionTags } from "../../action-library/api";
import type { ActionFissionState } from "./actionFissionTypes";

export function useActionFissionLibraryData(state: ActionFissionState) {
  const projectsQuery = useQuery({
    queryKey: actionLibraryKeys.projects,
    queryFn: listActionProjects,
  });
  const projectIds = useMemo(
    () => Array.from(new Set(state.rows.map((row) => row.actionProjectId).filter(Boolean))),
    [state.rows],
  );
  const tagsQueries = useQueries({
    queries: projectIds.map((projectId) => ({
      queryKey: actionLibraryKeys.tags(projectId),
      queryFn: () => listActionTags(projectId),
    })),
  });
  const actionsQueries = useQueries({
    queries: state.rows.map((row) => ({
      queryKey: actionLibraryKeys.actions(row.actionProjectId, {
        includeTagIds: row.includeActionTagIds,
        excludeTagIds: row.excludeActionTagIds,
        untaggedOnly: false,
      }),
      queryFn: () => listActions({
        projectId: row.actionProjectId,
        tagFilter: {
          includeTagIds: row.includeActionTagIds,
          excludeTagIds: row.excludeActionTagIds,
          untaggedOnly: false,
        },
      }),
      enabled: Boolean(row.actionProjectId),
    })),
  });
  const tagsByProject = new Map(projectIds.map((projectId, index) => [projectId, tagsQueries[index]?.data?.tags || []]));

  return {
    projects: projectsQuery.data?.projects || [],
    rowData: state.rows.map((row, index) => ({
      row,
      tags: tagsByProject.get(row.actionProjectId) || [],
      actions: actionsQueries[index]?.data?.actions || [],
      isLoading: Boolean(row.actionProjectId) && (tagsQueries[projectIds.indexOf(row.actionProjectId)]?.isLoading || actionsQueries[index]?.isLoading),
    })),
    isLoading: projectsQuery.isLoading,
  };
}
