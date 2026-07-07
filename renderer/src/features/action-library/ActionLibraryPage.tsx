import { ChangeEvent, FormEvent, KeyboardEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ChevronRight, Copy, Download, Eye, FolderPlus, ImagePlus, MoreHorizontal, Tags, Trash2 } from "lucide-react";
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
import { LibraryProjectSidebar } from "../library-layout/LibraryProjectSidebar";
import { LibraryTagManagerDialog } from "../library-tags/LibraryTagManagerDialog";
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
    && !/[<>:"/\\|?*\x00-\x1f]/.test(value)
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
      <button className="outfit-add-button action-add-card__button" type="button" disabled={disabled} onClick={() => inputRef.current?.click()}>
        <ImagePlus size={24} aria-hidden="true" />
        <strong>{busy ? t("common:states.uploading") : t("actionLibrary:addAction")}</strong>
      </button>
      <button className="outfit-add-button action-add-card__button" type="button" disabled={disabled} onClick={onOpenBulkImport}>
        <FolderPlus size={24} aria-hidden="true" />
        <strong>{t("actionLibrary:bulkImportButton")}</strong>
      </button>
      <input ref={inputRef} type="file" accept="image/*" onChange={handleFileChange} hidden />
    </div>
  );
}

function ActionCard({
  action,
  tags,
  tagsByName,
  deleteConfirmActionId,
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
  deleteConfirmActionId: string;
  isDeleting: boolean;
  selectionMode: boolean;
  selected: boolean;
  onToggleTag: (actionId: string, tagName: string) => void;
  onToggleSelected: (actionId: string) => void;
  onUpdateDetails: (actionId: string, patch: Partial<Pick<ActionEntry, "name" | "prompt">>) => boolean;
  onDelete: (actionId: string, isConfirming: boolean) => void;
  onImageActionStatus: (tone: LibraryImageActionToastTone, text: string) => void;
  renameError: string;
  onClearRenameError: (actionId: string) => void;
}) {
  const { t } = useTranslation();
  const [menuState, setMenuState] = useState<{ open: boolean; x: number; y: number }>({ open: false, x: 0, y: 0 });
  const [tagMenuState, setTagMenuState] = useState<{ open: boolean; x: number; y: number }>({ open: false, x: 0, y: 0 });
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
    if (selectionMode) setPromptOpen(false);
  }, [selectionMode]);

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
          <button className="action-card__back-button" type="button" tabIndex={promptOpen ? 0 : -1} aria-label={t("actionLibrary:backToImage")} title={t("common:actions.back")} onClick={closePromptEditor}>
            <ArrowLeft size={18} aria-hidden="true" />
          </button>
          <label className="action-card__name-field">
            {renameError ? <span className="library-rename-error-popover">{renameError}</span> : null}
            <input
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
            <textarea
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
      <button className="outfit-card__menu-button" type="button" aria-label={t("actionLibrary:actionActions")} aria-expanded={menuState.open} onClick={openMenu}>
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
                className={deleteConfirmActionId === action.id ? "danger confirming" : "danger"}
                type="button"
                role="menuitem"
                disabled={isDeleting}
                onClick={() => onDelete(action.id, deleteConfirmActionId === action.id)}
              >
                <Trash2 size={16} aria-hidden="true" />
                <span>{deleteConfirmActionId === action.id ? t("common:confirm.delete") : t("common:actions.delete")}</span>
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
              aria-label={t("actionLibrary:chooseTags")}
              style={{ left: tagMenuState.x, top: tagMenuState.y }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {tags.length ? (
                tags.map((tag) => (
                  <button
                    key={tag.id}
                    className={action.tags.includes(tag.name) ? "selected" : ""}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={action.tags.includes(tag.name)}
                    onClick={() => onToggleTag(action.id, tag.name)}
                  >
                    <span className={`library-tag-color-dot library-tag-color-dot--${normalizeLibraryTagColor(tag.color)}`} aria-hidden="true" />
                    <span>{tag.name}</span>
                  </button>
                ))
              ) : (
                <div className="outfit-tag-menu__empty">{t("actionLibrary:noTags")}</div>
              )}
            </div>,
            document.body,
          )
        : null}
      {viewerOpen && assetUrl ? <ImageViewer src={assetUrl} alt={imageAlt} onClose={() => setViewerOpen(false)} /> : null}
    </div>
  );
}

