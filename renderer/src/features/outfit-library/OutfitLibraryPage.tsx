import { ChangeEvent, FormEvent, KeyboardEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronRight, Copy, Download, Eye, ImagePlus, MoreHorizontal, Tags, Trash2 } from "lucide-react";
import { createPortal } from "react-dom";
import { ErrorCopyLine } from "../../components/ErrorCopyLine";
import { LazyImage } from "../../components/LazyImage";
import { CollapsibleTagFilterRow } from "../library-tags";
import { LibraryTagChoiceButton } from "../library-tags";
import { ImageViewer } from "../../lib/ImageViewer";
import { LibraryImageActionToast, useLibraryImageActionToast, type LibraryImageActionToastTone } from "../../lib/LibraryImageActionToast";
import { cacheBustedLibraryImageUrl, copyLibraryImage, downloadLibraryOriginalImage } from "../../lib/libraryImageActions";
import { LibraryCardToolbar, sortLibraryItems, useLibraryCardSize, useLibrarySort } from "../resource-library/LibraryCardSizeControl";
import { LibraryImageDropZone } from "../resource-library/LibraryImageDropZone";
import { LibraryBulkActions, LibraryBulkManageButton } from "../resource-library/LibraryBulkActions";
import { VirtualLibraryCardGrid } from "../resource-library/VirtualLibraryCardGrid";
import { LibraryProjectSidebar } from "../library-layout/LibraryProjectSidebar";
import { LibraryTagManagerDialog } from "../library-tags/LibraryTagManagerDialog";
import { useLibraryBulkSelection } from "../resource-library/useLibraryBulkSelection";
import { createLibraryAssetUploadPayload } from "../resource-library/createLibraryAssetUploadPayload";
import {
  bulkOutfitEntries,
  createOutfitProject,
  createOutfitTag,
  deleteOutfit,
  deleteOutfitProject,
  deleteOutfitTag,
  getStorageSettings,
  listOutfitProjects,
  listOutfits,
  listOutfitTags,
  importOutfitEntries,
  outfitLibraryKeys,
  updateOutfit,
  updateOutfitProject,
  updateOutfitTag,
} from "./api";
import { useOutfitLibraryStore } from "./outfitLibraryStore";
import { OutfitEntry, OutfitProject, OutfitTag } from "./types";
import { normalizeTags, toggleTag } from "../library-tags/tagUtils";
import { EMPTY_LIBRARY_TAG_FILTER, applySameColorSingleIncludeFilter, cleanLibraryTagFilter, countLibraryTags, createLibraryTagFilter, createLibraryTagsByName, hasLibraryTagFilter, normalizeLibraryTagColor, toggleLibraryTagFilterInclude, useLibraryTagSettingsStore, type LibraryTagColor, type LibraryTagFilter, type LibraryTagNameColorLike } from "../library-tags";

function getRequestError(errors: unknown[]) {
  const first = errors.find(Boolean);
  if (!first) return "";
  return first instanceof Error ? first.message : String(first);
}

function OutfitToolbar({
  tags,
  tagFilter,
  tagCounts,
  onTagToggle,
  onTagExclude,
  onTagClear,
  onUntaggedToggle,
  selectionMode,
  onEnterSelectionMode,
  onExitSelectionMode,
}: {
  tags: OutfitTag[];
  tagFilter: LibraryTagFilter;
  tagCounts: Record<string, number>;
  onTagToggle: (tagId: string) => void;
  onTagExclude: (tagId: string) => void;
  onTagClear: () => void;
  onUntaggedToggle: () => void;
  selectionMode: boolean;
  onEnterSelectionMode: () => void;
  onExitSelectionMode: () => void;
}) {
  const { t } = useTranslation();
  const includeTagSet = useMemo(() => new Set(tagFilter.includeTagIds), [tagFilter.includeTagIds]);
  const excludeTagSet = useMemo(() => new Set(tagFilter.excludeTagIds), [tagFilter.excludeTagIds]);
  return (
    <div className="library-toolbar outfit-toolbar">
      <div className="library-tag-section">
        <LibraryBulkManageButton disabled={false} onClick={selectionMode ? onExitSelectionMode : onEnterSelectionMode} />
        <span className="library-filter-label">{t("common:labels.tags")}</span>
        <div className="library-tag-controls">
          <CollapsibleTagFilterRow expandLabel="展开标签" collapseLabel="收起标签">
            <div className="library-tag-filter">
              <button className={hasLibraryTagFilter(tagFilter) ? "" : "active"} type="button" onClick={onTagClear}>
                {t("common:labels.all")}
              </button>
              <button className={tagFilter.untaggedOnly ? "active" : ""} type="button" onClick={onUntaggedToggle}>
                {t("common:labels.untagged")}
              </button>
              {tags.map((tag) => (
                <LibraryTagChoiceButton
                  key={tag.id}
                  name={tag.name}
                  color={tag.color}
                  count={tagCounts[tag.id] || 0}
                  included={includeTagSet.has(tag.id)}
                  excluded={excludeTagSet.has(tag.id)}
                  onToggleInclude={() => onTagToggle(tag.id)}
                  onToggleExclude={() => onTagExclude(tag.id)}
                />
              ))}
            </div>
          </CollapsibleTagFilterRow>
        </div>
      </div>
    </div>
  );
}

