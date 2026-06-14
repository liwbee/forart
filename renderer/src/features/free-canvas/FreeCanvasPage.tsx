import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Images, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { sortByName } from "../../lib/sortByName";
import { listModelImages, listModelProjects, listModels, listModelTags, modelLibraryKeys } from "../model-library/api";
import { useModelLibraryStore } from "../model-library/modelLibraryStore";
import { getStorageSettings, listOutfitProjects, listOutfits, listOutfitTags, outfitLibraryKeys } from "../outfit-library/api";
import { OutfitComposer } from "../outfit-library/OutfitComposer";
import { useOutfitLibraryStore } from "../outfit-library/outfitLibraryStore";

type FreeCanvasAssetLibrary = "models" | "outfits";

function getRequestError(errors: unknown[]) {
  const first = errors.find(Boolean);
  if (!first) return "";
  return first instanceof Error ? first.message : String(first);
}

export function FreeCanvasPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [assetLibrary, setAssetLibrary] = useState<FreeCanvasAssetLibrary>("outfits");
  const activeOutfitProjectId = useOutfitLibraryStore((state) => state.activeProjectId);
  const activeOutfitTagId = useOutfitLibraryStore((state) => state.activeTagId);
  const setActiveOutfitProjectId = useOutfitLibraryStore((state) => state.setActiveProjectId);
  const setActiveOutfitTagId = useOutfitLibraryStore((state) => state.setActiveTagId);
  const activeModelProjectId = useModelLibraryStore((state) => state.activeProjectId);
  const activeModelTagId = useModelLibraryStore((state) => state.activeTagId);
  const setActiveModelProjectId = useModelLibraryStore((state) => state.setActiveProjectId);
  const setActiveModelTagId = useModelLibraryStore((state) => state.setActiveTagId);

  const storageSettingsQuery = useQuery({
    queryKey: outfitLibraryKeys.storageSettings,
    queryFn: getStorageSettings,
  });

  const storageConfigured = Boolean(storageSettingsQuery.data?.configured);

  const outfitProjectsQuery = useQuery({
    queryKey: outfitLibraryKeys.projects,
    queryFn: listOutfitProjects,
    enabled: storageConfigured,
  });

  const outfitTagsQuery = useQuery({
    queryKey: activeOutfitProjectId ? outfitLibraryKeys.tags(activeOutfitProjectId) : ["outfitTags", "empty"],
    queryFn: () => listOutfitTags(activeOutfitProjectId),
    enabled: storageConfigured && Boolean(activeOutfitProjectId),
  });

  const modelProjectsQuery = useQuery({
    queryKey: modelLibraryKeys.projects,
    queryFn: listModelProjects,
    enabled: storageConfigured,
  });

  const modelTagsQuery = useQuery({
    queryKey: activeModelProjectId ? modelLibraryKeys.tags(activeModelProjectId) : ["modelTags", "empty"],
    queryFn: () => listModelTags(activeModelProjectId),
    enabled: storageConfigured && Boolean(activeModelProjectId),
  });

  const outfitProjects = useMemo(() => outfitProjectsQuery.data?.projects || [], [outfitProjectsQuery.data?.projects]);
  const modelProjects = useMemo(() => modelProjectsQuery.data?.projects || [], [modelProjectsQuery.data?.projects]);

  useEffect(() => {
    if (!activeOutfitProjectId && outfitProjects.length) setActiveOutfitProjectId(outfitProjects[0].id);
    if (activeOutfitProjectId && outfitProjects.length && !outfitProjects.some((project) => project.id === activeOutfitProjectId)) {
      setActiveOutfitProjectId(outfitProjects[0].id);
    }
  }, [activeOutfitProjectId, outfitProjects, setActiveOutfitProjectId]);

  useEffect(() => {
    const tags = outfitTagsQuery.data?.tags || [];
    if (activeOutfitTagId && !tags.some((tag) => tag.id === activeOutfitTagId)) setActiveOutfitTagId("");
  }, [activeOutfitTagId, outfitTagsQuery.data?.tags, setActiveOutfitTagId]);

  useEffect(() => {
    if (!activeModelProjectId && modelProjects.length) setActiveModelProjectId(modelProjects[0].id);
    if (activeModelProjectId && modelProjects.length && !modelProjects.some((project) => project.id === activeModelProjectId)) {
      setActiveModelProjectId(modelProjects[0].id);
    }
  }, [activeModelProjectId, modelProjects, setActiveModelProjectId]);

  useEffect(() => {
    const tags = modelTagsQuery.data?.tags || [];
    if (activeModelTagId && !tags.some((tag) => tag.id === activeModelTagId)) setActiveModelTagId("");
  }, [activeModelTagId, modelTagsQuery.data?.tags, setActiveModelTagId]);

  const outfitsQuery = useQuery({
    queryKey: activeOutfitProjectId ? outfitLibraryKeys.outfits(activeOutfitProjectId, activeOutfitTagId) : ["outfits", "empty"],
    queryFn: () => listOutfits({ projectId: activeOutfitProjectId, tagId: activeOutfitTagId }),
    enabled: storageConfigured && assetLibrary === "outfits" && Boolean(activeOutfitProjectId),
  });

  const modelsQuery = useQuery({
    queryKey: activeModelProjectId ? modelLibraryKeys.models(activeModelProjectId, activeModelTagId) : ["models", "empty"],
    queryFn: () => listModels({ projectId: activeModelProjectId, tagId: activeModelTagId }),
    enabled: storageConfigured && assetLibrary === "models" && Boolean(activeModelProjectId),
  });

  async function loadModelImageChoices(modelId: string) {
    const result = await queryClient.fetchQuery({
      queryKey: modelLibraryKeys.images(modelId),
      queryFn: () => listModelImages(modelId),
    });
    return result.images.map((image) => ({
      id: image.id,
      name: image.caption || image.filename || t("outfitLibrary.modelImage"),
      asset_id: image.asset_id,
      asset_url: image.asset_url,
      updated_at: image.created_at,
    }));
  }

  const outfits = useMemo(() => sortByName(outfitsQuery.data?.outfits || [], (outfit) => outfit.name), [outfitsQuery.data?.outfits]);
  const models = useMemo(() => sortByName(modelsQuery.data?.models || [], (model) => model.name), [modelsQuery.data?.models]);
  const outfitTags = outfitTagsQuery.data?.tags || [];
  const modelTags = modelTagsQuery.data?.tags || [];
  const activeProjects = assetLibrary === "models" ? modelProjects : outfitProjects;
  const activeProjectId = assetLibrary === "models" ? activeModelProjectId : activeOutfitProjectId;
  const activeProject = activeProjects.find((project) => project.id === activeProjectId) || null;
  const composerAssets = assetLibrary === "models"
    ? models.map((model) => ({
      id: model.id,
      name: model.name,
      asset_id: model.cover_asset_id,
      asset_url: model.cover_url,
      updated_at: model.updated_at,
    }))
    : outfits;
  const errorMessage = getRequestError([
    storageSettingsQuery.error,
    outfitProjectsQuery.error,
    outfitTagsQuery.error,
    modelProjectsQuery.error,
    modelTagsQuery.error,
    outfitsQuery.error,
    modelsQuery.error,
  ]);
  const isLoadingProjects = storageSettingsQuery.isLoading || (assetLibrary === "models" ? modelProjectsQuery.isLoading : outfitProjectsQuery.isLoading);

  function handleProjectChange(projectId: string) {
    if (assetLibrary === "models") {
      setActiveModelProjectId(projectId);
    } else {
      setActiveOutfitProjectId(projectId);
    }
  }

  function handleTagChange(tagId: string) {
    if (assetLibrary === "models") {
      setActiveModelTagId(tagId);
    } else {
      setActiveOutfitTagId(tagId);
    }
  }

  return (
    <section className="model-library-page free-canvas-page" aria-label={t("freeCanvas.title")}>
      <div className="free-canvas-toolbar">
        <div className="outfit-view-switch" aria-label={t("freeCanvas.assetLibrary")}> 
          <button
            className={assetLibrary === "outfits" ? "active" : ""}
            type="button"
            aria-pressed={assetLibrary === "outfits"}
            onClick={() => setAssetLibrary("outfits")}
          >
            <Images size={18} aria-hidden="true" />
            <span>{t("outfitLibrary.outfitAssets")}</span>
          </button>
          <button
            className={assetLibrary === "models" ? "active" : ""}
            type="button"
            aria-pressed={assetLibrary === "models"}
            onClick={() => setAssetLibrary("models")}
          >
            <Users size={18} aria-hidden="true" />
            <span>{t("outfitLibrary.modelAssets")}</span>
          </button>
        </div>

        <label className="free-canvas-project-select">
          <span>{t("freeCanvas.project")}</span>
          <select value={activeProjectId} onChange={(event) => handleProjectChange(event.target.value)} disabled={!activeProjects.length}>
            {activeProjects.map((project) => (
              <option key={project.id} value={project.id}>{project.name || t("infiniteCanvas.untitledCanvas")}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="free-canvas-body">
        {errorMessage ? <div className="model-lib-error">{t("freeCanvas.requestFailed", { message: errorMessage })}</div> : null}
        {isLoadingProjects ? <div className="model-lib-empty">{t("common.states.loadingProjects")}</div> : null}
        {!storageConfigured ? <div className="model-lib-empty">{t("outfitLibrary.storageUnavailable")}</div> : null}
        {storageConfigured && !isLoadingProjects && !activeProjects.length ? <div className="model-lib-empty">{t("common.empty.noProjects")}</div> : null}
        {storageConfigured && activeProject ? (
          <OutfitComposer
            assets={composerAssets}
            tags={assetLibrary === "models" ? modelTags : outfitTags}
            activeTagId={assetLibrary === "models" ? activeModelTagId : activeOutfitTagId}
            onTagChange={handleTagChange}
            onLoadAssetChoices={assetLibrary === "models" ? loadModelImageChoices : undefined}
            assetTitle={assetLibrary === "models" ? t("outfitLibrary.modelAssets") : t("outfitLibrary.outfitAssets")}
            assetAltText={assetLibrary === "models" ? t("outfitLibrary.modelImage") : t("outfitLibrary.outfitImage")}
            emptyText={assetLibrary === "models" ? t("outfitLibrary.noFilteredModels") : t("outfitLibrary.noFilteredOutfits")}
            canvasEmptyText={assetLibrary === "models" ? t("outfitLibrary.canvasEmptyModels") : t("outfitLibrary.canvasEmptyOutfits")}
            tagFilterLabel={assetLibrary === "models" ? t("outfitLibrary.filterModelTags") : t("outfitLibrary.filterOutfitTags")}
            cardVariant={assetLibrary === "models" ? "choice" : "direct"}
          />
        ) : null}
      </div>
    </section>
  );
}
