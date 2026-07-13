import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Copy, Download, Eye, FolderPlus, ImagePlus, MoreHorizontal, Tags, Trash2 } from "lucide-react";
import { ErrorCopyLine } from "../../components/ErrorCopyLine";
import { AppScrollArea } from "../../components/AppScrollArea";
import { LazyImage } from "../../components/LazyImage";
import { Button } from "../../components/ui/button";
import { Empty, EmptyDescription } from "../../components/ui/empty";
import { Input } from "../../components/ui/input";
import { Skeleton } from "../../components/ui/skeleton";
import { Textarea } from "../../components/ui/textarea";
import { ConfirmingDropdownMenuItem, DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { CollapsibleTagFilterRow } from "../library-tags";
import { LibraryTagChoiceButton } from "../library-tags";
import { ImageViewer } from "../../lib/ImageViewer";
import { LibraryImageActionToast, useLibraryImageActionToast, type LibraryImageActionToastTone } from "../../lib/LibraryImageActionToast";
import { cacheBustedLibraryImageUrl, copyLibraryImage, downloadLibraryOriginalImage } from "../../lib/libraryImageActions";
import { LibraryCardToolbar, sortLibraryItems, useLibraryCardSize, useLibrarySort } from "../resource-library/LibraryCardSizeControl";
import { LibraryImageDropZone } from "../resource-library/LibraryImageDropZone";
import { LibraryBulkActions, LibraryBulkManageButton } from "../resource-library/LibraryBulkActions";
import { VirtualLibraryCardGrid } from "../resource-library/VirtualLibraryCardGrid";
import { createUniqueLibraryProjectName, LibraryProjectSidebar } from "../library-layout/LibraryProjectSidebar";
import { getChangedProjectOrder, setOptimisticProjectOrder, type LibraryProjectsQueryData } from "../library-layout/projectReorder";
import { LibraryTagManagerDialog } from "../library-tags/LibraryTagManagerDialog";
import { getChangedTagOrder, setOptimisticTagOrder, type LibraryTagsQueryData } from "../library-tags/tagReorder";
import { useLibraryBulkSelection } from "../resource-library/useLibraryBulkSelection";
import { createLibraryAssetUploadPayload } from "../resource-library/createLibraryAssetUploadPayload";
import { normalizeTags, toggleTag } from "../library-tags/tagUtils";
import { EMPTY_LIBRARY_TAG_FILTER, applySameColorSingleIncludeFilter, cleanLibraryTagFilter, countLibraryTags, createLibraryTagFilter, createLibraryTagsByName, hasLibraryTagFilter, normalizeLibraryTagColor, toggleLibraryTagFilterInclude, useLibraryTagSettingsStore, type LibraryTagColor, type LibraryTagFilter, type LibraryTagNameColorLike } from "../library-tags";
import {
  actionLibraryKeys,
  bulkActionEntries,
  createActionProject,
  createActionTag,
  deleteAction,
  deleteActionProject,
  deleteActionTag,
  getStorageSettings,
  listActionProjects,
  listActions,
  listActionTags,
  importActionEntries,
  updateAction,
  updateActionProject,
  updateActionTag,
} from "./api";
import { ActionFolderImportDialog } from "./ActionFolderImportDialog";
import { useActionLibraryStore } from "./actionLibraryStore";
import { ActionEntry, ActionProject, ActionTag } from "./types";

function getRequestError(errors: unknown[]) {
  const first = errors.find(Boolean);
  if (!first) return "";
  return first instanceof Error ? first.message : String(first);
}

function normalizeLibraryName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function isSafeLibraryFileName(value: string) {
  return Boolean(value)
    && value.length <= 80
    && !/[<>:"/\\|?*]/.test(value)
    && Array.from(value).every((character) => character.charCodeAt(0) >= 32)
    && value !== "."
    && value !== ".."
    && !/[ .]$/.test(value);
}

function ActionToolbar({
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
  tags: ActionTag[];
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
          <CollapsibleTagFilterRow expandLabel={t("common:labels.expandTags")} collapseLabel={t("common:labels.collapseTags")}>
            <div className="library-tag-filter">
              <Button className={hasLibraryTagFilter(tagFilter) ? "" : "active"} variant={hasLibraryTagFilter(tagFilter) ? "ghost" : "default"} type="button" onClick={onTagClear}>
                {t("common:labels.all")}
              </Button>
              <Button className={tagFilter.untaggedOnly ? "active" : ""} variant={tagFilter.untaggedOnly ? "default" : "ghost"} type="button" onClick={onUntaggedToggle}>
                {t("common:labels.untagged")}
              </Button>
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

function AddActionCard({ disabled, busy, onCreate, onOpenBulkImport }: { disabled: boolean; busy: boolean; onCreate: (file: File) => void; onOpenBulkImport: () => void }) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onCreate(file);
  }

  return (
    <div className="outfit-add-card action-add-card">
      <Button className="outfit-add-button action-add-card__button" type="button" variant="ghost" disabled={disabled} onClick={() => inputRef.current?.click()}>
        <ImagePlus aria-hidden="true" />
        <strong>{busy ? t("common:states.uploading") : t("actionLibrary:addAction")}</strong>
      </Button>
      <Button className="outfit-add-button action-add-card__button" type="button" variant="ghost" disabled={disabled} onClick={onOpenBulkImport}>
        <FolderPlus aria-hidden="true" />
        <strong>{t("actionLibrary:bulkImportButton")}</strong>
      </Button>
      <input ref={inputRef} type="file" accept="image/*" onChange={handleFileChange} hidden />
    </div>
  );
}

function ActionCard({
  action,
  tags,
  tagsByName,
  isDeleting,
  selectionMode,
  selected,
  onToggleTag,
  onToggleSelected,
  onUpdateDetails,
  onDelete,
  onImageActionStatus,
  renameError,
  onClearRenameError,
}: {
  action: ActionEntry;
  tags: ActionTag[];
  tagsByName: Map<string, LibraryTagNameColorLike>;
  isDeleting: boolean;
  selectionMode: boolean;
  selected: boolean;
  onToggleTag: (actionId: string, tagName: string) => void;
  onToggleSelected: (actionId: string) => void;
  onUpdateDetails: (actionId: string, patch: Partial<Pick<ActionEntry, "name" | "prompt">>) => boolean;
  onDelete: (actionId: string) => void;
  onImageActionStatus: (tone: LibraryImageActionToastTone, text: string) => void;
  renameError: string;
  onClearRenameError: (actionId: string) => void;
}) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [draftName, setDraftName] = useState(action.name || "");
  const [draftPrompt, setDraftPrompt] = useState(action.prompt || "");
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const committedNameRef = useRef(action.name || "");
  const committedPromptRef = useRef(action.prompt || "");
  const assetUrl = cacheBustedLibraryImageUrl(action.asset_url || "", action.asset_id);
  const displayUrl = cacheBustedLibraryImageUrl(action.thumbnail_url || action.asset_url || "", action.asset_id);
  const imageAlt = action.name || t("actionLibrary:actionImage");

  useEffect(() => {
    setDraftName(action.name || "");
    setDraftPrompt(action.prompt || "");
    committedNameRef.current = action.name || "";
    committedPromptRef.current = action.prompt || "";
    onClearRenameError(action.id);
  }, [action.id, action.name, action.prompt]);

  useEffect(() => {
    if (promptOpen) nameInputRef.current?.focus();
  }, [promptOpen]);

  useEffect(() => {
    if (selectionMode) {
      setPromptOpen(false);
      setMenuOpen(false);
    }
  }, [selectionMode]);

  function handleViewImage() {
    if (!assetUrl) return;
    setMenuOpen(false);
    setViewerOpen(true);
  }

  async function handleCopyImage() {
    if (!assetUrl) return;
    setMenuOpen(false);
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
    setMenuOpen(false);
    onImageActionStatus("busy", t("common:states.downloadingImage"));
    try {
      await downloadLibraryOriginalImage(assetUrl, action.name || `action-${action.id}`);
      onImageActionStatus("ready", t("common:states.imageDownloadStarted"));
    } catch (error) {
      onImageActionStatus("error", t("common:errors.imageActionFailed", { message: error instanceof Error ? error.message : String(error) }));
    }
  }

  function commitDetails() {
    const nextName = normalizeLibraryName(draftName);
    const nextPrompt = draftPrompt;
    const patch: Partial<Pick<ActionEntry, "name" | "prompt">> = {};
    if (nextName && nextName !== committedNameRef.current) patch.name = nextName;
    if (nextPrompt !== committedPromptRef.current) patch.prompt = nextPrompt;
    if (!Object.keys(patch).length) {
      if (!nextName) setDraftName(committedNameRef.current);
      return true;
    }
    if (!nextName) setDraftName(committedNameRef.current);
    const accepted = onUpdateDetails(action.id, patch);
    if (accepted && patch.prompt !== undefined) committedPromptRef.current = patch.prompt;
    return accepted;
  }

  function closePromptEditor() {
    if (commitDetails()) setPromptOpen(false);
  }

  return (
    <div className={`outfit-card action-card${promptOpen ? " action-card--flipped" : ""}${selectionMode ? " selecting" : ""}${selected ? " selected" : ""}`}>
      <div className="action-card__flipper">
        <div className="action-card__face action-card__face--front">
          <div
            className="outfit-card__image"
            role="button"
            tabIndex={promptOpen ? -1 : 0}
            aria-label={t("actionLibrary:promptLabel", { name: imageAlt })}
            aria-hidden={promptOpen}
            aria-pressed={promptOpen}
            onClick={() => {
              if (selectionMode) {
                onToggleSelected(action.id);
                return;
              }
              setPromptOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                if (selectionMode) {
                  onToggleSelected(action.id);
                  return;
                }
                setPromptOpen(true);
              }
            }}
          >
            {displayUrl ? (
              <LazyImage src={displayUrl} alt={imageAlt} draggable={false} onDragStart={(event) => event.preventDefault()} />
            ) : (
              <div className="placeholder">{t("common:empty.noImage")}</div>
            )}
          </div>
          <div className="outfit-card__name" title={action.name}>
            {action.name}
          </div>
          {action.tags.length ? (
            <div className="outfit-card__tags" aria-label={t("actionLibrary:actionTags")}>
              {action.tags.map((tag) => (
                <span key={tag}>
                  <span className={`library-tag-color-dot library-tag-color-dot--${normalizeLibraryTagColor(tagsByName.get(tag)?.color)}`} aria-hidden="true" />
                  <span>{tag}</span>
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="action-card__face action-card__face--back" aria-hidden={!promptOpen}>
          <Button className="action-card__back-button" type="button" variant="ghost" size="icon-sm" tabIndex={promptOpen ? 0 : -1} aria-label={t("actionLibrary:backToImage")} title={t("common:actions.back")} onClick={closePromptEditor}>
            <ArrowLeft aria-hidden="true" />
          </Button>
          <label className="action-card__name-field">
            {renameError ? <span className="library-rename-error-popover">{renameError}</span> : null}
            <Input
              ref={nameInputRef}
              className={renameError ? "library-rename-input--error" : undefined}
              value={draftName}
              maxLength={120}
              tabIndex={promptOpen ? 0 : -1}
              aria-label={t("common:labels.name")}
              placeholder={t("common:labels.name")}
              onChange={(event) => {
                onClearRenameError(action.id);
                setDraftName(event.target.value);
              }}
              onBlur={commitDetails}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitDetails();
                  textareaRef.current?.focus();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  closePromptEditor();
                }
              }}
            />
          </label>
          <label className="action-card__prompt-field">
            <Textarea
              ref={textareaRef}
              value={draftPrompt}
              maxLength={4000}
              tabIndex={promptOpen ? 0 : -1}
              placeholder={t("actionLibrary:inputText")}
              onChange={(event) => setDraftPrompt(event.target.value)}
              onBlur={commitDetails}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  closePromptEditor();
                }
              }}
            />
          </label>
        </div>
      </div>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button className="outfit-card__menu-button" type="button" variant="outline" size="icon-lg" aria-label={t("actionLibrary:actionActions")} onClick={(event) => event.stopPropagation()}>
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" sideOffset={8}>
          <DropdownMenuGroup>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Tags size={16} aria-hidden="true" />
                <span>{t("common:labels.tags")}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-72 min-w-44 !overflow-y-auto">
                {tags.length ? (
                  tags.map((tag) => (
                    <DropdownMenuCheckboxItem
                      key={tag.id}
                      className="library-tag-dropdown-item"
                      checked={action.tags.includes(tag.name)}
                      indicatorSide="right"
                      onSelect={(event) => {
                        event.preventDefault();
                        onToggleTag(action.id, tag.name);
                      }}
                      >
                        <span className={`library-tag-color-dot library-tag-color-dot--${normalizeLibraryTagColor(tag.color)}`} aria-hidden="true" />
                        <span className="library-tag-dropdown-item__label">{tag.name}</span>
                      </DropdownMenuCheckboxItem>
                  ))
                ) : (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">{t("actionLibrary:noTags")}</div>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem disabled={!assetUrl} onSelect={handleViewImage}>
              <Eye size={16} aria-hidden="true" />
              <span>{t("common:actions.viewImage")}</span>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!assetUrl} onSelect={() => void handleDownloadOriginalImage()}>
              <Download size={16} aria-hidden="true" />
              <span>{t("common:actions.downloadOriginalImage")}</span>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!assetUrl} onSelect={() => void handleCopyImage()}>
              <Copy size={16} aria-hidden="true" />
              <span>{t("common:actions.copyImage")}</span>
            </DropdownMenuItem>
            <ConfirmingDropdownMenuItem
              disabled={isDeleting}
              onConfirm={() => onDelete(action.id)}
              confirmChildren={(
                <>
                  <Trash2 size={16} aria-hidden="true" />
                  <span>{t("common:confirm.delete")}</span>
                </>
              )}
            >
              <Trash2 size={16} aria-hidden="true" />
              <span>{t("common:actions.delete")}</span>
            </ConfirmingDropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {viewerOpen && assetUrl ? <ImageViewer src={assetUrl} alt={imageAlt} onClose={() => setViewerOpen(false)} /> : null}
    </div>
  );
}

