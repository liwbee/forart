import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { sortByName } from "../../lib/sortByName";
import { listActionProjects, listActions, listActionTags, actionLibraryKeys } from "../action-library/api";
import { useActionLibraryStore } from "../action-library/actionLibraryStore";
import { listModelImages, listModelProjects, listModels, listModelTags, modelLibraryKeys } from "../model-library/api";
import { useModelLibraryStore } from "../model-library/modelLibraryStore";
import { getStorageSettings, listOutfitProjects, listOutfits, listOutfitTags, outfitLibraryKeys } from "../outfit-library/api";
import { useOutfitLibraryStore } from "../outfit-library/outfitLibraryStore";
import type { LibraryAssetItem, LibraryAssetTab } from "./types";

export const defaultLibraryAssetTabs: LibraryAssetTab[] = ["models", "outfits", "actions"];

export function cacheBustedLibraryAssetUrl(url: string, stamp?: string) {
  return stamp ? `${url}?t=${encodeURIComponent(stamp)}` : url;
}

function getRequestError(errors: unknown[]) {
  const first = errors.find(Boolean);
  if (!first) return "";
  return first instanceof Error ? first.message : String(first);
}

function normalizeTabs(tabs?: readonly LibraryAssetTab[]) {
  const normalized = (tabs?.length ? tabs : defaultLibraryAssetTabs).filter((tab, index, list) => list.indexOf(tab) === index);
  return normalized.length ? normalized : defaultLibraryAssetTabs;
}

