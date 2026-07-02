import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { actionLibraryKeys, listActionProjects, listActions, listActionTags } from "../../action-library/api";
import type { ActionEntry, ActionProject, ActionTag } from "../../action-library/types";
import { filterActionsForRow } from "./actionFissionActions";
import type { ActionFissionRow, ActionFissionState } from "./actionFissionTypes";

export interface ActionFissionRowData {
  row: ActionFissionRow;
  tags: ActionTag[];
  actions: ActionEntry[];
  candidates: ActionEntry[];
}

export function useActionFissionLibraryData(state: ActionFissionState): {
  projects: ActionProject[];
  rowData: ActionFissionRowData[];
} {
  const projectsQuery = useQuery({
    queryKey: actionLibraryKeys.projects,
    queryFn: listActionProjects,
  });
  const projects = projectsQuery.data?.projects || [];
  const projectIds = useMemo(() => Array.from(new Set(state.rows.map((row) => row.actionProjectId).filter(Boolean))), [state.rows]);

  const tagsQueries = useQueries({
    queries: projectIds.map((projectId) => ({
      queryKey: actionLibraryKeys.tags(projectId),
      queryFn: () => listActionTags(projectId),
      enabled: Boolean(projectId),
    })),
  });
  const actionsQueries = useQueries({
    queries: projectIds.map((projectId) => ({
      queryKey: actionLibraryKeys.actions(projectId),
      queryFn: () => listActions({ projectId }),
      enabled: Boolean(projectId),
    })),
  });

  const tagsByProject = useMemo(
    () => new Map(projectIds.map((projectId, index) => [projectId, tagsQueries[index]?.data?.tags || []])),
    [projectIds, tagsQueries],
  );
  const actionsByProject = useMemo(
    () => new Map(projectIds.map((projectId, index) => [projectId, actionsQueries[index]?.data?.actions || []])),
    [actionsQueries, projectIds],
  );

  const rowData = useMemo(() => state.rows.map((row) => {
    const tags = tagsByProject.get(row.actionProjectId) || [];
    const actions = actionsByProject.get(row.actionProjectId) || [];
    const candidates = filterActionsForRow(row, actions, tags);
    return { row, tags, actions, candidates };
  }), [actionsByProject, state.rows, tagsByProject]);

  return { projects, rowData };
}
