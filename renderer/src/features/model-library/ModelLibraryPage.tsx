import { ChangeEvent, FormEvent, KeyboardEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Copy, Download, Eye, MoreHorizontal, Star, Trash2, Upload, X } from "lucide-react";
import { createPortal } from "react-dom";
import { Fragment } from "react";
import { LazyImage } from "../../components/LazyImage";
import { ImageViewer } from "../../lib/ImageViewer";
import { CollapsibleTagFilterRow } from "../library-tags";
import { LibraryTagChoiceButton } from "../library-tags";
import { LibraryImageActionToast, useLibraryImageActionToast, type LibraryImageActionToastTone } from "../../lib/LibraryImageActionToast";
import { cacheBustedLibraryImageUrl, copyLibraryImage, downloadLibraryOriginalImage, resolveLibraryImageUrl } from "../../lib/libraryImageActions";
import { LibraryCardToolbar, sortLibraryItems, useLibraryCardSize, useLibrarySort } from "../resource-library/LibraryCardSizeControl";
import { LibraryBulkActions, LibraryBulkManageButton } from "../resource-library/LibraryBulkActions";
import { LibraryProjectSidebar } from "../library-layout/LibraryProjectSidebar";
import { LibraryTagManagerDialog } from "../library-tags/LibraryTagManagerDialog";
import { useLibraryBulkSelection } from "../resource-library/useLibraryBulkSelection";
import { createLibraryAssetUploadPayload } from "../resource-library/createLibraryAssetUploadPayload";
import { EMPTY_LIBRARY_TAG_FILTER, applySameColorSingleIncludeFilter, cleanLibraryTagFilter, countLibraryTags, createLibraryTagFilter, createLibraryTagsByName, hasLibraryTagFilter, normalizeLibraryTagColor, toggleLibraryTagFilterInclude, useLibraryTagSettingsStore, type LibraryTagColor, type LibraryTagFilter, type LibraryTagNameColorLike } from "../library-tags";
import {
  bulkModelEntries,
  createModelTag,
  createModelProject,
  deleteModel,
  deleteModelImage,
  deleteModelTag,
  deleteModelProject,
  listModelProjects,
  listModelImages,
  listModels,
  listModelTags,
  modelLibraryKeys,
  getStorageSettings,
  importModelEntries,
  uploadModelImage,
  updateModel,
  updateModelTag,
  updateModelProject,
} from "./api";
import { useModelLibraryStore } from "./modelLibraryStore";
import { normalizeTags, toggleTag } from "../library-tags/tagUtils";
import { ModelEntry, ModelGender, ModelImage, ModelProject, ModelTag } from "./types";

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

