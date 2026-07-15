import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { actionLibraryKeys, listActionProjects, listActions, listActionTags } from "../../action-library/api";
import type { LibraryTagFilter } from "../../library-tags";
import type { ActionFissionCategoryGroup, ActionFissionState } from "./actionFissionTypes";

interface GroupQuerySpec {
  key: string;
  projectId: string;
  tagFilter: LibraryTagFilter;
}

function normalizedTagFilter(group: ActionFissionCategoryGroup): LibraryTagFilter {
  return {
    includeTagIds: [...group.includeActionTagIds].sort(),
    excludeTagIds: [...group.excludeActionTagIds].sort(),
    untaggedOnly: false,
  };
}

function groupQueryKey(group: ActionFissionCategoryGroup) {
  return JSON.stringify(actionLibraryKeys.actions(group.actionProjectId, normalizedTagFilter(group)));
}

export function useActionFissionLibraryData(state: ActionFissionState) {
  const projectsQuery = useQuery({
    queryKey: actionLibraryKeys.projects,
    queryFn: listActionProjects,
  });
  const groups = useMemo(
    () => state.rows.flatMap((row) => row.categoryGroups || []),
    [state.rows],
  );
  const projectIds = useMemo(
    () => Array.from(new Set(groups.map((group) => group.actionProjectId).filter(Boolean))),
    [groups],
  );
  const querySpecs = useMemo(() => {
    const unique = new Map<string, GroupQuerySpec>();
    groups.forEach((group) => {
      if (!group.actionProjectId) return;
      const key = groupQueryKey(group);
      if (!unique.has(key)) {
        unique.set(key, {
          key,
          projectId: group.actionProjectId,
          tagFilter: normalizedTagFilter(group),
        });
      }
    });
    return [...unique.values()];
  }, [groups]);
  const tagsQueries = useQueries({
    queries: projectIds.map((projectId) => ({
      queryKey: actionLibraryKeys.tags(projectId),
      queryFn: () => listActionTags(projectId),
    })),
  });
  const actionsQueries = useQueries({
    queries: querySpecs.map((spec) => ({
      queryKey: actionLibraryKeys.actions(spec.projectId, spec.tagFilter),
      queryFn: () => listActions({ projectId: spec.projectId, tagFilter: spec.tagFilter }),
    })),
  });
  const tagsByProject = new Map(projectIds.map((projectId, index) => [projectId, tagsQueries[index]?.data?.tags || []]));
  const actionsByKey = new Map(querySpecs.map((spec, index) => [spec.key, actionsQueries[index]?.data?.actions || []]));
  const loadingByKey = new Map(querySpecs.map((spec, index) => [spec.key, Boolean(actionsQueries[index]?.isLoading)]));

  return {
    projects: projectsQuery.data?.projects || [],
    rowData: state.rows.map((row) => {
      const categoryGroups = (row.categoryGroups || []).map((group) => {
        const key = groupQueryKey(group);
        return {
          group,
          tags: tagsByProject.get(group.actionProjectId) || [],
          actions: group.actionProjectId ? actionsByKey.get(key) || [] : [],
          isLoading: Boolean(group.actionProjectId) && Boolean(
            tagsQueries[projectIds.indexOf(group.actionProjectId)]?.isLoading || loadingByKey.get(key)
          ),
        };
      });
      const selectedGroup = categoryGroups.find(({ group }) => group.id === row.selectedCategoryGroupId) || categoryGroups[0];
      return {
        row,
        categoryGroups,
        tags: selectedGroup?.tags || [],
        actions: selectedGroup?.actions || [],
        isLoading: categoryGroups.some((group) => group.isLoading),
      };
    }),
    isLoading: projectsQuery.isLoading,
  };
}