export function useLibraryAssetPickerData({
  enabled,
  sources,
  initialTab = "outfits",
}: {
  enabled: boolean;
  sources?: readonly LibraryAssetTab[];
  initialTab?: LibraryAssetTab;
}) {
  const queryClient = useQueryClient();
  const availableTabs = useMemo(() => normalizeTabs(sources), [sources]);
  const [activeTab, setActiveTabState] = useState<LibraryAssetTab>(() => (availableTabs.includes(initialTab) ? initialTab : availableTabs[0]));
  const [modelChoiceFor, setModelChoiceFor] = useState<LibraryAssetItem | null>(null);
  const activeOutfitProjectId = useOutfitLibraryStore((state) => state.activeProjectId);
  const setActiveOutfitProjectId = useOutfitLibraryStore((state) => state.setActiveProjectId);
  const activeOutfitTagIds = useOutfitLibraryStore((state) => state.activeTagIds);
  const setActiveOutfitTagIds = useOutfitLibraryStore((state) => state.setActiveTagIds);
  const activeModelProjectId = useModelLibraryStore((state) => state.activeProjectId);
  const setActiveModelProjectId = useModelLibraryStore((state) => state.setActiveProjectId);
  const activeModelTagIds = useModelLibraryStore((state) => state.activeTagIds);
  const setActiveModelTagIds = useModelLibraryStore((state) => state.setActiveTagIds);
  const activeModelGender = useModelLibraryStore((state) => state.activeGender);
  const toggleModelGender = useModelLibraryStore((state) => state.toggleGender);
  const activeActionProjectId = useActionLibraryStore((state) => state.activeProjectId);
  const setActiveActionProjectId = useActionLibraryStore((state) => state.setActiveProjectId);
  const activeActionTagIds = useActionLibraryStore((state) => state.activeTagIds);
  const setActiveActionTagIds = useActionLibraryStore((state) => state.setActiveTagIds);

  useEffect(() => {
    if (!availableTabs.includes(activeTab)) {
      setActiveTabState(availableTabs[0]);
    }
  }, [activeTab, availableTabs]);

  function setActiveTab(tab: LibraryAssetTab) {
    if (!availableTabs.includes(tab)) return;
    setActiveTabState(tab);
  }

  const storageSettingsQuery = useQuery({
    queryKey: outfitLibraryKeys.storageSettings,
    queryFn: getStorageSettings,
    enabled,
  });
  const storageConfigured = Boolean(storageSettingsQuery.data?.configured);
  const canQuery = enabled && storageConfigured;
  const hasModels = availableTabs.includes("models");
  const hasOutfits = availableTabs.includes("outfits");
  const hasActions = availableTabs.includes("actions");

  const outfitProjectsQuery = useQuery({
    queryKey: outfitLibraryKeys.projects,
    queryFn: listOutfitProjects,
    enabled: canQuery && hasOutfits,
  });
  const modelProjectsQuery = useQuery({
    queryKey: modelLibraryKeys.projects,
    queryFn: listModelProjects,
    enabled: canQuery && hasModels,
  });
  const actionProjectsQuery = useQuery({
    queryKey: actionLibraryKeys.projects,
    queryFn: listActionProjects,
    enabled: canQuery && hasActions,
  });

  const outfitProjects = useMemo(() => outfitProjectsQuery.data?.projects || [], [outfitProjectsQuery.data?.projects]);
  const modelProjects = useMemo(() => modelProjectsQuery.data?.projects || [], [modelProjectsQuery.data?.projects]);
  const actionProjects = useMemo(() => actionProjectsQuery.data?.projects || [], [actionProjectsQuery.data?.projects]);

  useEffect(() => {
    if (!enabled || !hasOutfits) return;
    if (!outfitProjects.length) {
      if (activeOutfitProjectId) setActiveOutfitProjectId("");
      return;
    }
    if (!activeOutfitProjectId || !outfitProjects.some((project) => project.id === activeOutfitProjectId)) {
      setActiveOutfitProjectId(outfitProjects[0]?.id || "");
    }
  }, [activeOutfitProjectId, enabled, hasOutfits, outfitProjects, setActiveOutfitProjectId]);

  useEffect(() => {
    if (!enabled || !hasModels) return;
    if (!modelProjects.length) {
      if (activeModelProjectId) setActiveModelProjectId("");
      return;
    }
    if (!activeModelProjectId || !modelProjects.some((project) => project.id === activeModelProjectId)) {
      setActiveModelProjectId(modelProjects[0]?.id || "");
    }
  }, [activeModelProjectId, enabled, hasModels, modelProjects, setActiveModelProjectId]);

  useEffect(() => {
    if (!enabled || !hasActions) return;
    if (!actionProjects.length) {
      if (activeActionProjectId) setActiveActionProjectId("");
      return;
    }
    if (!activeActionProjectId || !actionProjects.some((project) => project.id === activeActionProjectId)) {
      setActiveActionProjectId(actionProjects[0]?.id || "");
    }
  }, [activeActionProjectId, actionProjects, enabled, hasActions, setActiveActionProjectId]);

  const outfitTagsQuery = useQuery({
    queryKey: activeOutfitProjectId ? outfitLibraryKeys.tags(activeOutfitProjectId) : ["outfitTags", "empty"],
    queryFn: () => listOutfitTags(activeOutfitProjectId),
    enabled: canQuery && activeTab === "outfits" && Boolean(activeOutfitProjectId),
  });
  const modelTagsQuery = useQuery({
    queryKey: activeModelProjectId ? modelLibraryKeys.tags(activeModelProjectId) : ["modelTags", "empty"],
    queryFn: () => listModelTags(activeModelProjectId),
    enabled: canQuery && activeTab === "models" && Boolean(activeModelProjectId),
  });
  const actionTagsQuery = useQuery({
    queryKey: activeActionProjectId ? actionLibraryKeys.tags(activeActionProjectId) : ["actionTags", "empty"],
    queryFn: () => listActionTags(activeActionProjectId),
    enabled: canQuery && activeTab === "actions" && Boolean(activeActionProjectId),
  });

  useEffect(() => {
    const tags = outfitTagsQuery.data?.tags || [];
    const validTagIds = activeOutfitTagIds.filter((tagId) => tags.some((tag) => tag.id === tagId));
    if (activeTab === "outfits" && validTagIds.length !== activeOutfitTagIds.length) setActiveOutfitTagIds(validTagIds);
  }, [activeOutfitTagIds, activeTab, outfitTagsQuery.data?.tags, setActiveOutfitTagIds]);

  useEffect(() => {
    const tags = modelTagsQuery.data?.tags || [];
    const validTagIds = activeModelTagIds.filter((tagId) => tags.some((tag) => tag.id === tagId));
    if (activeTab === "models" && validTagIds.length !== activeModelTagIds.length) setActiveModelTagIds(validTagIds);
  }, [activeModelTagIds, activeTab, modelTagsQuery.data?.tags, setActiveModelTagIds]);

  useEffect(() => {
    const tags = actionTagsQuery.data?.tags || [];
    const validTagIds = activeActionTagIds.filter((tagId) => tags.some((tag) => tag.id === tagId));
    if (activeTab === "actions" && validTagIds.length !== activeActionTagIds.length) setActiveActionTagIds(validTagIds);
  }, [activeActionTagIds, activeTab, actionTagsQuery.data?.tags, setActiveActionTagIds]);

  const outfitsQuery = useQuery({
    queryKey: activeOutfitProjectId ? outfitLibraryKeys.outfits(activeOutfitProjectId, activeOutfitTagIds) : ["outfits", "empty", activeOutfitTagIds],
    queryFn: () => listOutfits({ projectId: activeOutfitProjectId, tagIds: activeOutfitTagIds }),
    enabled: canQuery && activeTab === "outfits" && Boolean(activeOutfitProjectId),
  });
  const modelsQuery = useQuery({
    queryKey: activeModelProjectId ? modelLibraryKeys.models(activeModelProjectId, activeModelTagIds, activeModelGender) : ["models", "empty", activeModelTagIds, activeModelGender],
    queryFn: () => listModels({ projectId: activeModelProjectId, tagIds: activeModelTagIds, gender: activeModelGender }),
    enabled: canQuery && activeTab === "models" && Boolean(activeModelProjectId),
  });
  const actionsQuery = useQuery({
    queryKey: activeActionProjectId ? actionLibraryKeys.actions(activeActionProjectId, activeActionTagIds) : ["actions", "empty", activeActionTagIds],
    queryFn: () => listActions({ projectId: activeActionProjectId, tagIds: activeActionTagIds }),
    enabled: canQuery && activeTab === "actions" && Boolean(activeActionProjectId),
  });

  const modelChoicesQuery = useQuery({
    queryKey: modelChoiceFor ? modelLibraryKeys.images(modelChoiceFor.id) : ["modelImages", "empty"],
    queryFn: () => listModelImages(modelChoiceFor!.id),
    enabled: enabled && Boolean(modelChoiceFor),
  });

  const activeProjects = activeTab === "models" ? modelProjects : activeTab === "actions" ? actionProjects : outfitProjects;
  const activeProjectId = activeTab === "models" ? activeModelProjectId : activeTab === "actions" ? activeActionProjectId : activeOutfitProjectId;
  const activeTags = activeTab === "models" ? modelTagsQuery.data?.tags || [] : activeTab === "actions" ? actionTagsQuery.data?.tags || [] : outfitTagsQuery.data?.tags || [];
  const activeTagIds = activeTab === "models" ? activeModelTagIds : activeTab === "actions" ? activeActionTagIds : activeOutfitTagIds;
  const activeItems = useMemo<LibraryAssetItem[]>(() => {
    if (activeTab === "models") {
      return sortByName(modelsQuery.data?.models || [], (model) => model.name).map((model) => ({
        id: model.id,
        name: model.name,
        assetId: model.cover_asset_id,
        url: model.cover_url || "",
        updatedAt: model.updated_at,
        kind: "model",
        needsChoices: true,
      }));
    }
    if (activeTab === "actions") {
      return sortByName(actionsQuery.data?.actions || [], (action) => action.name).map((action) => ({
        id: action.id,
        name: action.name,
        assetId: action.asset_id,
        url: action.asset_url || "",
        updatedAt: action.updated_at,
        kind: "action",
      }));
    }
    return sortByName(outfitsQuery.data?.outfits || [], (outfit) => outfit.name).map((outfit) => ({
      id: outfit.id,
      name: outfit.name,
      assetId: outfit.asset_id,
      url: outfit.asset_url || "",
      updatedAt: outfit.updated_at,
      kind: "outfit",
    }));
  }, [activeTab, actionsQuery.data?.actions, modelsQuery.data?.models, outfitsQuery.data?.outfits]);

  const isLoading = storageSettingsQuery.isLoading
    || (activeTab === "models" ? modelProjectsQuery.isLoading || modelTagsQuery.isLoading || modelsQuery.isLoading
      : activeTab === "actions" ? actionProjectsQuery.isLoading || actionTagsQuery.isLoading || actionsQuery.isLoading
        : outfitProjectsQuery.isLoading || outfitTagsQuery.isLoading || outfitsQuery.isLoading);
  const errorMessage = getRequestError([
    storageSettingsQuery.error,
    outfitProjectsQuery.error,
    modelProjectsQuery.error,
    actionProjectsQuery.error,
    outfitTagsQuery.error,
    modelTagsQuery.error,
    actionTagsQuery.error,
    outfitsQuery.error,
    modelsQuery.error,
    actionsQuery.error,
    modelChoicesQuery.error,
  ]);

  useEffect(() => {
    setModelChoiceFor(null);
  }, [activeTab, activeModelGender, activeModelProjectId, activeModelTagIds]);

  function changeProject(projectId: string) {
    if (activeTab === "models") setActiveModelProjectId(projectId);
    else if (activeTab === "actions") setActiveActionProjectId(projectId);
    else setActiveOutfitProjectId(projectId);
  }

  function changeTag(tagIds: string[]) {
    if (activeTab === "models") setActiveModelTagIds(tagIds);
    else if (activeTab === "actions") setActiveActionTagIds(tagIds);
    else setActiveOutfitTagIds(tagIds);
  }

  function prefetchModelChoices(item: LibraryAssetItem) {
    void queryClient.prefetchQuery({ queryKey: modelLibraryKeys.images(item.id), queryFn: () => listModelImages(item.id) });
  }

  return {
    activeTab,
    setActiveTab,
    availableTabs,
    modelChoiceFor,
    setModelChoiceFor,
    modelChoicesQuery,
    storageConfigured,
    storageSettingsLoading: storageSettingsQuery.isLoading,
    activeProjects,
    activeProjectId,
    activeModelGender,
    activeTags,
    activeTagIds,
    activeItems,
    isLoading,
    errorMessage,
    changeProject,
    changeTag,
    toggleModelGender,
    prefetchModelChoices,
  };
}