function ModelToolbar({
  tags,
  tagFilter,
  tagCounts,
  activeGender,
  onTagToggle,
  onTagExclude,
  onTagClear,
  onUntaggedToggle,
  onGenderToggle,
  selectionMode,
  onEnterSelectionMode,
  onExitSelectionMode,
}: {
  tags: ModelTag[];
  tagFilter: LibraryTagFilter;
  tagCounts: Record<string, number>;
  activeGender: "female" | "male" | "";
  onTagToggle: (tagId: string) => void;
  onTagExclude: (tagId: string) => void;
  onTagClear: () => void;
  onUntaggedToggle: () => void;
  onGenderToggle: (gender: "female" | "male") => void;
  selectionMode: boolean;
  onEnterSelectionMode: () => void;
  onExitSelectionMode: () => void;
}) {
  const { t } = useTranslation();
  const includeTagSet = useMemo(() => new Set(tagFilter.includeTagIds), [tagFilter.includeTagIds]);
  const excludeTagSet = useMemo(() => new Set(tagFilter.excludeTagIds), [tagFilter.excludeTagIds]);

  return (
    <div className="library-toolbar">
      <div className="library-gender-filter" aria-label={t("modelLibrary:genderCategory")}>
        <span className="library-filter-label">{t("modelLibrary:gender")}</span>
        <button
          className={`gender-icon-filter female${activeGender === "female" ? " active" : ""}`}
          type="button"
          aria-label={t("modelLibrary:femaleModel")}
          title={t("modelLibrary:femaleModel")}
          onClick={() => onGenderToggle("female")}
        >
          <GenderSymbol gender="female" className="gender-symbol-icon" />
        </button>
        <button
          className={`gender-icon-filter male${activeGender === "male" ? " active" : ""}`}
          type="button"
          aria-label={t("modelLibrary:maleModel")}
          title={t("modelLibrary:maleModel")}
          onClick={() => onGenderToggle("male")}
        >
          <GenderSymbol gender="male" className="gender-symbol-icon" />
        </button>
      </div>

      <div className="library-filter-divider" aria-hidden="true" />

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

function GenderSymbol({ gender, className }: { gender: "female" | "male"; className: string }) {
  if (gender === "female") {
    return (
      <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="8" r="5" />
        <path d="M12 13v8" />
        <path d="M8 17h8" />
      </svg>
    );
  }

  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="15" r="5" />
      <path d="M13 11l7-7" />
      <path d="M15 4h5v5" />
    </svg>
  );
}

function AddModelCard({ disabled, busy, onCreate }: { disabled: boolean; busy: boolean; onCreate: (gender: "female" | "male") => void }) {
  const { t } = useTranslation();
  return (
    <div className="model-add-card model-add-gender-card">
      <button className="model-add-gender-option female" type="button" disabled={disabled} onClick={() => onCreate("female")}>
        <GenderSymbol gender="female" className="model-add-gender-icon" />
        <strong>{busy ? t("common:states.adding") : t("modelLibrary:addFemaleModel")}</strong>
      </button>
      <button className="model-add-gender-option male" type="button" disabled={disabled} onClick={() => onCreate("male")}>
        <GenderSymbol gender="male" className="model-add-gender-icon" />
        <strong>{busy ? t("common:states.adding") : t("modelLibrary:addMaleModel")}</strong>
      </button>
    </div>
  );
}

function ModelCard({
  model,
  tagsByName,
  isOpen,
  onOpen,
  selectionMode,
  selected,
  onToggleSelected,
}: {
  model: ModelEntry;
  tagsByName: Map<string, LibraryTagNameColorLike>;
  isOpen: boolean;
  onOpen: () => void;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelected: () => void;
}) {
  const { t } = useTranslation();
  const coverCacheKey = model.cover_image_id || model.cover_asset_id || "";
  const coverUrl = cacheBustedLibraryImageUrl(model.cover_thumbnail_url || model.cover_url || "", coverCacheKey);

  return (
    <button
      className={`model-card${isOpen ? " active" : ""}${selectionMode ? " selecting" : ""}${selected ? " selected" : ""}`}
      type="button"
      aria-pressed={selectionMode ? selected : undefined}
      onClick={selectionMode ? onToggleSelected : onOpen}
    >
      <div className="model-card__cover">
        {coverUrl ? (
          <LazyImage
            src={coverUrl}
            alt={t("modelLibrary:coverAlt", { name: model.name })}
            draggable={false}
            onDragStart={(event) => event.preventDefault()}
          />
        ) : (
          <div className="placeholder">{t("common:empty.noImage")}</div>
        )}
      </div>
      <div className="model-card__meta">
        <div className="model-card__name">{model.name || "Unnamed Model"}</div>
        {model.tags.length ? (
          <div className="tag-list">
            {model.tags.map((tag) => (
              <span key={tag}>
                <span className={`library-tag-color-dot library-tag-color-dot--${normalizeLibraryTagColor(tagsByName.get(tag)?.color)}`} aria-hidden="true" />
                <span>{tag}</span>
              </span>
            ))}
          </div>
        ) : (
          <div className="tag-list empty">{t("modelLibrary:noTags")}</div>
        )}
      </div>
    </button>
  );
}

function scrollEditorIntoView(editor: HTMLElement) {
  const scrollParents: HTMLElement[] = [];
  let parent = editor.parentElement;
  while (parent && parent !== document.body) {
    const style = window.getComputedStyle(parent);
    const canScrollY = /(auto|scroll|overlay)/.test(style.overflowY);
    if (canScrollY && parent.scrollHeight > parent.clientHeight) {
      scrollParents.push(parent);
    }
    parent = parent.parentElement;
  }

  const scrollParent = scrollParents[0];
  if (!scrollParent) {
    editor.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return;
  }

  const margin = 16;
  const editorRect = editor.getBoundingClientRect();
  const parentRect = scrollParent.getBoundingClientRect();
  const editorTopInScroller = editorRect.top - parentRect.top + scrollParent.scrollTop;
  const editorHeight = editorRect.height;
  const visibleHeight = scrollParent.clientHeight - margin * 2;
  const currentTop = scrollParent.scrollTop;
  const visibleTop = currentTop + margin;
  const visibleBottom = currentTop + scrollParent.clientHeight - margin;
  const editorBottomInScroller = editorTopInScroller + editorHeight;
  let targetTop = currentTop;

  if (editorHeight > visibleHeight || editorTopInScroller < visibleTop) {
    targetTop = editorTopInScroller - margin;
  } else if (editorBottomInScroller > visibleBottom) {
    targetTop = editorBottomInScroller - scrollParent.clientHeight + margin;
  }

  if (Math.abs(targetTop - currentTop) > 1) {
    scrollParent.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
  }
}

function ModelInlineEditor({
  model,
  tags,
  images,
  isSaving,
  isDeleting,
  isConfirmingDelete,
  onSaveName,
  onClose,
  onDelete,
  onToggleTag,
  onUploadImage,
  onDeleteImage,
  onSetCover,
  onImageActionStatus,
  renameError,
  onClearRenameError,
}: {
  model: ModelEntry;
  tags: ModelTag[];
  images: ModelImage[];
  isSaving: boolean;
  isDeleting: boolean;
  isConfirmingDelete: boolean;
  onSaveName: (modelId: string, name: string) => void;
  onClose: () => void;
  onDelete: (modelId: string, isConfirming: boolean) => void;
  onToggleTag: (modelId: string, tagName: string) => void;
  onUploadImage: (modelId: string, file: File) => void;
  onDeleteImage: (imageId: string) => void;
  onSetCover: (modelId: string, imageId: string) => void;
  onImageActionStatus: (tone: LibraryImageActionToastTone, text: string) => void;
  renameError: string;
  onClearRenameError: (modelId: string) => void;
}) {
  const { t } = useTranslation();
  const [draftName, setDraftName] = useState(model.name || "");
  const [openImageMenuState, setOpenImageMenuState] = useState<{ imageId: string; x: number; y: number }>({
    imageId: "",
    x: 0,
    y: 0,
  });
  const [deleteConfirmImageId, setDeleteConfirmImageId] = useState("");
  const [openImageViewerState, setOpenImageViewerState] = useState<{
    src: string;
    alt: string;
  } | null>(null);
  const [isImageDropActive, setIsImageDropActive] = useState(false);
  const imageDropDepthRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setDraftName(model.name || "");
    onClearRenameError(model.id);
  }, [model.id, model.name]);

  useEffect(() => {
    setOpenImageMenuState({ imageId: "", x: 0, y: 0 });
    setDeleteConfirmImageId("");
    setOpenImageViewerState(null);
    setIsImageDropActive(false);
    imageDropDepthRef.current = 0;
  }, [model.id]);

  useEffect(() => {
    let nextFrame = 0;
    const frame = window.requestAnimationFrame(() => {
      nextFrame = window.requestAnimationFrame(() => {
        if (editorRef.current) scrollEditorIntoView(editorRef.current);
      });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(nextFrame);
    };
  }, [model.id, images.length]);

  useEffect(() => {
    if (!openImageMenuState.imageId) return;
    function closeMenu() {
      setOpenImageMenuState({ imageId: "", x: 0, y: 0 });
      setDeleteConfirmImageId("");
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
  }, [openImageMenuState.imageId]);

  function submitName() {
    const nextName = normalizeLibraryName(draftName);
    if (!nextName || nextName === model.name) {
      setDraftName(model.name || "");
      return;
    }
    onSaveName(model.id, nextName);
  }

  function handleNameKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      submitName();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setDraftName(model.name || "");
      onClose();
    }
  }

  function handleFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    files.forEach((file) => {
      if (file.type.startsWith("image/")) {
        onUploadImage(model.id, file);
      }
    });
  }

  function resetImageDropState() {
    imageDropDepthRef.current = 0;
    setIsImageDropActive(false);
  }

  function handleImageDragEnter(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    imageDropDepthRef.current += 1;
    setIsImageDropActive(true);
  }

  function handleImageDragOver(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleImageDragLeave(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    imageDropDepthRef.current = Math.max(0, imageDropDepthRef.current - 1);
    if (imageDropDepthRef.current === 0) {
      setIsImageDropActive(false);
    }
  }

  function handleImageDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files || []);
    resetImageDropState();
    files.forEach((file) => {
      if (file.type.startsWith("image/")) {
        onUploadImage(model.id, file);
      }
    });
  }

  function openImageViewer(src: string, alt: string) {
    if (!src) return;
    setOpenImageMenuState({ imageId: "", x: 0, y: 0 });
    setDeleteConfirmImageId("");
    setOpenImageViewerState({ src, alt });
  }

  function openImageMenu(imageId: string, event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 176;
    const menuHeight = 232;
    const pad = 8;
    const preferredX = rect.right + 8;
    const preferredY = rect.top;
    const x = preferredX + menuWidth <= window.innerWidth - pad ? preferredX : rect.left - menuWidth - 8;
    const y = Math.max(pad, Math.min(preferredY, window.innerHeight - menuHeight - pad));
    setOpenImageMenuState({
      imageId,
      x: Math.max(pad, Math.min(x, window.innerWidth - menuWidth - pad)),
      y,
    });
  }

  async function handleCopyImage(src: string) {
    if (!src) return;
    setOpenImageMenuState({ imageId: "", x: 0, y: 0 });
    setDeleteConfirmImageId("");
    onImageActionStatus("busy", t("common:states.copyingImage"));
    try {
      await copyLibraryImage(src);
      onImageActionStatus("ready", t("common:states.imageCopied"));
    } catch (error) {
      onImageActionStatus("error", t("common:errors.imageActionFailed", { message: error instanceof Error ? error.message : String(error) }));
    }
  }

  async function handleDownloadOriginalImage(src: string, defaultName: string) {
    if (!src) return;
    setOpenImageMenuState({ imageId: "", x: 0, y: 0 });
    setDeleteConfirmImageId("");
    onImageActionStatus("busy", t("common:states.downloadingImage"));
    try {
      await downloadLibraryOriginalImage(src, defaultName);
      onImageActionStatus("ready", t("common:states.imageDownloadStarted"));
    } catch (error) {
      onImageActionStatus("error", t("common:errors.imageActionFailed", { message: error instanceof Error ? error.message : String(error) }));
    }
  }

  return (
    <section ref={editorRef} className="model-inline-editor" aria-label={t("modelLibrary:inlineEditor", { name: model.name })}>
      <button className="model-inline-close-button" type="button" onClick={onClose} aria-label={t("modelLibrary:closeEditor")}>
        <X size={14} aria-hidden="true" />
      </button>
      <div className="model-inline-editor-head">
        <div className="model-inline-title-area">
          <label className="model-inline-name-field">
            <span>{t("modelLibrary:modelName")}</span>
            {renameError ? <span className="library-rename-error-popover">{renameError}</span> : null}
            <input
              className={`library-entry-title-input${renameError ? " library-rename-input--error" : ""}`}
              type="text"
              value={draftName}
              onChange={(event) => {
                onClearRenameError(model.id);
                setDraftName(event.target.value);
              }}
              onBlur={submitName}
              onKeyDown={handleNameKeyDown}
              disabled={isSaving || isDeleting}
              maxLength={120}
            />
          </label>
          <div className="model-inline-summary" aria-label={t("modelLibrary:assetOverview")}>
            <button
              className={`library-button danger model-delete-confirm-button${isConfirmingDelete ? " confirming" : ""}`}
              type="button"
              disabled={isDeleting}
              onClick={() => onDelete(model.id, isConfirmingDelete)}
              aria-label={isConfirmingDelete ? t("modelLibrary:confirmDeleteModel") : t("modelLibrary:deleteModel")}
            >
              {isDeleting ? t("modelLibrary:deleting") : isConfirmingDelete ? t("modelLibrary:finalConfirmDelete") : t("common:actions.delete")}
            </button>
            <span>{t("modelLibrary:tagCount", { count: model.tags.length || 0 })}</span>
            <span>{t("modelLibrary:imageCount", { count: images.length || 0 })}</span>
          </div>
        </div>
      </div>
      <div className="model-inline-editor-placeholder">
        <div className="model-inline-tags-block">
          <div className="model-inline-section-head">
            <div>
              <span className="model-inline-section-label">{t("common:labels.tags")}</span>
              <p>{model.tags.length ? t("modelLibrary:selectedTagCount", { count: model.tags.length }) : t("common:labels.notSelected")}</p>
            </div>
          </div>
          <div className="library-modal-tags">
            {tags.length ? (
              tags.map((tag) => {
                const selected = model.tags.includes(tag.name);
                return (
                  <button
                    key={tag.id}
                    className={selected ? "selected" : ""}
                    type="button"
                    onClick={() => onToggleTag(model.id, tag.name)}
                  >
                    <span className={`library-tag-color-dot library-tag-color-dot--${normalizeLibraryTagColor(tag.color)}`} aria-hidden="true" />
                    <span>{tag.name}</span>
                  </button>
                );
              })
            ) : (
              <div className="library-modal-tags empty">{t("modelLibrary:noAvailableTags")}</div>
            )}
          </div>
        </div>
        <div
          className={`model-inline-images-block${isImageDropActive ? " drag-active" : ""}`}
          onDragEnter={handleImageDragEnter}
          onDragOver={handleImageDragOver}
          onDragLeave={handleImageDragLeave}
          onDrop={handleImageDrop}
        >
          <div className="model-inline-section-head">
            <div>
              <span className="model-inline-section-label">{t("modelLibrary:images")}</span>
              <p>{images.length ? t("modelLibrary:assetCount", { count: images.length }) : t("modelLibrary:noAssets")}</p>
            </div>
            <button className="library-button" type="button" onClick={() => fileInputRef.current?.click()}>
              <Upload size={16} aria-hidden="true" />
              <span>{t("common:actions.uploadImage")}</span>
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={handleFilesSelected} />
          </div>
          <div className="model-image-grid">
            {images.length ? (
              images.map((image) => {
                const isCover = model.cover_image_id === image.id;
                const originalSrc = resolveLibraryImageUrl(image.asset_url || "");
                const displaySrc = resolveLibraryImageUrl(image.thumbnail_url || image.asset_url || "");
                const menuOpen = openImageMenuState.imageId === image.id;
                const altText = image.caption || model.name || image.filename || t("modelLibrary:imagePreview");
                return (
                  <Fragment key={image.id}>
                    <figure className={`model-image-tile${isCover ? " cover" : ""}`}>
                      <div
                        className="model-image-preview"
                        role="button"
                        tabIndex={0}
                        aria-label={altText}
                        onClick={() => {
                          if (!originalSrc) return;
                          openImageViewer(originalSrc, altText);
                        }}
                        onKeyDown={(event) => {
                          if (!originalSrc) return;
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openImageViewer(originalSrc, altText);
                          }
                        }}
                      >
                        {displaySrc ? (
                          <LazyImage
                            src={displaySrc}
                            alt={altText}
                            draggable={false}
                            onDragStart={(event) => event.preventDefault()}
                          />
                        ) : (
                          <div className="placeholder">{t("common:empty.noImage")}</div>
                        )}
                        <button
                          className="model-image-menu-button"
                          type="button"
                          aria-label={t("modelLibrary:imageActions")}
                          aria-expanded={menuOpen}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (menuOpen) {
                              setOpenImageMenuState({ imageId: "", x: 0, y: 0 });
                              setDeleteConfirmImageId("");
                              return;
                            }
                            setDeleteConfirmImageId("");
                            openImageMenu(image.id, event);
                          }}
                        >
                          <MoreHorizontal size={18} aria-hidden="true" />
                        </button>
                      </div>
                    </figure>
                    {menuOpen
                      ? createPortal(
                          <div
                            className="model-image-menu"
                            role="menu"
                            style={{ left: openImageMenuState.x, top: openImageMenuState.y }}
                            onPointerDown={(event) => event.stopPropagation()}
                          >
                            <button
                              type="button"
                              role="menuitem"
                              disabled={isCover}
                              onClick={() => {
                                setOpenImageMenuState({ imageId: "", x: 0, y: 0 });
                                setDeleteConfirmImageId("");
                                onSetCover(model.id, image.id);
                              }}
                            >
                              <Star size={15} aria-hidden="true" />
                              <span>{t("modelLibrary:setAsCover")}</span>
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              disabled={!originalSrc}
                              onClick={() => openImageViewer(originalSrc, altText)}
                            >
                              <Eye size={15} aria-hidden="true" />
                              <span>{t("common:actions.viewImage")}</span>
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              disabled={!originalSrc}
                              onClick={() => void handleDownloadOriginalImage(originalSrc, image.filename || image.caption || `${model.name}-${image.id}`)}
                            >
                              <Download size={15} aria-hidden="true" />
                              <span>{t("common:actions.downloadOriginalImage")}</span>
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              disabled={!originalSrc}
                              onClick={() => void handleCopyImage(originalSrc)}
                            >
                              <Copy size={15} aria-hidden="true" />
                              <span>{t("common:actions.copyImage")}</span>
                            </button>
                            <button
                              className={deleteConfirmImageId === image.id ? "danger confirming" : "danger"}
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                if (deleteConfirmImageId !== image.id) {
                                  setDeleteConfirmImageId(image.id);
                                  return;
                                }
                                setOpenImageMenuState({ imageId: "", x: 0, y: 0 });
                                setDeleteConfirmImageId("");
                                onDeleteImage(image.id);
                              }}
                            >
                              <Trash2 size={15} aria-hidden="true" />
                              <span>{deleteConfirmImageId === image.id ? t("common:confirm.delete") : t("common:actions.delete")}</span>
                            </button>
                          </div>,
                          document.body,
                        )
                      : null}
                  </Fragment>
                );
              })
            ) : (
              <div className="model-inline-helper">{t("modelLibrary:emptyImagesHint")}</div>
            )}
          </div>
        </div>
      </div>
      {openImageViewerState ? (
        <ImageViewer
          src={openImageViewerState.src}
          alt={openImageViewerState.alt}
          onClose={() => setOpenImageViewerState(null)}
        />
      ) : null}
    </section>
  );
}
function ModelGrid({
  models,
  openModelId,
  creating,
  savingModelId,
  deletingModelId,
  deleteConfirmModelId,
  tags,
  images,
  onCreate,
  onOpenModel,
  onSaveModelName,
  onCloseEditor,
  onDeleteModel,
  onToggleTag,
  onUploadImage,
  onDeleteImage,
  onSetCover,
  onImageActionStatus,
  renameErrors,
  onClearRenameError,
  selectionMode,
  selectedIds,
  onToggleSelected,
}: {
  models: ModelEntry[];
  openModelId: string;
  creating: boolean;
  savingModelId: string;
  deletingModelId: string;
  deleteConfirmModelId: string;
  tags: ModelTag[];
  images: ModelImage[];
  onCreate: (gender: "female" | "male") => void;
  onOpenModel: (modelId: string) => void;
  onSaveModelName: (modelId: string, name: string) => void;
  onCloseEditor: () => void;
  onDeleteModel: (modelId: string, isConfirming: boolean) => void;
  onToggleTag: (modelId: string, tagName: string) => void;
  onUploadImage: (modelId: string, file: File) => void;
  onDeleteImage: (imageId: string) => void;
  onSetCover: (modelId: string, imageId: string) => void;
  onImageActionStatus: (tone: LibraryImageActionToastTone, text: string) => void;
  renameErrors: Record<string, string>;
  onClearRenameError: (modelId: string) => void;
  selectionMode: boolean;
  selectedIds: Set<string>;
  onToggleSelected: (modelId: string) => void;
}) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const cardSize = useLibraryCardSize("model");
  const librarySort = useLibrarySort();
  const tagsByName = useMemo(() => createLibraryTagsByName(tags), [tags]);
  const [columnCount, setColumnCount] = useState(1);
  const openModel = models.find((model) => model.id === openModelId) || null;
  const openIndex = models.findIndex((model) => model.id === openModelId);
  const insertAfterIndex = useMemo(() => {
    if (!openModel || openIndex < 0) return -1;
    const fullGridIndex = openIndex + 1;
    const rowEndGridIndex = Math.floor(fullGridIndex / columnCount) * columnCount + columnCount - 1;
    return Math.min(models.length - 1, rowEndGridIndex - 1);
  }, [columnCount, models.length, openIndex, openModel]);

  useEffect(() => {
    function updateColumnCount() {
      const grid = gridRef.current;
      if (!grid) return;
      const styles = window.getComputedStyle(grid);
      const nextColumns = styles.gridTemplateColumns
        .split(" ")
        .filter((column) => column && column !== "none").length;
      setColumnCount(Math.max(1, nextColumns));
    }

    updateColumnCount();
    const grid = gridRef.current;
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateColumnCount) : null;
    if (grid) resizeObserver?.observe(grid);
    window.addEventListener("resize", updateColumnCount);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateColumnCount);
    };
  }, []);

  return (
    <div className="library-card-size-scope">
      <div ref={gridRef} className="model-grid" style={cardSize.gridStyle}>
        {!selectionMode ? <AddModelCard disabled={creating} busy={creating} onCreate={onCreate} /> : null}
        {models.map((model, index) => (
          <FragmentWithEditor
            key={model.id}
            model={model}
            tagsByName={tagsByName}
            isOpen={model.id === openModelId}
            shouldRenderEditor={Boolean(openModel && index === insertAfterIndex)}
            openModel={openModel}
            tags={tags}
            images={images}
            savingModelId={savingModelId}
            deletingModelId={deletingModelId}
            deleteConfirmModelId={deleteConfirmModelId}
            onOpenModel={onOpenModel}
            onSaveModelName={onSaveModelName}
            onCloseEditor={onCloseEditor}
            onDeleteModel={onDeleteModel}
            onToggleTag={onToggleTag}
            onUploadImage={onUploadImage}
            onDeleteImage={onDeleteImage}
            onSetCover={onSetCover}
            onImageActionStatus={onImageActionStatus}
            renameErrors={renameErrors}
            onClearRenameError={onClearRenameError}
            selectionMode={selectionMode}
            selectedIds={selectedIds}
            onToggleSelected={onToggleSelected}
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

function FragmentWithEditor({
  model,
  tagsByName,
  isOpen,
  shouldRenderEditor,
  openModel,
  tags,
  images,
  savingModelId,
  deletingModelId,
  deleteConfirmModelId,
  onOpenModel,
  onSaveModelName,
  onCloseEditor,
  onDeleteModel,
  onToggleTag,
  onUploadImage,
  onDeleteImage,
  onSetCover,
  onImageActionStatus,
  renameErrors,
  onClearRenameError,
  selectionMode,
  selectedIds,
  onToggleSelected,
}: {
  model: ModelEntry;
  tagsByName: Map<string, LibraryTagNameColorLike>;
  isOpen: boolean;
  shouldRenderEditor: boolean;
  openModel: ModelEntry | null;
  tags: ModelTag[];
  images: ModelImage[];
  savingModelId: string;
  deletingModelId: string;
  deleteConfirmModelId: string;
  onOpenModel: (modelId: string) => void;
  onSaveModelName: (modelId: string, name: string) => void;
  onCloseEditor: () => void;
  onDeleteModel: (modelId: string, isConfirming: boolean) => void;
  onToggleTag: (modelId: string, tagName: string) => void;
  onUploadImage: (modelId: string, file: File) => void;
  onDeleteImage: (imageId: string) => void;
  onSetCover: (modelId: string, imageId: string) => void;
  onImageActionStatus: (tone: LibraryImageActionToastTone, text: string) => void;
  renameErrors: Record<string, string>;
  onClearRenameError: (modelId: string) => void;
  selectionMode: boolean;
  selectedIds: Set<string>;
  onToggleSelected: (modelId: string) => void;
}) {
  return (
    <>
      <ModelCard
        model={model}
        tagsByName={tagsByName}
        isOpen={isOpen}
        selectionMode={selectionMode}
        selected={selectedIds.has(model.id)}
        onToggleSelected={() => onToggleSelected(model.id)}
        onOpen={() => onOpenModel(model.id)}
      />
      {shouldRenderEditor && openModel ? (
        <ModelInlineEditor
          model={openModel}
          tags={tags}
          images={images}
          isSaving={savingModelId === openModel.id}
          isDeleting={deletingModelId === openModel.id}
          isConfirmingDelete={deleteConfirmModelId === openModel.id}
          onSaveName={onSaveModelName}
          onClose={onCloseEditor}
          onDelete={onDeleteModel}
          onToggleTag={onToggleTag}
          onUploadImage={onUploadImage}
          onDeleteImage={onDeleteImage}
          onSetCover={onSetCover}
          onImageActionStatus={onImageActionStatus}
          renameError={renameErrors[openModel.id] || ""}
          onClearRenameError={onClearRenameError}
        />
      ) : null}
    </>
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
        aria-labelledby="create-project-title"
        onSubmit={handleSubmit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog__head">
          <h2 id="create-project-title">{t("common:labels.newProject")}</h2>
          <p>{t("modelLibrary:createProjectDescription")}</p>
        </div>
        <label className="dialog-field">
          <span>{t("common:labels.projectName")}</span>
          <input value={name} onChange={(event) => setName(event.target.value)} autoFocus maxLength={120} placeholder={t("modelLibrary:projectPlaceholder")} />
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

export function ModelLibraryPage({ searchQuery = "" }: { searchQuery?: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [renamingProjectId, setRenamingProjectId] = useState("");
  const [deleteConfirmProjectId, setDeleteConfirmProjectId] = useState("");
  const [closeMenuToken, setCloseMenuToken] = useState(0);
  const [deleteConfirmModelId, setDeleteConfirmModelId] = useState("");
  const [deleteConfirmTagId, setDeleteConfirmTagId] = useState("");
  const [modelRenameErrors, setModelRenameErrors] = useState<Record<string, string>>({});
  const { toast: imageActionToast, showToast: showImageActionToast } = useLibraryImageActionToast();
  const activeProjectId = useModelLibraryStore((state) => state.activeProjectId);
  const activeTagFilter = useModelLibraryStore((state) => state.activeTagFilter);
  const activeGender = useModelLibraryStore((state) => state.activeGender);
  const openModelId = useModelLibraryStore((state) => state.openModelId);
  const setActiveProjectId = useModelLibraryStore((state) => state.setActiveProjectId);
  const setActiveTagFilter = useModelLibraryStore((state) => state.setActiveTagFilter);
  const toggleGender = useModelLibraryStore((state) => state.toggleGender);
  const openEditor = useModelLibraryStore((state) => state.openEditor);
  const closeEditor = useModelLibraryStore((state) => state.closeEditor);
  const sameColorSingleFilter = useLibraryTagSettingsStore((state) => state.sameColorSingleFilter);
  const setSameColorSingleFilter = useLibraryTagSettingsStore((state) => state.setSameColorSingleFilter);
  const bulkSelection = useLibraryBulkSelection();

  const storageSettingsQuery = useQuery({
    queryKey: modelLibraryKeys.storageSettings,
    queryFn: getStorageSettings,
  });

  const storageConfigured = Boolean(storageSettingsQuery.data?.configured);

  const projectsQuery = useQuery({
    queryKey: modelLibraryKeys.projects,
    queryFn: listModelProjects,
    enabled: storageConfigured,
  });

  const tagsQuery = useQuery({
    queryKey: activeProjectId ? modelLibraryKeys.tags(activeProjectId) : ["modelTags", "empty"],
    queryFn: () => listModelTags(activeProjectId),
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

  const modelsQuery = useQuery({
    queryKey: activeProjectId ? modelLibraryKeys.models(activeProjectId, activeTagFilter, activeGender) : ["models", "empty"],
    queryFn: () => listModels({ projectId: activeProjectId, tagFilter: activeTagFilter, gender: activeGender }),
    enabled: Boolean(activeProjectId),
  });

  const allModelsQuery = useQuery({
    queryKey: activeProjectId ? modelLibraryKeys.models(activeProjectId) : ["models", "all", "empty"],
    queryFn: () => listModels({ projectId: activeProjectId }),
    enabled: Boolean(activeProjectId),
  });

  const createModelMutation = useMutation({
    mutationFn: async (gender: "female" | "male") => {
      if (!activeProjectId) throw new Error(t("common:labels.selectProjectFirst"));
      const result = await importModelEntries(activeProjectId, [{ gender }]);
      const model = result.imported[0];
      if (!model) throw new Error(result.failed[0]?.errors[0]?.message || t("modelLibrary:fetchModelsFailed"));
      return { model, gender };
    },
    onSuccess: async ({ model, gender }) => {
      if (activeGender && activeGender !== gender) toggleGender(gender);
      if (hasLibraryTagFilter(activeTagFilter)) setActiveTagFilter(EMPTY_LIBRARY_TAG_FILTER);
      setDeleteConfirmModelId("");
      await queryClient.invalidateQueries({ queryKey: ["models", activeProjectId] });
      await queryClient.invalidateQueries({ queryKey: activeProjectId ? modelLibraryKeys.tags(activeProjectId) : modelLibraryKeys.tagRoot });
      openEditor(model.id);
    },
  });

  const updateModelNameMutation = useMutation({
    mutationFn: ({ modelId, name }: { modelId: string; name: string }) => updateModel(modelId, { name }),
    onSuccess: async (_result, variables) => {
      setModelRenameErrors((errors) => {
        const next = { ...errors };
        delete next[variables.modelId];
        return next;
      });
      await queryClient.invalidateQueries({ queryKey: ["models", activeProjectId] });
    },
    onError: (error, variables) => {
      setModelRenameErrors((errors) => ({
        ...errors,
        [variables.modelId]: error instanceof Error ? error.message : String(error),
      }));
    },
  });

  const deleteModelMutation = useMutation({
    mutationFn: deleteModel,
    onSuccess: async () => {
      setDeleteConfirmModelId("");
      closeEditor();
      await queryClient.invalidateQueries({ queryKey: ["models", activeProjectId] });
      await queryClient.invalidateQueries({ queryKey: activeProjectId ? modelLibraryKeys.tags(activeProjectId) : modelLibraryKeys.tagRoot });
    },
  });

  const updateModelTagsMutation = useMutation({
    mutationFn: ({ modelId, tags }: { modelId: string; tags: string[] }) => updateModel(modelId, { tags }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["models", activeProjectId] });
      await queryClient.invalidateQueries({ queryKey: activeProjectId ? modelLibraryKeys.tags(activeProjectId) : modelLibraryKeys.tagRoot });
    },
  });

  const bulkModelEntriesMutation = useMutation({
    mutationFn: ({ operation, tags: tagNames }: { operation: "delete" | "add_tags" | "remove_tags"; tags?: string[] }) => {
      if (!activeProjectId) throw new Error(t("common:labels.selectProjectFirst"));
      return bulkModelEntries({
        project_id: activeProjectId,
        entry_ids: bulkSelection.selectedIdList,
        operation,
        ...(tagNames ? { tags: tagNames } : {}),
      });
    },
    onSuccess: async (result) => {
      bulkSelection.clearSelection();
      closeEditor();
      showImageActionToast("ready", t("common:bulk.operationCompleted", { count: result.deleted || result.updated }));
      await queryClient.invalidateQueries({ queryKey: ["models", activeProjectId] });
      await queryClient.invalidateQueries({ queryKey: activeProjectId ? modelLibraryKeys.tags(activeProjectId) : modelLibraryKeys.tagRoot });
      await queryClient.invalidateQueries({ queryKey: modelLibraryKeys.projects });
    },
    onError: (error) => {
      showImageActionToast("error", t("common:bulk.operationFailed", { message: error instanceof Error ? error.message : String(error) }));
    },
  });

  const uploadModelImageMutation = useMutation({
    mutationFn: async ({ modelId, file }: { modelId: string; file: File }) => {
      const payload = await createLibraryAssetUploadPayload(file);
      return uploadModelImage(modelId, payload);
    },
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({ queryKey: modelLibraryKeys.images(variables.modelId) });
      await queryClient.invalidateQueries({ queryKey: ["models", activeProjectId] });
    },
  });

  const deleteModelImageMutation = useMutation({
    mutationFn: deleteModelImage,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: modelLibraryKeys.images(openModelId) });
      await queryClient.invalidateQueries({ queryKey: ["models", activeProjectId] });
    },
  });

  const setModelCoverMutation = useMutation({
    mutationFn: ({ modelId, imageId }: { modelId: string; imageId: string }) =>
      updateModel(modelId, { cover_image_id: imageId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["models", activeProjectId] });
    },
  });

  const createProjectMutation = useMutation({
    mutationFn: createModelProject,
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: modelLibraryKeys.projects });
      setActiveProjectId(project.id);
      setCreateProjectOpen(false);
    },
  });

  const createTagMutation = useMutation({
    mutationFn: (name: string) => {
      if (!activeProjectId) throw new Error(t("common:labels.selectProjectFirst"));
      return createModelTag(activeProjectId, name);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: activeProjectId ? modelLibraryKeys.tags(activeProjectId) : modelLibraryKeys.tagRoot });
    },
  });

  const updateTagMutation = useMutation({
    mutationFn: ({ tagId, name, sort_order, color }: { tagId: string; name?: string; sort_order?: number; color?: LibraryTagColor }) => {
      if (!activeProjectId) throw new Error(t("common:labels.selectProjectFirst"));
      return updateModelTag(activeProjectId, tagId, {
        ...(name !== undefined ? { name } : {}),
        ...(sort_order !== undefined ? { sort_order } : {}),
        ...(color !== undefined ? { color } : {}),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: activeProjectId ? modelLibraryKeys.tags(activeProjectId) : modelLibraryKeys.tagRoot });
    },
  });

  const deleteTagMutation = useMutation({
    mutationFn: (tagId: string) => {
      if (!activeProjectId) throw new Error(t("common:labels.selectProjectFirst"));
      return deleteModelTag(activeProjectId, tagId);
    },
    onSuccess: async (result, tagId) => {
      setDeleteConfirmTagId("");
      if (activeTagFilter.includeTagIds.includes(tagId) || activeTagFilter.excludeTagIds.includes(tagId)) {
        setActiveTagFilter(createLibraryTagFilter(
          activeTagFilter.includeTagIds.filter((activeTagId) => activeTagId !== tagId),
          activeTagFilter.excludeTagIds.filter((activeTagId) => activeTagId !== tagId),
        ));
      }
      await queryClient.invalidateQueries({ queryKey: activeProjectId ? modelLibraryKeys.tags(activeProjectId) : modelLibraryKeys.tagRoot });
      await queryClient.invalidateQueries({ queryKey: ["models", activeProjectId] });
    },
  });

  const renameProjectMutation = useMutation({
    mutationFn: ({ projectId, name, sort_order }: { projectId: string; name?: string; sort_order?: number }) => updateModelProject(projectId, {
      ...(name !== undefined ? { name } : {}),
      ...(sort_order !== undefined ? { sort_order } : {}),
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: modelLibraryKeys.projects });
      setRenamingProjectId("");
    },
  });

  const deleteProjectMutation = useMutation({
    mutationFn: deleteModelProject,
    onSuccess: async (_result, projectId) => {
      const remaining = projects.filter((project) => project.id !== projectId);
      setDeleteConfirmProjectId("");
      setCloseMenuToken((token) => token + 1);
      if (activeProjectId === projectId) setActiveProjectId(remaining[0]?.id || "");
      await queryClient.invalidateQueries({ queryKey: modelLibraryKeys.projects });
      await queryClient.invalidateQueries({ queryKey: ["models"] });
      await queryClient.invalidateQueries({ queryKey: activeProjectId ? modelLibraryKeys.tags(activeProjectId) : modelLibraryKeys.tagRoot });
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

  function handleReorderProjects(nextProjects: ModelProject[]) {
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

  function handleSaveModelName(modelId: string, name: string) {
    const nextName = normalizeLibraryName(name);
    if (!isSafeLibraryFileName(nextName)) {
      setModelRenameErrors((errors) => ({ ...errors, [modelId]: t("common:errors.invalidFileNameCharacters") }));
      return;
    }
    const allModels = allModelsQuery.data?.models || models;
    const duplicate = allModels.some((model) => model.id !== modelId && normalizeLibraryName(model.name) === nextName);
    if (duplicate) {
      setModelRenameErrors((errors) => ({ ...errors, [modelId]: t("common:errors.nameAlreadyExists") }));
      return;
    }
    setModelRenameErrors((errors) => {
      if (!errors[modelId]) return errors;
      const next = { ...errors };
      delete next[modelId];
      return next;
    });
    updateModelNameMutation.mutate({ modelId, name: nextName });
  }

  function clearModelRenameError(modelId: string) {
    setModelRenameErrors((errors) => {
      if (!errors[modelId]) return errors;
      const next = { ...errors };
      delete next[modelId];
      return next;
    });
  }

  function handleDeleteModel(modelId: string, isConfirming: boolean) {
    if (!isConfirming) {
      setDeleteConfirmModelId(modelId);
      return;
    }
    deleteModelMutation.mutate(modelId);
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
    const queryKey = activeProjectId ? modelLibraryKeys.tags(activeProjectId) : modelLibraryKeys.tagRoot;
    const previous = queryClient.getQueryData<{ tags: ModelTag[] }>(queryKey);
    queryClient.setQueryData<{ tags: ModelTag[] }>(queryKey, (current) => current ? {
      tags: current.tags.map((tag) => tag.id === tagId ? { ...tag, color: normalizeLibraryTagColor(color) } : tag),
    } : current);
    updateTagMutation.mutate({ tagId, color }, {
      onError: () => {
        if (previous) queryClient.setQueryData(queryKey, previous);
      },
    });
  }

  function handleReorderTags(nextTags: ModelTag[]) {
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

  function handleToggleModelTag(modelId: string, tagName: string) {
    const model = models.find((item) => item.id === modelId);
    if (!model) return;
    const nextTags = toggleTag(model.tags, tagName);
    updateModelTagsMutation.mutate({ modelId, tags: nextTags });
  }

  const librarySort = useLibrarySort();
  const models = useMemo(
    () => sortLibraryItems(modelsQuery.data?.models || [], {
      field: librarySort.sortField,
      direction: librarySort.sortDirection,
    }),
    [librarySort.sortDirection, librarySort.sortField, modelsQuery.data?.models],
  );
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  const filteredModels = useMemo(() => {
    if (!normalizedSearchQuery) return models;
    return models.filter((model) => {
      const searchableText = [model.name, ...model.tags].join(" ").toLocaleLowerCase();
      return searchableText.includes(normalizedSearchQuery);
    });
  }, [models, normalizedSearchQuery]);
  const filteredModelIds = useMemo(() => filteredModels.map((model) => model.id), [filteredModels]);
  useEffect(() => {
    bulkSelection.pruneSelection(filteredModelIds);
  }, [bulkSelection.pruneSelection, filteredModelIds]);
  useEffect(() => {
    bulkSelection.exitSelectionMode();
  }, [activeProjectId]);
  useEffect(() => {
    if (bulkSelection.selectionMode) closeEditor();
  }, [bulkSelection.selectionMode, closeEditor]);
  const tags = tagsQuery.data?.tags || [];
  const tagCounts = useMemo(() => countLibraryTags(filteredModels, tags), [filteredModels, tags]);
  const activeProject = projects.find((project) => project.id === activeProjectId) || null;
  const imagesQuery = useQuery({
    queryKey: openModelId ? modelLibraryKeys.images(openModelId) : ["modelImages", "empty"],
    queryFn: () => listModelImages(openModelId),
    enabled: Boolean(openModelId),
  });
  const images = imagesQuery.data?.images || [];
  const errorMessage = getRequestError([
    projectsQuery.error,
    tagsQuery.error,
    modelsQuery.error,
    imagesQuery.error,
    createModelMutation.error,
    createProjectMutation.error,
    renameProjectMutation.error,
    deleteProjectMutation.error,
    deleteModelMutation.error,
    updateModelTagsMutation.error,
    bulkModelEntriesMutation.error,
    uploadModelImageMutation.error,
    deleteModelImageMutation.error,
    setModelCoverMutation.error,
    createTagMutation.error,
    updateTagMutation.error,
    deleteTagMutation.error,
  ]);

  return (
    <section className="library-page" aria-label={t("modelLibrary:title")}>
      <div className="library-layout">
        <LibraryProjectSidebar<ModelProject>
          projects={projects}
          activeProjectId={activeProjectId}
          renamingProjectId={renamingProjectId}
          deleteConfirmProjectId={deleteConfirmProjectId}
          ariaLabel={t("modelLibrary:projectRail")}
          projectActionsLabel={(name) => t("modelLibrary:projectActions", { name })}
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
            <ModelToolbar
              tags={tags}
              tagFilter={activeTagFilter}
              tagCounts={tagCounts}
              activeGender={activeGender}
              onTagToggle={handleToggleTagFilter}
              onTagExclude={handleExcludeTagFilter}
              onTagClear={() => setActiveTagFilter(EMPTY_LIBRARY_TAG_FILTER)}
              onUntaggedToggle={handleToggleUntaggedFilter}
              onGenderToggle={toggleGender}
              selectionMode={bulkSelection.selectionMode}
              onEnterSelectionMode={bulkSelection.enterSelectionMode}
              onExitSelectionMode={bulkSelection.exitSelectionMode}
            />
          </div>

          <div className="library-body scrollbar-thin-stable">
            {errorMessage ? <div className="library-error">{t("modelLibrary:requestFailed", { message: errorMessage })}</div> : null}
            {projectsQuery.isLoading ? <div className="library-empty">{t("common:states.loadingProjects")}</div> : null}
            {!projectsQuery.isLoading && !projects.length ? <div className="library-empty">{t("common:empty.noProjects")}</div> : null}
            {activeProject ? (
              <>
                <ModelGrid
                  models={filteredModels}
                  openModelId={openModelId}
                  creating={createModelMutation.isPending}
                  savingModelId={updateModelNameMutation.isPending ? updateModelNameMutation.variables?.modelId || "" : ""}
                  deletingModelId={deleteModelMutation.isPending ? deleteModelMutation.variables || "" : ""}
                  deleteConfirmModelId={deleteConfirmModelId}
                  tags={tags}
                  images={images}
                  onCreate={(gender) => createModelMutation.mutate(gender)}
                  onOpenModel={(modelId) => {
                    setDeleteConfirmModelId("");
                    openEditor(modelId);
                  }}
                  onSaveModelName={handleSaveModelName}
                  onCloseEditor={closeEditor}
                  onDeleteModel={handleDeleteModel}
                  onToggleTag={handleToggleModelTag}
                  onUploadImage={(modelId, file) => uploadModelImageMutation.mutate({ modelId, file })}
                  onDeleteImage={(imageId) => deleteModelImageMutation.mutate(imageId)}
                  onSetCover={(modelId, imageId) => setModelCoverMutation.mutate({ modelId, imageId })}
                  onImageActionStatus={showImageActionToast}
                  renameErrors={modelRenameErrors}
                  onClearRenameError={clearModelRenameError}
                  selectionMode={bulkSelection.selectionMode}
                  selectedIds={bulkSelection.selectedIds}
                  onToggleSelected={bulkSelection.toggleSelected}
                />
              </>
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
      <LibraryTagManagerDialog<ModelTag>
        isOpen={tagManagerOpen}
        tags={tags}
        isCreating={createTagMutation.isPending}
        deleteConfirmTagId={deleteConfirmTagId}
        titleId="tag-manager-title"
        description={t("modelLibrary:tagManagerDescription")}
        emptyText={t("common:empty.noTagsYet")}
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
          totalMatchingCount={filteredModels.length}
          tags={tags}
          isBusy={bulkModelEntriesMutation.isPending}
          onExitSelectionMode={bulkSelection.exitSelectionMode}
          onSelectMatching={() => bulkSelection.selectMatching(filteredModelIds)}
          onClearSelection={bulkSelection.clearSelection}
          onOpenTagManager={() => setTagManagerOpen(true)}
          onAddTags={(tagNames) => bulkModelEntriesMutation.mutate({ operation: "add_tags", tags: tagNames })}
          onRemoveTags={(tagNames) => bulkModelEntriesMutation.mutate({ operation: "remove_tags", tags: tagNames })}
          onDeleteSelected={() => bulkModelEntriesMutation.mutate({ operation: "delete" })}
        />
      ) : null}
    </section>
  );
}