function AddOutfitCard({ disabled, busy, onCreate }: { disabled: boolean; busy: boolean; onCreate: (file: File) => void }) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onCreate(file);
  }

  return (
    <div className="outfit-add-card">
      <button className="outfit-add-button" type="button" disabled={disabled} onClick={() => inputRef.current?.click()}>
        <ImagePlus size={28} aria-hidden="true" />
        <strong>{busy ? t("common:states.uploading") : t("outfitLibrary:addOutfit")}</strong>
      </button>
      <input ref={inputRef} type="file" accept="image/*" onChange={handleFileChange} hidden />
    </div>
  );
}

function OutfitCard({
  outfit,
  tags,
  tagsByName,
  deleteConfirmOutfitId,
  isDeleting,
  selectionMode,
  selected,
  onToggleTag,
  onToggleSelected,
  onDelete,
  onImageActionStatus,
}: {
  outfit: OutfitEntry;
  tags: OutfitTag[];
  tagsByName: Map<string, LibraryTagNameColorLike>;
  deleteConfirmOutfitId: string;
  isDeleting: boolean;
  selectionMode: boolean;
  selected: boolean;
  onToggleTag: (outfitId: string, tagName: string) => void;
  onToggleSelected: (outfitId: string) => void;
  onDelete: (outfitId: string, isConfirming: boolean) => void;
  onImageActionStatus: (tone: LibraryImageActionToastTone, text: string) => void;
}) {
  const { t } = useTranslation();
  const [menuState, setMenuState] = useState<{ open: boolean; x: number; y: number }>({ open: false, x: 0, y: 0 });
  const [tagMenuState, setTagMenuState] = useState<{ open: boolean; x: number; y: number }>({ open: false, x: 0, y: 0 });
  const [viewerOpen, setViewerOpen] = useState(false);
  const assetUrl = cacheBustedLibraryImageUrl(outfit.asset_url || "", outfit.asset_id);
  const displayUrl = cacheBustedLibraryImageUrl(outfit.thumbnail_url || outfit.asset_url || "", outfit.asset_id);
  const imageAlt = outfit.name || t("outfitLibrary:outfitImage");

  useEffect(() => {
    if (!menuState.open && !tagMenuState.open) return;
    function closeMenu() {
      setMenuState({ open: false, x: 0, y: 0 });
      setTagMenuState({ open: false, x: 0, y: 0 });
    }
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") closeMenu();
    }
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuState.open, tagMenuState.open]);

  function openMenu(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 184;
    const menuMaxHeight = 320;
    const pad = 8;
    const preferredX = rect.right + 8;
    const preferredY = rect.top;
    const x = preferredX + menuWidth <= window.innerWidth - pad ? preferredX : rect.left - menuWidth - 8;
    setMenuState({
      open: true,
      x: Math.max(pad, Math.min(x, window.innerWidth - menuWidth - pad)),
      y: Math.max(pad, Math.min(preferredY, window.innerHeight - menuMaxHeight - pad)),
    });
    setTagMenuState({ open: false, x: 0, y: 0 });
  }

  function toggleTagMenu(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (tagMenuState.open) {
      setTagMenuState({ open: false, x: 0, y: 0 });
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 184;
    const menuMaxHeight = 280;
    const pad = 8;
    const preferredX = rect.right + 8;
    const x = preferredX + menuWidth <= window.innerWidth - pad ? preferredX : rect.left - menuWidth - 8;
    setTagMenuState({
      open: true,
      x: Math.max(pad, Math.min(x, window.innerWidth - menuWidth - pad)),
      y: Math.max(pad, Math.min(rect.top, window.innerHeight - menuMaxHeight - pad)),
    });
  }

  function handleViewImage() {
    if (!assetUrl) return;
    setMenuState({ open: false, x: 0, y: 0 });
    setTagMenuState({ open: false, x: 0, y: 0 });
    setViewerOpen(true);
  }

  async function handleCopyImage() {
    if (!assetUrl) return;
    setMenuState({ open: false, x: 0, y: 0 });
    setTagMenuState({ open: false, x: 0, y: 0 });
    onImageActionStatus("busy", t("common:states.copyingImage"));
    try {
      await copyLibraryImage(assetUrl);
      onImageActionStatus("ready", t("common:states.imageCopied"));
    } catch (error) {
      onImageActionStatus("error", t("common:errors.imageActionFailed", { message: error instanceof Error ? error.message : String(error) }));
    }
  }

  async function handleDownloadOriginalImage() {
    if (!assetUrl) return;
    setMenuState({ open: false, x: 0, y: 0 });
    setTagMenuState({ open: false, x: 0, y: 0 });
    onImageActionStatus("busy", t("common:states.downloadingImage"));
    try {
      await downloadLibraryOriginalImage(assetUrl, outfit.name || `outfit-${outfit.id}`);
      onImageActionStatus("ready", t("common:states.imageDownloadStarted"));
    } catch (error) {
      onImageActionStatus("error", t("common:errors.imageActionFailed", { message: error instanceof Error ? error.message : String(error) }));
    }
  }

  return (
    <div className={`outfit-card${selectionMode ? " selecting" : ""}${selected ? " selected" : ""}`}>
      <div
        className="outfit-card__image"
        role={assetUrl ? "button" : undefined}
        tabIndex={assetUrl ? 0 : undefined}
        aria-label={assetUrl ? t("outfitLibrary:imagePreview", { name: imageAlt }) : undefined}
        onClick={() => {
          if (selectionMode) {
            onToggleSelected(outfit.id);
            return;
          }
          if (assetUrl) setViewerOpen(true);
        }}
        onKeyDown={(event) => {
          if (selectionMode && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            onToggleSelected(outfit.id);
            return;
          }
          if (!assetUrl) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setViewerOpen(true);
          }
        }}
      >
        {displayUrl ? (
          <LazyImage src={displayUrl} alt={imageAlt} draggable={false} onDragStart={(event) => event.preventDefault()} />
        ) : (
          <div className="placeholder">{t("common:empty.noImage")}</div>
        )}
      </div>
      <div className="outfit-card__name" title={outfit.name}>
        {outfit.name}
      </div>
      {outfit.tags.length ? (
        <div className="outfit-card__tags" aria-label={t("outfitLibrary:outfitTags")}>
          {outfit.tags.map((tag) => (
            <span key={tag}>
              <span className={`library-tag-color-dot library-tag-color-dot--${normalizeLibraryTagColor(tagsByName.get(tag)?.color)}`} aria-hidden="true" />
              <span>{tag}</span>
            </span>
          ))}
        </div>
      ) : null}
      <button className="outfit-card__menu-button" type="button" aria-label={t("outfitLibrary:outfitActions")} aria-expanded={menuState.open} disabled={selectionMode} onClick={openMenu}>
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>
      {menuState.open
        ? createPortal(
            <div
              className="outfit-card-menu"
              role="menu"
              style={{ left: menuState.x, top: menuState.y }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button
                className={tagMenuState.open ? "active" : ""}
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={tagMenuState.open}
                onClick={toggleTagMenu}
              >
                <Tags size={16} aria-hidden="true" />
                <span>{t("common:labels.tags")}</span>
                <ChevronRight className="outfit-card-menu__chevron" size={15} aria-hidden="true" />
              </button>
              <button type="button" role="menuitem" disabled={!assetUrl} onClick={handleViewImage}>
                <Eye size={16} aria-hidden="true" />
                <span>{t("common:actions.viewImage")}</span>
              </button>
              <button type="button" role="menuitem" disabled={!assetUrl} onClick={() => void handleDownloadOriginalImage()}>
                <Download size={16} aria-hidden="true" />
                <span>{t("common:actions.downloadOriginalImage")}</span>
              </button>
              <button type="button" role="menuitem" disabled={!assetUrl} onClick={() => void handleCopyImage()}>
                <Copy size={16} aria-hidden="true" />
                <span>{t("common:actions.copyImage")}</span>
              </button>
              <button
                className={deleteConfirmOutfitId === outfit.id ? "danger confirming" : "danger"}
                type="button"
                role="menuitem"
                disabled={isDeleting}
                onClick={() => onDelete(outfit.id, deleteConfirmOutfitId === outfit.id)}
              >
                <Trash2 size={16} aria-hidden="true" />
                <span>{deleteConfirmOutfitId === outfit.id ? t("common:confirm.delete") : t("common:actions.delete")}</span>
              </button>
            </div>,
            document.body,
          )
        : null}
      {tagMenuState.open
        ? createPortal(
            <div
              className="outfit-tag-menu outfit-tag-menu--submenu"
              role="menu"
              aria-label={t("outfitLibrary:chooseTags")}
              style={{ left: tagMenuState.x, top: tagMenuState.y }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {tags.length ? (
                tags.map((tag) => (
                  <button
                    key={tag.id}
                    className={outfit.tags.includes(tag.name) ? "selected" : ""}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={outfit.tags.includes(tag.name)}
                    onClick={() => onToggleTag(outfit.id, tag.name)}
                  >
                    <span className={`library-tag-color-dot library-tag-color-dot--${normalizeLibraryTagColor(tag.color)}`} aria-hidden="true" />
                    <span>{tag.name}</span>
                  </button>
                ))
              ) : (
                <div className="outfit-tag-menu__empty">{t("outfitLibrary:noTags")}</div>
              )}
            </div>,
            document.body,
          )
        : null}
      {viewerOpen && assetUrl ? <ImageViewer src={assetUrl} alt={imageAlt} onClose={() => setViewerOpen(false)} /> : null}
    </div>
  );
}

function OutfitGrid({
  outfits,
  tags,
  creating,
  deletingOutfitId,
  deleteConfirmOutfitId,
  selectionMode,
  selectedIds,
  onCreate,
  onToggleTag,
  onToggleSelected,
  onDelete,
  onImageActionStatus,
}: {
  outfits: OutfitEntry[];
  tags: OutfitTag[];
  creating: boolean;
  deletingOutfitId: string;
  deleteConfirmOutfitId: string;
  selectionMode: boolean;
  selectedIds: Set<string>;
  onCreate: (file: File) => void;
  onToggleTag: (outfitId: string, tagName: string) => void;
  onToggleSelected: (outfitId: string) => void;
  onDelete: (outfitId: string, isConfirming: boolean) => void;
  onImageActionStatus: (tone: LibraryImageActionToastTone, text: string) => void;
}) {
  const cardSize = useLibraryCardSize("outfit");
  const librarySort = useLibrarySort();
  const tagsByName = useMemo(() => createLibraryTagsByName(tags), [tags]);
  return (
    <div className="library-card-size-scope">
      <VirtualLibraryCardGrid
        items={outfits}
        getItemKey={(outfit) => outfit.id}
        style={cardSize.gridStyle}
        renderLeadingItem={!selectionMode ? () => (
          <AddOutfitCard disabled={creating} busy={creating} onCreate={onCreate} />
        ) : undefined}
        renderItem={(outfit) => (
          <OutfitCard
            key={outfit.id}
            outfit={outfit}
            tags={tags}
            tagsByName={tagsByName}
            deleteConfirmOutfitId={deleteConfirmOutfitId}
            isDeleting={deletingOutfitId === outfit.id}
            selectionMode={selectionMode}
            selected={selectedIds.has(outfit.id)}
            onToggleTag={onToggleTag}
            onToggleSelected={onToggleSelected}
            onDelete={onDelete}
            onImageActionStatus={onImageActionStatus}
          />
        )}
      />
      <LibraryCardToolbar
        activePresetId={cardSize.activePresetId}
        activePresetIndex={cardSize.activePresetIndex}
        activePresetLabel={cardSize.activePresetLabel}
        presets={cardSize.presets}
        sortField={librarySort.sortField}
        sortDirection={librarySort.sortDirection}
        onSelectPreset={cardSize.setPresetId}
        onSelectSortField={librarySort.setSortField}
        onSelectSortDirection={librarySort.setSortDirection}
      />
    </div>
  );
}

function CreateProjectDialog({
  isOpen,
  isCreating,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  isCreating: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");

  useEffect(() => {
    if (isOpen) setName("");
  }, [isOpen]);

  if (!isOpen) return null;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit(name);
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-outfit-project-title"
        onSubmit={handleSubmit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog__head">
          <h2 id="create-outfit-project-title">{t("common:labels.newProject")}</h2>
          <p>{t("outfitLibrary:createProjectDescription")}</p>
        </div>
        <label className="dialog-field">
          <span>{t("common:labels.projectName")}</span>
          <input value={name} onChange={(event) => setName(event.target.value)} autoFocus maxLength={120} placeholder={t("outfitLibrary:projectPlaceholder")} />
        </label>
        <div className="dialog__actions">
          <button className="button secondary" type="button" onClick={onClose} disabled={isCreating}>
            {t("common:actions.cancel")}
          </button>
          <button className="button primary" type="submit" disabled={isCreating}>
            {isCreating ? t("common:states.creating") : t("common:actions.create")}
          </button>
        </div>
      </form>
    </div>
  );
}

export function OutfitLibraryPage({ searchQuery = "" }: { searchQuery?: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [renamingProjectId, setRenamingProjectId] = useState("");
  const [deleteConfirmProjectId, setDeleteConfirmProjectId] = useState("");
  const [deleteConfirmOutfitId, setDeleteConfirmOutfitId] = useState("");
  const [deleteConfirmTagId, setDeleteConfirmTagId] = useState("");
  const [closeMenuToken, setCloseMenuToken] = useState(0);
  const { toast: imageActionToast, showToast: showImageActionToast } = useLibraryImageActionToast();
  const activeProjectId = useOutfitLibraryStore((state) => state.activeProjectId);
  const activeTagFilter = useOutfitLibraryStore((state) => state.activeTagFilter);
  const setActiveProjectId = useOutfitLibraryStore((state) => state.setActiveProjectId);
  const setActiveTagFilter = useOutfitLibraryStore((state) => state.setActiveTagFilter);
  const sameColorSingleFilter = useLibraryTagSettingsStore((state) => state.sameColorSingleFilter);
  const setSameColorSingleFilter = useLibraryTagSettingsStore((state) => state.setSameColorSingleFilter);
  const bulkSelection = useLibraryBulkSelection();

  const storageSettingsQuery = useQuery({
    queryKey: outfitLibraryKeys.storageSettings,
    queryFn: getStorageSettings,
  });

  const storageConfigured = Boolean(storageSettingsQuery.data?.configured);

  const projectsQuery = useQuery({
    queryKey: outfitLibraryKeys.projects,
    queryFn: listOutfitProjects,
    enabled: storageConfigured,
  });

  const tagsQuery = useQuery({
    queryKey: activeProjectId ? outfitLibraryKeys.tags(activeProjectId) : ["outfitTags", "empty"],
    queryFn: () => listOutfitTags(activeProjectId),
    enabled: storageConfigured && Boolean(activeProjectId),
  });

  const projects = useMemo(() => projectsQuery.data?.projects || [], [projectsQuery.data?.projects]);

  useEffect(() => {
    if (!activeProjectId && projects.length) setActiveProjectId(projects[0].id);
    if (activeProjectId && projects.length && !projects.some((project) => project.id === activeProjectId)) {
      setActiveProjectId(projects[0].id);
    }
  }, [activeProjectId, projects, setActiveProjectId]);

  useEffect(() => {
    const tags = tagsQuery.data?.tags || [];
    const validFilter = applySameColorSingleIncludeFilter(
      cleanLibraryTagFilter(activeTagFilter, tags.map((tag) => tag.id)),
      tags,
      sameColorSingleFilter,
    );
    if (
      validFilter.includeTagIds.length !== activeTagFilter.includeTagIds.length
      || validFilter.excludeTagIds.length !== activeTagFilter.excludeTagIds.length
      || validFilter.untaggedOnly !== activeTagFilter.untaggedOnly
    ) {
      setActiveTagFilter(validFilter);
    }
  }, [activeTagFilter, sameColorSingleFilter, setActiveTagFilter, tagsQuery.data?.tags]);

  const outfitsQuery = useQuery({
    queryKey: activeProjectId ? outfitLibraryKeys.outfits(activeProjectId, activeTagFilter) : ["outfits", "empty"],
    queryFn: () => listOutfits({ projectId: activeProjectId, tagFilter: activeTagFilter }),
    enabled: Boolean(activeProjectId),
  });

  const createOutfitMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!activeProjectId) throw new Error(t("common:labels.selectProjectFirst"));
      const payload = await createLibraryAssetUploadPayload(file);
      const result = await importOutfitEntries(activeProjectId, [{
        filename: payload.filename,
        relative_path: payload.filename,
        mime_type: payload.mime_type,
        data: payload.data,
        warnings: [],
      }]);
      if (!result.imported[0]) throw new Error(result.failed[0]?.errors?.[0]?.message || t("outfitLibrary:requestFailed", { message: "Import failed" }));
      return result.imported[0];
    },
    onSuccess: async () => {
      if (hasLibraryTagFilter(activeTagFilter)) setActiveTagFilter(EMPTY_LIBRARY_TAG_FILTER);
      setDeleteConfirmOutfitId("");
      await queryClient.invalidateQueries({ queryKey: ["outfits", activeProjectId] });
      await queryClient.invalidateQueries({ queryKey: outfitLibraryKeys.projects });
      await queryClient.invalidateQueries({ queryKey: activeProjectId ? outfitLibraryKeys.tags(activeProjectId) : outfitLibraryKeys.tagRoot });
    },
  });

  const deleteOutfitMutation = useMutation({
    mutationFn: deleteOutfit,
    onSuccess: async () => {
      setDeleteConfirmOutfitId("");
      await queryClient.invalidateQueries({ queryKey: ["outfits", activeProjectId] });
      await queryClient.invalidateQueries({ queryKey: outfitLibraryKeys.projects });
      await queryClient.invalidateQueries({ queryKey: activeProjectId ? outfitLibraryKeys.tags(activeProjectId) : outfitLibraryKeys.tagRoot });
    },
  });

  const updateOutfitTagsMutation = useMutation({
    mutationFn: ({ outfitId, tags }: { outfitId: string; tags: string[] }) => updateOutfit(outfitId, { tags }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["outfits", activeProjectId] });
      await queryClient.invalidateQueries({ queryKey: activeProjectId ? outfitLibraryKeys.tags(activeProjectId) : outfitLibraryKeys.tagRoot });
    },
  });

  const bulkOutfitEntriesMutation = useMutation({
    mutationFn: ({ operation, tags: tagNames }: { operation: "delete" | "add_tags" | "remove_tags"; tags?: string[] }) => {
      if (!activeProjectId) throw new Error(t("common:labels.selectProjectFirst"));
      return bulkOutfitEntries({
        project_id: activeProjectId,
        entry_ids: bulkSelection.selectedIdList,
        operation,
        ...(tagNames ? { tags: tagNames } : {}),
      });
    },
    onSuccess: async (result) => {
      bulkSelection.clearSelection();
      showImageActionToast("ready", t("common:bulk.operationCompleted", { count: result.deleted || result.updated }));
      await queryClient.invalidateQueries({ queryKey: ["outfits", activeProjectId] });
      await queryClient.invalidateQueries({ queryKey: outfitLibraryKeys.projects });
      await queryClient.invalidateQueries({ queryKey: activeProjectId ? outfitLibraryKeys.tags(activeProjectId) : outfitLibraryKeys.tagRoot });
    },
    onError: (error) => {
      showImageActionToast("error", t("common:bulk.operationFailed", { message: error instanceof Error ? error.message : String(error) }));
    },
  });

  const createProjectMutation = useMutation({
    mutationFn: createOutfitProject,
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: outfitLibraryKeys.projects });
      setActiveProjectId(project.id);
      setCreateProjectOpen(false);
    },
  });

  const renameProjectMutation = useMutation({
    mutationFn: ({ projectId, name, sort_order }: { projectId: string; name?: string; sort_order?: number }) => updateOutfitProject(projectId, {
      ...(name !== undefined ? { name } : {}),
      ...(sort_order !== undefined ? { sort_order } : {}),
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: outfitLibraryKeys.projects });
      await queryClient.invalidateQueries({ queryKey: ["outfits", activeProjectId] });
      setRenamingProjectId("");
    },
  });

  const deleteProjectMutation = useMutation({
    mutationFn: deleteOutfitProject,
    onSuccess: async (_result, projectId) => {
      const remaining = projects.filter((project) => project.id !== projectId);
      setDeleteConfirmProjectId("");
      setCloseMenuToken((token) => token + 1);
      if (activeProjectId === projectId) setActiveProjectId(remaining[0]?.id || "");
      await queryClient.invalidateQueries({ queryKey: outfitLibraryKeys.projects });
      await queryClient.invalidateQueries({ queryKey: ["outfits"] });
      await queryClient.invalidateQueries({ queryKey: activeProjectId ? outfitLibraryKeys.tags(activeProjectId) : outfitLibraryKeys.tagRoot });
    },
  });

  const createTagMutation = useMutation({
    mutationFn: (name: string) => {
      if (!activeProjectId) throw new Error(t("common:labels.selectProjectFirst"));
      return createOutfitTag(activeProjectId, name);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: activeProjectId ? outfitLibraryKeys.tags(activeProjectId) : outfitLibraryKeys.tagRoot });
    },
  });

  const updateTagMutation = useMutation({
    mutationFn: ({ tagId, name, sort_order, color }: { tagId: string; name?: string; sort_order?: number; color?: LibraryTagColor }) => {
      if (!activeProjectId) throw new Error(t("common:labels.selectProjectFirst"));
      return updateOutfitTag(activeProjectId, tagId, {
        ...(name !== undefined ? { name } : {}),
        ...(sort_order !== undefined ? { sort_order } : {}),
        ...(color !== undefined ? { color } : {}),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: activeProjectId ? outfitLibraryKeys.tags(activeProjectId) : outfitLibraryKeys.tagRoot });
    },
  });

  const deleteTagMutation = useMutation({
    mutationFn: (tagId: string) => {
      if (!activeProjectId) throw new Error(t("common:labels.selectProjectFirst"));
      return deleteOutfitTag(activeProjectId, tagId);
    },
    onSuccess: async (_result, tagId) => {
      setDeleteConfirmTagId("");
      if (activeTagFilter.includeTagIds.includes(tagId) || activeTagFilter.excludeTagIds.includes(tagId)) {
        setActiveTagFilter(createLibraryTagFilter(
          activeTagFilter.includeTagIds.filter((activeTagId) => activeTagId !== tagId),
          activeTagFilter.excludeTagIds.filter((activeTagId) => activeTagId !== tagId),
        ));
      }
      await queryClient.invalidateQueries({ queryKey: activeProjectId ? outfitLibraryKeys.tags(activeProjectId) : outfitLibraryKeys.tagRoot });
      await queryClient.invalidateQueries({ queryKey: ["outfits", activeProjectId] });
    },
  });

  function submitProjectRename(projectId: string, name: string) {
    const project = projects.find((item) => item.id === projectId);
    const nextName = name.trim();
    if (!project || !nextName || nextName === project.name) {
      setRenamingProjectId("");
      return;
    }
    renameProjectMutation.mutate({ projectId, name: nextName });
  }

  function handleReorderProjects(nextProjects: OutfitProject[]) {
    nextProjects.forEach((project, index) => {
      const nextSortOrder = index + 1;
      if (project.sort_order !== nextSortOrder) {
        renameProjectMutation.mutate({ projectId: project.id, sort_order: nextSortOrder });
      }
    });
  }

  function handleProjectDelete(projectId: string, isConfirming: boolean) {
    if (!isConfirming) {
      setDeleteConfirmProjectId(projectId);
      return;
    }
    deleteProjectMutation.mutate(projectId);
  }

  function handleOutfitDelete(outfitId: string, isConfirming: boolean) {
    if (!isConfirming) {
      setDeleteConfirmOutfitId(outfitId);
      return;
    }
    deleteOutfitMutation.mutate(outfitId);
  }

  function handleToggleOutfitTag(outfitId: string, tagName: string) {
    const outfit = outfits.find((item) => item.id === outfitId);
    if (!outfit) return;
    const nextTags = toggleTag(outfit.tags, tagName);
    updateOutfitTagsMutation.mutate({ outfitId, tags: nextTags });
  }

  function handleCreateTag(name: string) {
    const next = normalizeTags([name])[0];
    if (!next) return;
    createTagMutation.mutate(next);
  }

  function handleRenameTag(tagId: string, name: string) {
    const next = normalizeTags([name])[0];
    if (!next) return;
    updateTagMutation.mutate({ tagId, name: next });
  }

  function handleChangeTagColor(tagId: string, color: LibraryTagColor) {
    const queryKey = activeProjectId ? outfitLibraryKeys.tags(activeProjectId) : outfitLibraryKeys.tagRoot;
    const previous = queryClient.getQueryData<{ tags: OutfitTag[] }>(queryKey);
    queryClient.setQueryData<{ tags: OutfitTag[] }>(queryKey, (current) => current ? {
      tags: current.tags.map((tag) => tag.id === tagId ? { ...tag, color: normalizeLibraryTagColor(color) } : tag),
    } : current);
    updateTagMutation.mutate({ tagId, color }, {
      onError: () => {
        if (previous) queryClient.setQueryData(queryKey, previous);
      },
    });
  }

  function handleReorderTags(nextTags: OutfitTag[]) {
    nextTags.forEach((tag, index) => {
      const nextSortOrder = index + 1;
      if (tag.sort_order !== nextSortOrder) {
        updateTagMutation.mutate({ tagId: tag.id, sort_order: nextSortOrder });
      }
    });
  }

  function handleToggleTagFilter(tagId: string) {
    setActiveTagFilter(toggleLibraryTagFilterInclude(activeTagFilter, tagId, tags, sameColorSingleFilter));
  }

  function handleExcludeTagFilter(tagId: string) {
    setActiveTagFilter(createLibraryTagFilter(
      activeTagFilter.includeTagIds.filter((activeTagId) => activeTagId !== tagId),
      activeTagFilter.excludeTagIds.includes(tagId)
        ? activeTagFilter.excludeTagIds.filter((activeTagId) => activeTagId !== tagId)
        : [...activeTagFilter.excludeTagIds, tagId],
    ));
  }

  function handleToggleUntaggedFilter() {
    setActiveTagFilter(activeTagFilter.untaggedOnly ? EMPTY_LIBRARY_TAG_FILTER : createLibraryTagFilter([], [], true));
  }

  function handleDeleteTag(tagId: string, isConfirming: boolean) {
    if (!isConfirming) {
      setDeleteConfirmTagId(tagId);
      return;
    }
    deleteTagMutation.mutate(tagId);
  }

  const librarySort = useLibrarySort();
  const outfits = useMemo(
    () => sortLibraryItems(outfitsQuery.data?.outfits || [], {
      field: librarySort.sortField,
      direction: librarySort.sortDirection,
    }),
    [librarySort.sortDirection, librarySort.sortField, outfitsQuery.data?.outfits],
  );
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  const filteredOutfits = useMemo(() => {
    if (!normalizedSearchQuery) return outfits;
    return outfits.filter((outfit) => {
      const searchableText = [outfit.name, ...outfit.tags].join(" ").toLocaleLowerCase();
      return searchableText.includes(normalizedSearchQuery);
    });
  }, [outfits, normalizedSearchQuery]);
  const filteredOutfitIds = useMemo(() => filteredOutfits.map((outfit) => outfit.id), [filteredOutfits]);
  useEffect(() => {
    bulkSelection.pruneSelection(filteredOutfitIds);
  }, [bulkSelection.pruneSelection, filteredOutfitIds]);
  useEffect(() => {
    bulkSelection.exitSelectionMode();
  }, [activeProjectId]);
  const tags = tagsQuery.data?.tags || [];
  const tagCounts = useMemo(() => countLibraryTags(filteredOutfits, tags), [filteredOutfits, tags]);
  const activeProject = projects.find((project) => project.id === activeProjectId) || null;
  const errorMessage = getRequestError([
    storageSettingsQuery.error,
    projectsQuery.error,
    tagsQuery.error,
    outfitsQuery.error,
    createOutfitMutation.error,
    deleteOutfitMutation.error,
    updateOutfitTagsMutation.error,
    bulkOutfitEntriesMutation.error,
    createProjectMutation.error,
    renameProjectMutation.error,
    deleteProjectMutation.error,
    createTagMutation.error,
    updateTagMutation.error,
    deleteTagMutation.error,
  ]);

  return (
    <section className="library-page outfit-library-page" aria-label={t("outfitLibrary:title")}>
      <div className="library-layout">
        <LibraryProjectSidebar<OutfitProject>
          projects={projects}
          activeProjectId={activeProjectId}
          canManageProjects={true}
          renamingProjectId={renamingProjectId}
          deleteConfirmProjectId={deleteConfirmProjectId}
          ariaLabel={t("outfitLibrary:projectRail")}
          projectActionsLabel={(name) => t("outfitLibrary:projectActions", { name })}
          onSelect={(projectId) => {
            setDeleteConfirmProjectId("");
            setRenamingProjectId("");
            setActiveProjectId(projectId);
          }}
          onCreateProject={() => setCreateProjectOpen(true)}
          onRenameStart={(projectId) => {
            setDeleteConfirmProjectId("");
            setRenamingProjectId(projectId);
          }}
          onRenameCancel={() => setRenamingProjectId("")}
          onRenameSubmit={submitProjectRename}
          onDeleteProject={handleProjectDelete}
          onReorderProjects={handleReorderProjects}
          closeMenuToken={closeMenuToken}
        />

        <main className="library-content-pane">
          <div className="library-content-head">
            <OutfitToolbar
              tags={tags}
              tagFilter={activeTagFilter}
              tagCounts={tagCounts}
              onTagToggle={handleToggleTagFilter}
              onTagExclude={handleExcludeTagFilter}
              onTagClear={() => setActiveTagFilter(EMPTY_LIBRARY_TAG_FILTER)}
              onUntaggedToggle={handleToggleUntaggedFilter}
              selectionMode={bulkSelection.selectionMode}
              onEnterSelectionMode={bulkSelection.enterSelectionMode}
              onExitSelectionMode={bulkSelection.exitSelectionMode}
            />
          </div>

          <div className="library-body scrollbar-thin-stable">
            {errorMessage ? <ErrorCopyLine className="library-error" text={t("outfitLibrary:requestFailed", { message: errorMessage })} /> : null}
            {storageSettingsQuery.isLoading || projectsQuery.isLoading ? <div className="library-empty">{t("common:states.loadingProjects")}</div> : null}
            {!storageConfigured ? <div className="library-empty">{t("outfitLibrary:storageUnavailable")}</div> : null}
            {storageConfigured && !projectsQuery.isLoading && !projects.length ? <div className="library-empty">{t("common:empty.noProjects")}</div> : null}
            {activeProject ? (
              <LibraryImageDropZone
                disabled={!storageConfigured || createOutfitMutation.isPending}
                label={t("outfitLibrary:dropToAddOutfit")}
                onDropImage={(file) => createOutfitMutation.mutate(file)}
              >
                <OutfitGrid
                  outfits={filteredOutfits}
                  tags={tags}
                  creating={createOutfitMutation.isPending}
                  deletingOutfitId={deleteOutfitMutation.isPending ? deleteOutfitMutation.variables || "" : ""}
                  deleteConfirmOutfitId={deleteConfirmOutfitId}
                  selectionMode={bulkSelection.selectionMode}
                  selectedIds={bulkSelection.selectedIds}
                  onCreate={(file) => createOutfitMutation.mutate(file)}
                  onToggleTag={handleToggleOutfitTag}
                  onToggleSelected={bulkSelection.toggleSelected}
                  onDelete={handleOutfitDelete}
                  onImageActionStatus={showImageActionToast}
                />
              </LibraryImageDropZone>
            ) : null}
          </div>
        </main>
      </div>

      <CreateProjectDialog
        isOpen={createProjectOpen}
        isCreating={createProjectMutation.isPending}
        onClose={() => setCreateProjectOpen(false)}
        onSubmit={(name) => createProjectMutation.mutate(name)}
      />
      <LibraryTagManagerDialog<OutfitTag>
        isOpen={tagManagerOpen}
        tags={tags}
        isCreating={createTagMutation.isPending}
        deleteConfirmTagId={deleteConfirmTagId}
        titleId="outfit-tag-manager-title"
        description={t("outfitLibrary:tagManagerDescription")}
        emptyText={t("outfitLibrary:noTags")}
        onClose={() => setTagManagerOpen(false)}
        onCreateTag={handleCreateTag}
        onRenameTag={handleRenameTag}
        onChangeTagColor={handleChangeTagColor}
        onDeleteTag={handleDeleteTag}
        onReorderTags={handleReorderTags}
        sameColorSingleFilter={sameColorSingleFilter}
        onSameColorSingleFilterChange={setSameColorSingleFilter}
      />
      <LibraryImageActionToast toast={imageActionToast} />
      {activeProject ? (
        <LibraryBulkActions
          selectionMode={bulkSelection.selectionMode}
          selectedCount={bulkSelection.selectedCount}
          totalMatchingCount={filteredOutfits.length}
          tags={tags}
          isBusy={bulkOutfitEntriesMutation.isPending}
          onExitSelectionMode={bulkSelection.exitSelectionMode}
          onSelectMatching={() => bulkSelection.selectMatching(filteredOutfitIds)}
          onClearSelection={bulkSelection.clearSelection}
          onOpenTagManager={() => setTagManagerOpen(true)}
          onAddTags={(tagNames) => bulkOutfitEntriesMutation.mutate({ operation: "add_tags", tags: tagNames })}
          onRemoveTags={(tagNames) => bulkOutfitEntriesMutation.mutate({ operation: "remove_tags", tags: tagNames })}
          onDeleteSelected={() => bulkOutfitEntriesMutation.mutate({ operation: "delete" })}
        />
      ) : null}
    </section>
  );
}