function ActionGrid({
  actions,
  tags,
  creating,
  deletingActionId,
  deleteConfirmActionId,
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
  creating: boolean;
  deletingActionId: string;
  deleteConfirmActionId: string;
  selectionMode: boolean;
  selectedIds: Set<string>;
  onCreate: (file: File) => void;
  onOpenBulkImport: () => void;
  onToggleTag: (actionId: string, tagName: string) => void;
  onToggleSelected: (actionId: string) => void;
  onUpdateDetails: (actionId: string, patch: Partial<Pick<ActionEntry, "name" | "prompt">>) => boolean;
  onDelete: (actionId: string, isConfirming: boolean) => void;
  onImageActionStatus: (tone: LibraryImageActionToastTone, text: string) => void;
  renameErrors: Record<string, string>;
  onClearRenameError: (actionId: string) => void;
}) {
  const cardSize = useLibraryCardSize("action");
  const librarySort = useLibrarySort();
  const tagsByName = useMemo(() => createLibraryTagsByName(tags), [tags]);
  return (
    <div className="library-card-size-scope">
      <div className="outfit-grid" style={cardSize.gridStyle}>
        {!selectionMode ? <AddActionCard disabled={creating} busy={creating} onCreate={onCreate} onOpenBulkImport={onOpenBulkImport} /> : null}
        {actions.map((action) => (
          <ActionCard
            key={action.id}
            action={action}
            tags={tags}
            tagsByName={tagsByName}
            deleteConfirmActionId={deleteConfirmActionId}
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
        ))}
      </div>
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
        aria-labelledby="create-action-project-title"
        onSubmit={handleSubmit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog__head">
          <h2 id="create-action-project-title">{t("common:labels.newProject")}</h2>
          <p>{t("actionLibrary:createProjectDescription")}</p>
        </div>
        <label className="dialog-field">
          <span>{t("common:labels.projectName")}</span>
          <input value={name} onChange={(event) => setName(event.target.value)} autoFocus maxLength={120} placeholder={t("actionLibrary:projectPlaceholder")} />
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

export function ActionLibraryPage({ searchQuery = "" }: { searchQuery?: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [renamingProjectId, setRenamingProjectId] = useState("");
  const [deleteConfirmProjectId, setDeleteConfirmProjectId] = useState("");
  const [deleteConfirmActionId, setDeleteConfirmActionId] = useState("");
  const [deleteConfirmTagId, setDeleteConfirmTagId] = useState("");
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
      if (!result.imported[0]) throw new Error(result.failed[0]?.errors?.[0]?.message || t("actionLibrary:requestFailed", { message: "Import failed" }));
      return result.imported[0];
    },
    onSuccess: async () => {
      if (hasLibraryTagFilter(activeTagFilter)) setActiveTagFilter(EMPTY_LIBRARY_TAG_FILTER);
      setDeleteConfirmActionId("");
      await queryClient.invalidateQueries({ queryKey: ["actions", activeProjectId] });
      await queryClient.invalidateQueries({ queryKey: actionLibraryKeys.projects });
      await queryClient.invalidateQueries({ queryKey: activeProjectId ? actionLibraryKeys.tags(activeProjectId) : actionLibraryKeys.tagRoot });
    },
  });

  const deleteActionMutation = useMutation({
    mutationFn: deleteAction,
    onSuccess: async () => {
      setDeleteConfirmActionId("");
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
      setCreateProjectOpen(false);
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

  const deleteProjectMutation = useMutation({
    mutationFn: deleteActionProject,
    onSuccess: async (_result, projectId) => {
      const remaining = projects.filter((project) => project.id !== projectId);
      setDeleteConfirmProjectId("");
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

  const deleteTagMutation = useMutation({
    mutationFn: (tagId: string) => {
      if (!activeProjectId) throw new Error(t("common:labels.selectProjectFirst"));
      return deleteActionTag(activeProjectId, tagId);
    },
    onSuccess: async (_result, tagId) => {
      setDeleteConfirmTagId("");
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

  function handleActionDelete(actionId: string, isConfirming: boolean) {
    if (!isConfirming) {
      setDeleteConfirmActionId(actionId);
      return;
    }
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
    deleteProjectMutation.error,
    createTagMutation.error,
    updateTagMutation.error,
    deleteTagMutation.error,
  ]);

  return (
    <section className="library-page action-library-page" aria-label={t("actionLibrary:title")}>
      <div className="library-layout">
        <LibraryProjectSidebar<ActionProject>
          projects={projects}
          activeProjectId={activeProjectId}
          renamingProjectId={renamingProjectId}
          deleteConfirmProjectId={deleteConfirmProjectId}
          ariaLabel={t("actionLibrary:projectRail")}
          projectActionsLabel={(name) => t("actionLibrary:projectActions", { name })}
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

          <div className="library-body scrollbar-thin-stable">
            {errorMessage ? <ErrorCopyLine className="library-error" text={t("actionLibrary:requestFailed", { message: errorMessage })} /> : null}
            {storageSettingsQuery.isLoading || projectsQuery.isLoading ? <div className="library-empty">{t("common:states.loadingProjects")}</div> : null}
            {!storageConfigured ? <div className="library-empty">{t("actionLibrary:storageUnavailable")}</div> : null}
            {storageConfigured && !projectsQuery.isLoading && !projects.length ? <div className="library-empty">{t("common:empty.noProjects")}</div> : null}
            {activeProject ? (
              <LibraryImageDropZone
                disabled={!storageConfigured || createActionMutation.isPending}
                label={t("actionLibrary:dropToAddAction")}
                onDropImage={(file) => createActionMutation.mutate(file)}
              >
                <ActionGrid
                  actions={filteredActions}
                  tags={tags}
                  creating={createActionMutation.isPending}
                  deletingActionId={deleteActionMutation.isPending ? deleteActionMutation.variables || "" : ""}
                  deleteConfirmActionId={deleteConfirmActionId}
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
          </div>
        </main>
      </div>

      <CreateProjectDialog
        isOpen={createProjectOpen}
        isCreating={createProjectMutation.isPending}
        onClose={() => setCreateProjectOpen(false)}
        onSubmit={(name) => createProjectMutation.mutate(name)}
      />
      <LibraryTagManagerDialog<ActionTag>
        isOpen={tagManagerOpen}
        tags={tags}
        isCreating={createTagMutation.isPending}
        deleteConfirmTagId={deleteConfirmTagId}
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
