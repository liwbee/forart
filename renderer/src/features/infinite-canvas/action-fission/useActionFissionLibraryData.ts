import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { actionLibraryKeys, listActionProjects, listActions, listActionTags } from "../../action-library/api";
import type { LibraryTagFilter } from "../../library-tags";
import { firstRequestFailure } from "../../../lib/requestFailure";
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

interface UseActionFissionLibraryDataOptions {
  /** Agent 模式不查询动作库，避免动作库故障影响 Agent 模式。 */
  enabled?: boolean;
}

export function useActionFissionLibraryData(
  state: ActionFissionState,
  options: UseActionFissionLibraryDataOptions = {},
) {
  const enabled = options.enabled !== false;
  const projectsQuery = useQuery({
    queryKey: actionLibraryKeys.projects,
    queryFn: listActionProjects,
    enabled,
  });
  const groups = useMemo(
    () => enabled ? state.rows.flatMap((row) => (row.categoryGroups || []).filter((group) => Boolean(group.actionProjectId))) : [],
    [enabled, state.rows],
  );
  const projectIds = useMemo(
    () => Array.from(new Set(groups.map((group) => group.actionProjectId).filter(Boolean))),
    [groups],
  );
  const querySpecs = useMemo(() => {
    if (!enabled) return [];
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
  }, [enabled, groups]);
  const tagsQueries = useQueries({
    queries: (enabled ? projectIds : []).map((projectId) => ({
      queryKey: actionLibraryKeys.tags(projectId),
      queryFn: () => listActionTags(projectId),
    })),
  });
  const actionsQueries = useQueries({
    queries: (enabled ? querySpecs : []).map((spec) => ({
      queryKey: actionLibraryKeys.actions(spec.projectId, spec.tagFilter),
      queryFn: () => listActions({ projectId: spec.projectId, tagFilter: spec.tagFilter }),
    })),
  });
  const tagsByProject = new Map(projectIds.map((projectId, index) => [projectId, tagsQueries[index]?.data?.tags || []]));
  const actionsByKey = new Map(querySpecs.map((spec, index) => [spec.key, actionsQueries[index]?.data?.actions || []]));
  const loadingByKey = new Map(querySpecs.map((spec, index) => [spec.key, Boolean(actionsQueries[index]?.isLoading)]));
  const failure = firstRequestFailure([
    projectsQuery.error,
    ...tagsQueries.map((query) => query.error),
    ...actionsQueries.map((query) => query.error),
  ]);

  async function retry() {
    await Promise.all([
      projectsQuery.refetch(),
      ...tagsQueries.map((query) => query.refetch()),
      ...actionsQueries.map((query) => query.refetch()),
    ]);
  }

  return {
    projects: enabled ? projectsQuery.data?.projects || [] : [],
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
    isLoading: enabled && (projectsQuery.isLoading
      || tagsQueries.some((query) => query.isLoading)
      || actionsQueries.some((query) => query.isLoading)),
    failure,
    retry,
  };
}