function ActionGrid({
  actions,
  tags,
  scrollElementRef,
  creating,
  deletingActionId,
  selectionMode,
  selectedIds,
  onCreate,
  onOpenBulkImport,
  onToggleTag,
  onToggleSelected,
  onUpdateDetails,
  onDelete,
  onImageActionStatus,
  renameErrors,
  onClearRenameError,
}: {
  actions: ActionEntry[];
  tags: ActionTag[];
  scrollElementRef: { current: HTMLElement | null };
  creating: boolean;
  deletingActionId: string;
  selectionMode: boolean;
  selectedIds: Set<string>;
  onCreate: (file: File) => void;
  onOpenBulkImport: () => void;
  onToggleTag: (actionId: string, tagName: string) => void;
  onToggleSelected: (actionId: string) => void;
  onUpdateDetails: (actionId: string, patch: Partial<Pick<ActionEntry, "name" | "prompt">>) => boolean;
  onDelete: (actionId: string) => void;
  onImageActionStatus: (tone: LibraryImageActionToastTone, text: string) => void;
  renameErrors: Record<string, string>;
  onClearRenameError: (actionId: string) => void;
}) {
  const cardSize = useLibraryCardSize();
  const librarySort = useLibrarySort();
  const tagsByName = useMemo(() => createLibraryTagsByName(tags), [tags]);
  return (
    <div className="library-card-size-scope">
      <VirtualLibraryCardGrid
        items={actions}
        getItemKey={(action) => action.id}
        scrollElementRef={scrollElementRef}
        style={cardSize.gridStyle}
        itemAspectRatio={4 / 3}
        renderLeadingItem={!selectionMode ? () => (
          <AddActionCard disabled={creating} busy={creating} onCreate={onCreate} onOpenBulkImport={onOpenBulkImport} />
        ) : undefined}
        renderItem={(action) => (
          <ActionCard
            key={action.id}
            action={action}
            tags={tags}
            tagsByName={tagsByName}
            isDeleting={deletingActionId === action.id}
            selectionMode={selectionMode}
            selected={selectedIds.has(action.id)}
            onToggleTag={onToggleTag}
            onToggleSelected={onToggleSelected}
            onUpdateDetails={onUpdateDetails}
            onDelete={onDelete}
            onImageActionStatus={onImageActionStatus}
            renameError={renameErrors[action.id] || ""}
            onClearRenameError={onClearRenameError}
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

export function ActionLibraryPage({ searchQuery = "" }: { searchQuery?: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [renamingProjectId, setRenamingProjectId] = useState("");
  const [actionRenameErrors, setActionRenameErrors] = useState<Record<string, string>>({});
  const [closeMenuToken, setCloseMenuToken] = useState(0);
  const { toast: imageActionToast, showToast: showImageActionToast } = useLibraryImageActionToast();
  const activeProjectId = useActionLibraryStore((state) => state.activeProjectId);
  const activeTagFilter = useActionLibraryStore((state) => state.activeTagFilter);
  const setActiveProjectId = useActionLibraryStore((state) => state.setActiveProjectId);
  const setActiveTagFilter = useActionLibraryStore((state) => state.setActiveTagFilter);
  const sameColorSingleFilter = useLibraryTagSettingsStore((state) => state.sameColorSingleFilter);
  const setSameColorSingleFilter = useLibraryTagSettingsStore((state) => state.setSameColorSingleFilter);
  const bulkSelection = useLibraryBulkSelection();

  const storageSettingsQuery = useQuery({
    queryKey: actionLibraryKeys.storageSettings,
    queryFn: getStorageSettings,
  });

  const storageConfigured = Boolean(storageSettingsQuery.data?.configured);

  const projectsQuery = useQuery({
    queryKey: actionLibraryKeys.projects,
    queryFn: listActionProjects,
    enabled: storageConfigured,
  });

  const tagsQuery = useQuery({
    queryKey: activeProjectId ? actionLibraryKeys.tags(activeProjectId) : ["actionTags", "empty"],
    queryFn: () => listActionTags(activeProjectId),
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

  const actionsQuery = useQuery({
    queryKey: activeProjectId ? actionLibraryKeys.actions(activeProjectId, activeTagFilter) : ["actions", "empty"],
    queryFn: () => listActions({ projectId: activeProjectId, tagFilter: activeTagFilter }),
    enabled: Boolean(activeProjectId),
  });

  const allActionsQuery = useQuery({
    queryKey: activeProjectId ? actionLibraryKeys.actions(activeProjectId) : ["actions", "all", "empty"],
    queryFn: () => listActions({ projectId: activeProjectId }),
    enabled: Boolean(activeProjectId),
  });

  const createActionMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!activeProjectId) throw new Error(t("common:labels.selectProjectFirst"));
      const payload = await createLibraryAssetUploadPayload(file);
      const result = await importActionEntries(activeProjectId, [{
        filename: payload.filename,
        relative_path: payload.filename,
        mime_type: payload.mime_type,
        data: payload.data,
        prompt: "",
        warnings: [],
      }]);
      if (!result.imported[0]) throw new Error(result.failed[0]?.errors?.[0]?.message || t("actionLibrary:requestFailed", { message: t("actionLibrary:importFailed") }));
      return result.imported[0];
    },
    onSuccess: async () => {
      if (hasLibraryTagFilter(activeTagFilter)) setActiveTagFilter(EMPTY_LIBRARY_TAG_FILTER);
      await queryClient.invalidateQueries({ queryKey: ["actions", activeProjectId] });
      await queryClient.invalidateQueries({ queryKey: actionLibraryKeys.projects });
      await queryClient.invalidateQueries({ queryKey: activeProjectId ? actionLibraryKeys.tags(activeProjectId) : actionLibraryKeys.tagRoot });
    },
  });

  const deleteActionMutation = useMutation({
    mutationFn: deleteAction,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["actions", activeProjectId] });
      await queryClient.invalidateQueries({ queryKey: actionLibraryKeys.projects });
      await queryClient.invalidateQueries({ queryKey: activeProjectId ? actionLibraryKeys.tags(activeProjectId) : actionLibraryKeys.tagRoot });
    },
  });

  const updateActionTagsMutation = useMutation({
    mutationFn: ({ actionId, tags }: { actionId: string; tags: string[] }) => updateAction(actionId, { tags }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["actions", activeProjectId] });
      await queryClient.invalidateQueries({ queryKey: activeProjectId ? actionLibraryKeys.tags(activeProjectId) : actionLibraryKeys.tagRoot });
    },
  });

  const updateActionDetailsMutation = useMutation({
    mutationFn: ({ actionId, patch }: { actionId: string; patch: Partial<Pick<ActionEntry, "name" | "prompt">> }) => updateAction(actionId, patch),
    onSuccess: async (_result, variables) => {
      setActionRenameErrors((errors) => {
        const next = { ...errors };
        delete next[variables.actionId];
        return next;
      });
      await queryClient.invalidateQueries({ queryKey: ["actions", activeProjectId] });
    },
    onError: (error, variables) => {
      if (!variables.patch.name) return;
      setActionRenameErrors((errors) => ({
        ...errors,
        [variables.actionId]: error instanceof Error ? error.message : String(error),
      }));
    },
  });

  const bulkActionEntriesMutation = useMutation({
    mutationFn: ({ operation, tags: tagNames }: { operation: "delete" | "add_tags" | "remove_tags"; tags?: string[] }) => {
      if (!activeProjectId) throw new Error(t("common:labels.selectProjectFirst"));
      return bulkActionEntries({
        project_id: activeProjectId,
        entry_ids: bulkSelection.selectedIdList,
        operation,
        ...(tagNames ? { tags: tagNames } : {}),
      });
    },
    onSuccess: async (result) => {
      bulkSelection.clearSelection();
      showImageActionToast("ready", t("common:bulk.operationCompleted", { count: result.deleted || result.updated }));
      await queryClient.invalidateQueries({ queryKey: ["actions", activeProjectId] });
      await queryClient.invalidateQueries({ queryKey: actionLibraryKeys.projects });
      await queryClient.invalidateQueries({ queryKey: activeProjectId ? actionLibraryKeys.tags(activeProjectId) : actionLibraryKeys.tagRoot });
    },
    onError: (error) => {
      showImageActionToast("error", t("common:bulk.operationFailed", { message: error instanceof Error ? error.message : String(error) }));
    },
  });

  const createProjectMutation = useMutation({
    mutationFn: createActionProject,
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: actionLibraryKeys.projects });
      setActiveProjectId(project.id);
      setRenamingProjectId(project.id);
    },
  });

  const renameProjectMutation = useMutation({
    mutationFn: ({ projectId, name, sort_order }: { projectId: string; name?: string; sort_order?: number }) => updateActionProject(projectId, {
      ...(name !== undefined ? { name } : {}),
      ...(sort_order !== undefined ? { sort_order } : {}),
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: actionLibraryKeys.projects });
      await queryClient.invalidateQueries({ queryKey: ["actions", activeProjectId] });
      setRenamingProjectId("");
    },
  });

  const reorderProjectsMutation = useMutation({
    mutationFn: async (nextProjects: ActionProject[]) => {
      await Promise.all(getChangedProjectOrder(nextProjects).map((project) => updateActionProject(project.id, { sort_order: project.sort_order })));
    },
    onMutate: (nextProjects) => setOptimisticProjectOrder(queryClient, actionLibraryKeys.projects, nextProjects),
    onError: (_error, _nextProjects, previous) => {
      if (previous) queryClient.setQueryData<LibraryProjectsQueryData<ActionProject>>(actionLibraryKeys.projects, previous);
    },
    onSettled: async (_data, error) => {
      await queryClient.invalidateQueries({ queryKey: actionLibraryKeys.projects, refetchType: error ? "active" : "none" });
    },
  });

  const deleteProjectMutation = useMutation({
    mutationFn: deleteActionProject,
    onSuccess: async (_result, projectId) => {
      const remaining = projects.filter((project) => project.id !== projectId);
      setCloseMenuToken((token) => token + 1);
      if (activeProjectId === projectId) setActiveProjectId(remaining[0]?.id || "");
      await queryClient.invalidateQueries({ queryKey: actionLibraryKeys.projects });
      await queryClient.invalidateQueries({ queryKey: ["actions"] });
      await queryClient.invalidateQueries({ queryKey: activeProjectId ? actionLibraryKeys.tags(activeProjectId) : actionLibraryKeys.tagRoot });
    },
  });

  const createTagMutation = useMutation({
    mutationFn: (name: string) => {
      if (!activeProjectId) throw new Error(t("common:labels.selectProjectFirst"));
      return createActionTag(activeProjectId, name);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: activeProjectId ? actionLibraryKeys.tags(activeProjectId) : actionLibraryKeys.tagRoot });
    },
  });

  const updateTagMutation = useMutation({
    mutationFn: ({ tagId, name, sort_order, color }: { tagId: string; name?: string; sort_order?: number; color?: LibraryTagColor }) => {
      if (!activeProjectId) throw new Error(t("common:labels.selectProjectFirst"));
      return updateActionTag(activeProjectId, tagId, {
        ...(name !== undefined ? { name } : {}),
        ...(sort_order !== undefined ? { sort_order } : {}),
        ...(color !== undefined ? { color } : {}),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: activeProjectId ? actionLibraryKeys.tags(activeProjectId) : actionLibraryKeys.tagRoot });
    },
  });

  const reorderTagsMutation = useMutation({
    mutationFn: async ({ projectId, tags: nextTags }: { projectId: string; tags: ActionTag[] }) => {
      await Promise.all(getChangedTagOrder(nextTags).map((tag) => updateActionTag(projectId, tag.id, { sort_order: tag.sort_order })));
    },
    onMutate: ({ projectId, tags: nextTags }) => setOptimisticTagOrder(queryClient, actionLibraryKeys.tags(projectId), nextTags),
    onError: (_error, { projectId }, previous) => {
      if (previous) queryClient.setQueryData<LibraryTagsQueryData<ActionTag>>(actionLibraryKeys.tags(projectId), previous);
    },
    onSettled: async (_data, error, { projectId }) => {
      await queryClient.invalidateQueries({ queryKey: actionLibraryKeys.tags(projectId), refetchType: error ? "active" : "none" });
    },
  });

  const deleteTagMutation = useMutation({
    mutationFn: (tagId: string) => {
      if (!activeProjectId) throw new Error(t("common:labels.selectProjectFirst"));
      return deleteActionTag(activeProjectId, tagId);
    },
    onSuccess: async (_result, tagId) => {
      if (activeTagFilter.includeTagIds.includes(tagId) || activeTagFilter.excludeTagIds.includes(tagId)) {
        setActiveTagFilter(createLibraryTagFilter(
          activeTagFilter.includeTagIds.filter((activeTagId) => activeTagId !== tagId),
          activeTagFilter.excludeTagIds.filter((activeTagId) => activeTagId !== tagId),
        ));
      }
      await queryClient.invalidateQueries({ queryKey: activeProjectId ? actionLibraryKeys.tags(activeProjectId) : actionLibraryKeys.tagRoot });
      await queryClient.invalidateQueries({ queryKey: ["actions", activeProjectId] });
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

  function handleReorderProjects(nextProjects: ActionProject[]) {
    reorderProjectsMutation.mutate(nextProjects);
  }

  function handleProjectDelete(projectId: string) {
    deleteProjectMutation.mutate(projectId);
  }

  function handleActionDelete(actionId: string) {
    deleteActionMutation.mutate(actionId);
  }

  function handleToggleActionTag(actionId: string, tagName: string) {
    const action = actions.find((item) => item.id === actionId);
    if (!action) return;
    const nextTags = toggleTag(action.tags, tagName);
    updateActionTagsMutation.mutate({ actionId, tags: nextTags });
  }

  function clearActionRenameError(actionId: string) {
    setActionRenameErrors((errors) => {
      if (!errors[actionId]) return errors;
      const next = { ...errors };
      delete next[actionId];
      return next;
    });
  }

  function handleUpdateActionDetails(actionId: string, patch: Partial<Pick<ActionEntry, "name" | "prompt">>) {
    if (patch.name !== undefined) {
      const nextName = normalizeLibraryName(patch.name);
      if (!isSafeLibraryFileName(nextName)) {
        setActionRenameErrors((errors) => ({ ...errors, [actionId]: t("common:errors.invalidFileNameCharacters") }));
        return false;
      }
      const allActions = allActionsQuery.data?.actions || actions;
      const duplicate = allActions.some((action) => action.id !== actionId && normalizeLibraryName(action.name) === nextName);
      if (duplicate) {
        setActionRenameErrors((errors) => ({ ...errors, [actionId]: t("common:errors.nameAlreadyExists") }));
        return false;
      }
      clearActionRenameError(actionId);
    }
    updateActionDetailsMutation.mutate({ actionId, patch });
    return true;
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
    const queryKey = activeProjectId ? actionLibraryKeys.tags(activeProjectId) : actionLibraryKeys.tagRoot;
    const previous = queryClient.getQueryData<{ tags: ActionTag[] }>(queryKey);
    queryClient.setQueryData<{ tags: ActionTag[] }>(queryKey, (current) => current ? {
      tags: current.tags.map((tag) => tag.id === tagId ? { ...tag, color: normalizeLibraryTagColor(color) } : tag),
    } : current);
    updateTagMutation.mutate({ tagId, color }, {
      onError: () => {
        if (previous) queryClient.setQueryData(queryKey, previous);
      },
    });
  }

  function handleReorderTags(nextTags: ActionTag[]) {
    if (!activeProjectId) return;
    reorderTagsMutation.mutate({ projectId: activeProjectId, tags: nextTags });
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

  function handleDeleteTag(tagId: string) {
    deleteTagMutation.mutate(tagId);
  }

  async function refreshActionLibraryAfterBulkImport() {
    if (hasLibraryTagFilter(activeTagFilter)) setActiveTagFilter(EMPTY_LIBRARY_TAG_FILTER);
    await queryClient.invalidateQueries({ queryKey: ["actions", activeProjectId] });
    await queryClient.invalidateQueries({ queryKey: actionLibraryKeys.projects });
    await queryClient.invalidateQueries({ queryKey: activeProjectId ? actionLibraryKeys.tags(activeProjectId) : actionLibraryKeys.tagRoot });
  }

  const librarySort = useLibrarySort();
  const actions = useMemo(
    () => sortLibraryItems(actionsQuery.data?.actions || [], {
      field: librarySort.sortField,
      direction: librarySort.sortDirection,
    }),
    [actionsQuery.data?.actions, librarySort.sortDirection, librarySort.sortField],
  );
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  const filteredActions = useMemo(() => {
    if (!normalizedSearchQuery) return actions;
    return actions.filter((action) => {
      const searchableText = [action.name, ...action.tags].join(" ").toLocaleLowerCase();
      return searchableText.includes(normalizedSearchQuery);
    });
  }, [actions, normalizedSearchQuery]);
  const filteredActionIds = useMemo(() => filteredActions.map((action) => action.id), [filteredActions]);
  useEffect(() => {
    bulkSelection.pruneSelection(filteredActionIds);
  }, [bulkSelection.pruneSelection, filteredActionIds]);
  useEffect(() => {
    bulkSelection.exitSelectionMode();
  }, [activeProjectId]);
  const tags = tagsQuery.data?.tags || [];
  const tagCounts = useMemo(() => countLibraryTags(filteredActions, tags), [filteredActions, tags]);
  const activeProject = projects.find((project) => project.id === activeProjectId) || null;
  const errorMessage = getRequestError([
    storageSettingsQuery.error,
    projectsQuery.error,
    tagsQuery.error,
    actionsQuery.error,
    allActionsQuery.error,
    createActionMutation.error,
    deleteActionMutation.error,
    updateActionTagsMutation.error,
    bulkActionEntriesMutation.error,
    createProjectMutation.error,
    renameProjectMutation.error,
    reorderProjectsMutation.error,
    deleteProjectMutation.error,
    createTagMutation.error,
    updateTagMutation.error,
    reorderTagsMutation.error,
    deleteTagMutation.error,
  ]);
  const libraryBodyViewportRef = useRef<HTMLDivElement | null>(null);

  return (
    <section className="library-page action-library-page" aria-label={t("actionLibrary:title")}>
      <div className="library-layout">
        <LibraryProjectSidebar<ActionProject>
          projects={projects}
          activeProjectId={activeProjectId}
          renamingProjectId={renamingProjectId}
          ariaLabel={t("actionLibrary:projectRail")}
          projectActionsLabel={(name) => t("actionLibrary:projectActions", { name })}
          onSelect={(projectId) => {
            setRenamingProjectId("");
            setActiveProjectId(projectId);
          }}
          onCreateProject={() => createProjectMutation.mutate(createUniqueLibraryProjectName(projects, t("common:labels.newProject")))}
          onRenameStart={(projectId) => {
            setRenamingProjectId(projectId);
          }}
          onRenameCancel={() => setRenamingProjectId("")}
          onRenameSubmit={submitProjectRename}
          onDeleteProject={handleProjectDelete}
          onReorderProjects={handleReorderProjects}
          closeMenuToken={closeMenuToken}
          creatingProject={createProjectMutation.isPending}
        />

        <main className="library-content-pane">
          <div className="library-content-head">
            <ActionToolbar
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

          <AppScrollArea className="library-body" viewportRef={libraryBodyViewportRef}>
            {errorMessage ? <ErrorCopyLine className="library-error" text={t("actionLibrary:requestFailed", { message: errorMessage })} /> : null}
            {storageSettingsQuery.isLoading || projectsQuery.isLoading ? (
              <Empty className="library-empty" aria-label={t("common:states.loadingProjects")}>
                <Skeleton className="h-4 w-36" />
              </Empty>
            ) : null}
            {!storageConfigured ? <Empty className="library-empty"><EmptyDescription>{t("actionLibrary:storageUnavailable")}</EmptyDescription></Empty> : null}
            {storageConfigured && !projectsQuery.isLoading && !projects.length ? <Empty className="library-empty"><EmptyDescription>{t("common:empty.noProjects")}</EmptyDescription></Empty> : null}
            {activeProject ? (
              <LibraryImageDropZone
                disabled={!storageConfigured || createActionMutation.isPending}
                label={t("actionLibrary:dropToAddAction")}
                onDropImage={(file) => createActionMutation.mutate(file)}
              >
                <ActionGrid
                  actions={filteredActions}
                  tags={tags}
                  scrollElementRef={libraryBodyViewportRef}
                  creating={createActionMutation.isPending}
                  deletingActionId={deleteActionMutation.isPending ? deleteActionMutation.variables || "" : ""}
                  selectionMode={bulkSelection.selectionMode}
                  selectedIds={bulkSelection.selectedIds}
                  onCreate={(file) => createActionMutation.mutate(file)}
                  onOpenBulkImport={() => setBulkImportOpen(true)}
                  onToggleTag={handleToggleActionTag}
                  onToggleSelected={bulkSelection.toggleSelected}
                  onUpdateDetails={handleUpdateActionDetails}
                  onDelete={handleActionDelete}
                  onImageActionStatus={showImageActionToast}
                  renameErrors={actionRenameErrors}
                  onClearRenameError={clearActionRenameError}
                />
              </LibraryImageDropZone>
            ) : null}
          </AppScrollArea>
        </main>
      </div>

      <LibraryTagManagerDialog<ActionTag>
        isOpen={tagManagerOpen}
        tags={tags}
        isCreating={createTagMutation.isPending}
        titleId="action-tag-manager-title"
        description={t("actionLibrary:tagManagerDescription")}
        emptyText={t("actionLibrary:noTags")}
        onClose={() => setTagManagerOpen(false)}
        onCreateTag={handleCreateTag}
        onRenameTag={handleRenameTag}
        onChangeTagColor={handleChangeTagColor}
        onDeleteTag={handleDeleteTag}
        onReorderTags={handleReorderTags}
        sameColorSingleFilter={sameColorSingleFilter}
        onSameColorSingleFilterChange={setSameColorSingleFilter}
      />
      <ActionFolderImportDialog
        isOpen={bulkImportOpen}
        projectId={activeProjectId}
        projectName={activeProject?.name || ""}
        existingActionNames={(allActionsQuery.data?.actions || actions).map((action) => action.name)}
        tags={tags}
        onClose={() => setBulkImportOpen(false)}
        onImported={refreshActionLibraryAfterBulkImport}
      />
      <LibraryImageActionToast toast={imageActionToast} />
      {activeProject ? (
        <LibraryBulkActions
          selectionMode={bulkSelection.selectionMode}
          selectedCount={bulkSelection.selectedCount}
          totalMatchingCount={filteredActions.length}
          tags={tags}
          isBusy={bulkActionEntriesMutation.isPending}
          onExitSelectionMode={bulkSelection.exitSelectionMode}
          onSelectMatching={() => bulkSelection.selectMatching(filteredActionIds)}
          onClearSelection={bulkSelection.clearSelection}
          onOpenTagManager={() => setTagManagerOpen(true)}
          onAddTags={(tagNames) => bulkActionEntriesMutation.mutate({ operation: "add_tags", tags: tagNames })}
          onRemoveTags={(tagNames) => bulkActionEntriesMutation.mutate({ operation: "remove_tags", tags: tagNames })}
          onDeleteSelected={() => bulkActionEntriesMutation.mutate({ operation: "delete" })}
        />
      ) : null}
    </section>
  );
}
