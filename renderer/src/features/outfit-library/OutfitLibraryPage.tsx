import { ChangeEvent, FormEvent, KeyboardEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Grid3X3, ImagePlus, Images, LayoutTemplate, MoreHorizontal, Pencil, Plus, Tags, Trash2, Users } from "lucide-react";
import { createPortal } from "react-dom";
import { ImageViewer } from "../../lib/ImageViewer";
import { sortByName } from "../../lib/sortByName";
import {
  createOutfit,
  createOutfitProject,
  createOutfitTag,
  deleteOutfit,
  deleteOutfitProject,
  deleteOutfitTag,
  getStorageSettings,
  listOutfitProjects,
  listOutfits,
  listOutfitTags,
  outfitLibraryKeys,
  updateOutfit,
  updateOutfitProject,
  updateOutfitTag,
} from "./api";
import { listModelImages, listModelProjects, listModels, listModelTags, modelLibraryKeys } from "../model-library/api";
import { useModelLibraryStore } from "../model-library/modelLibraryStore";
import { useOutfitLibraryStore } from "./outfitLibraryStore";
import { AssetUploadPayload, OutfitEntry, OutfitProject, OutfitTag } from "./types";
import { normalizeTags, toggleTag } from "../model-library/tagUtils";
import { OutfitComposer } from "./OutfitComposer";

type ComposerLibrary = "models" | "outfits";
type SidebarProject = Pick<OutfitProject, "id" | "name">;

function getRequestError(errors: unknown[]) {
  const first = errors.find(Boolean);
  if (!first) return "";
  return first instanceof Error ? first.message : String(first);
}

function fileToUploadPayload(file: File): Promise<AssetUploadPayload> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => {
      const result = String(reader.result || "");
      const base64 = result.includes(",") ? result.split(",")[1] || "" : "";
      resolve({
        filename: file.name,
        mime_type: file.type || "image/png",
        data: base64,
      });
    };
    reader.readAsDataURL(file);
  });
}

function OutfitProjectSidebar({
  projects,
  activeProjectId,
  showLibrarySwitch,
  activeLibrary,
  canManageProjects,
  renamingProjectId,
  deleteConfirmProjectId,
  onSelect,
  onCreateProject,
  onLibraryChange,
  onRenameStart,
  onRenameCancel,
  onRenameSubmit,
  onDeleteProject,
  closeMenuToken,
}: {
  projects: SidebarProject[];
  activeProjectId: string;
  showLibrarySwitch: boolean;
  activeLibrary: ComposerLibrary;
  canManageProjects: boolean;
  renamingProjectId: string;
  deleteConfirmProjectId: string;
  onSelect: (projectId: string) => void;
  onCreateProject: () => void;
  onLibraryChange: (library: ComposerLibrary) => void;
  onRenameStart: (projectId: string) => void;
  onRenameCancel: () => void;
  onRenameSubmit: (projectId: string, name: string) => void;
  onDeleteProject: (projectId: string, isConfirming: boolean) => void;
  closeMenuToken: number;
}) {
  const { t } = useTranslation();
  const [menuState, setMenuState] = useState<{ projectId: string; x: number; y: number }>({ projectId: "", x: 0, y: 0 });
  const [draftName, setDraftName] = useState("");
  const menuProjectId = menuState.projectId;

  useEffect(() => {
    const project = projects.find((item) => item.id === renamingProjectId);
    setDraftName(project?.name || "");
  }, [projects, renamingProjectId]);

  useEffect(() => {
    setMenuState({ projectId: "", x: 0, y: 0 });
  }, [closeMenuToken]);

  useEffect(() => {
    if (!menuProjectId) return;
    function closeMenu() {
      setMenuState({ projectId: "", x: 0, y: 0 });
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
  }, [menuProjectId]);

  function submitRename(projectId: string) {
    onRenameSubmit(projectId, draftName);
  }

  function handleRenameKeyDown(event: KeyboardEvent<HTMLInputElement>, projectId: string) {
    if (event.key === "Enter") {
      event.preventDefault();
      submitRename(projectId);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onRenameCancel();
    }
  }

  function openMenuAt(projectId: string, x: number, y: number) {
    const menuWidth = 168;
    const menuHeight = 92;
    const pad = 8;
    setMenuState({
      projectId,
      x: Math.max(pad, Math.min(x, window.innerWidth - menuWidth - pad)),
      y: Math.max(pad, Math.min(y, window.innerHeight - menuHeight - pad)),
    });
  }

  function toggleMenu(event: MouseEvent<HTMLButtonElement>, projectId: string) {
    event.stopPropagation();
    if (menuProjectId === projectId) {
      setMenuState({ projectId: "", x: 0, y: 0 });
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    openMenuAt(projectId, rect.right + 6, rect.top);
  }

  return (
    <aside className="model-project-rail" aria-label={t("outfitLibrary.projectRail")}>
      {showLibrarySwitch ? (
        <div className="library-rail-switch" aria-label={t("outfitLibrary.switchLibrary")}>
          <button
            className={activeLibrary === "models" ? "active" : ""}
            type="button"
            aria-pressed={activeLibrary === "models"}
            onClick={() => onLibraryChange("models")}
          >
            <Users size={18} aria-hidden="true" />
            <span>{t("outfitLibrary.modelLibrary")}</span>
          </button>
          <button
            className={activeLibrary === "outfits" ? "active" : ""}
            type="button"
            aria-pressed={activeLibrary === "outfits"}
            onClick={() => onLibraryChange("outfits")}
          >
            <Images size={18} aria-hidden="true" />
            <span>{t("outfitLibrary.outfitLibrary")}</span>
          </button>
        </div>
      ) : (
        <button className="model-project-add" type="button" onClick={onCreateProject}>
          <Plus size={18} aria-hidden="true" />
          <span>{t("common.labels.newProject")}</span>
        </button>
      )}

      <div className="model-project-list">
        {projects.length ? (
          projects.map((project) => {
            const isActive = project.id === activeProjectId;
            const isRenaming = project.id === renamingProjectId;

            return (
              <div key={project.id} className={`model-project-row${isActive ? " active" : ""}${isRenaming ? " renaming" : ""}`}>
                {isRenaming ? (
                  <input
                    className="model-project-rename-input"
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                    onBlur={() => submitRename(project.id)}
                    onKeyDown={(event) => handleRenameKeyDown(event, project.id)}
                    autoFocus
                    maxLength={120}
                    aria-label={t("common.labels.projectName")}
                  />
                ) : (
                  <button
                    className="model-project-list-item"
                    type="button"
                    aria-current={isActive ? "true" : undefined}
                    onClick={() => onSelect(project.id)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      if (canManageProjects) openMenuAt(project.id, event.clientX, event.clientY);
                    }}
                  >
                    <span>{project.name || "Untitled Project"}</span>
                  </button>
                )}

                {canManageProjects ? (
                  <button
                    className="model-project-menu-button"
                    type="button"
                    aria-label={t("outfitLibrary.projectActions", { name: project.name || "Untitled Project" })}
                    aria-expanded={menuProjectId === project.id}
                    onClick={(event) => toggleMenu(event, project.id)}
                  >
                    <MoreHorizontal size={18} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            );
          })
        ) : (
          <div className="model-project-list-empty">{t("common.empty.noProjects")}</div>
        )}
      </div>

      {menuProjectId ? createPortal(
        <div
          className="project-row-menu"
          role="menu"
          style={{ left: menuState.x, top: menuState.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const projectId = menuProjectId;
              setMenuState({ projectId: "", x: 0, y: 0 });
              onRenameStart(projectId);
            }}
          >
            <Pencil size={16} aria-hidden="true" />
            <span>{t("common.actions.rename")}</span>
          </button>
          <button
            className={deleteConfirmProjectId === menuProjectId ? "danger confirming" : "danger"}
            type="button"
            role="menuitem"
            onClick={() => {
              const projectId = menuProjectId;
              const isConfirming = deleteConfirmProjectId === projectId;
              onDeleteProject(projectId, isConfirming);
            }}
          >
            <Trash2 size={16} aria-hidden="true" />
            <span>{deleteConfirmProjectId === menuProjectId ? t("common.confirm.delete") : t("common.actions.delete")}</span>
          </button>
        </div>,
        document.body,
      ) : null}
    </aside>
  );
}

function OutfitToolbar({
  tags,
  activeTagId,
  onTagChange,
  onOpenTagManager,
}: {
  tags: OutfitTag[];
  activeTagId: string;
  onTagChange: (tagId: string) => void;
  onOpenTagManager: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="model-toolbar outfit-toolbar">
      <div className="library-tag-section">
        <span className="library-filter-label">{t("common.labels.tags")}</span>
        <button className="model-tag-add-button" type="button" aria-label={t("common.labels.manageTags")} title={t("common.labels.manageTags")} onClick={onOpenTagManager}>
          <Pencil size={18} aria-hidden="true" />
        </button>
        <div className="library-tag-controls">
          <div className="library-tag-filter">
            <button className={activeTagId ? "" : "active"} type="button" onClick={() => onTagChange("")}>
              {t("common.labels.all")}
            </button>
            {tags.map((tag) => (
              <button
                key={tag.id}
                className={activeTagId === tag.id ? "active" : ""}
                type="button"
                onClick={() => onTagChange(tag.id)}
              >
                {tag.name}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function AddOutfitCard({ disabled, onCreate }: { disabled: boolean; onCreate: (file: File) => void }) {
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
        <strong>{disabled ? t("common.states.uploading") : t("outfitLibrary.addOutfit")}</strong>
      </button>
      <input ref={inputRef} type="file" accept="image/*" onChange={handleFileChange} hidden />
    </div>
  );
}

function OutfitCard({
  outfit,
  tags,
  deleteConfirmOutfitId,
  isDeleting,
  onToggleTag,
  onDelete,
}: {
  outfit: OutfitEntry;
  tags: OutfitTag[];
  deleteConfirmOutfitId: string;
  isDeleting: boolean;
  onToggleTag: (outfitId: string, tagName: string) => void;
  onDelete: (outfitId: string, isConfirming: boolean) => void;
}) {
  const { t } = useTranslation();
  const [menuState, setMenuState] = useState<{ open: boolean; x: number; y: number }>({ open: false, x: 0, y: 0 });
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const assetUrl = outfit.asset_url ? `${outfit.asset_url}?t=${encodeURIComponent(outfit.updated_at || outfit.asset_id)}` : "";
  const imageAlt = outfit.name || t("outfitLibrary.outfitImage");

  useEffect(() => {
    if (!menuState.open && !tagMenuOpen) return;
    function closeMenu() {
      setMenuState({ open: false, x: 0, y: 0 });
      setTagMenuOpen(false);
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
  }, [menuState.open, tagMenuOpen]);

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
  }

  return (
    <div className="outfit-card">
      <div
        className="outfit-card__image"
        role={assetUrl ? "button" : undefined}
        tabIndex={assetUrl ? 0 : undefined}
        aria-label={assetUrl ? t("outfitLibrary.imagePreview", { name: imageAlt }) : undefined}
        onClick={() => {
          if (assetUrl) setViewerOpen(true);
        }}
        onKeyDown={(event) => {
          if (!assetUrl) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setViewerOpen(true);
          }
        }}
      >
        {assetUrl ? (
          <img src={assetUrl} alt={imageAlt} loading="lazy" draggable={false} onDragStart={(event) => event.preventDefault()} />
        ) : (
          <div className="placeholder">{t("common.empty.noImage")}</div>
        )}
      </div>
      {outfit.tags.length ? (
        <div className="outfit-card__tags" aria-label={t("outfitLibrary.outfitTags")}>
          {outfit.tags.slice(0, 3).map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      ) : null}
      <button className="outfit-card__menu-button" type="button" aria-label={t("outfitLibrary.outfitActions")} aria-expanded={menuState.open} onClick={openMenu}>
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
              <button type="button" role="menuitem" onClick={() => setTagMenuOpen((open) => !open)}>
                <Tags size={16} aria-hidden="true" />
                <span>{t("common.labels.tags")}</span>
              </button>
              {tagMenuOpen ? (
                <div className="outfit-tag-menu" aria-label={t("outfitLibrary.chooseTags")}>
                  {tags.length ? (
                    tags.map((tag) => (
                      <button
                        key={tag.id}
                        className={outfit.tags.includes(tag.name) ? "selected" : ""}
                        type="button"
                        onClick={() => onToggleTag(outfit.id, tag.name)}
                      >
                        {tag.name}
                      </button>
                    ))
                  ) : (
                    <div className="outfit-tag-menu__empty">{t("outfitLibrary.noTags")}</div>
                  )}
                </div>
              ) : null}
              <button
                className={deleteConfirmOutfitId === outfit.id ? "danger confirming" : "danger"}
                type="button"
                role="menuitem"
                disabled={isDeleting}
                onClick={() => onDelete(outfit.id, deleteConfirmOutfitId === outfit.id)}
              >
                <Trash2 size={16} aria-hidden="true" />
                <span>{deleteConfirmOutfitId === outfit.id ? t("common.confirm.delete") : t("common.actions.delete")}</span>
              </button>
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
  onCreate,
  onToggleTag,
  onDelete,
}: {
  outfits: OutfitEntry[];
  tags: OutfitTag[];
  creating: boolean;
  deletingOutfitId: string;
  deleteConfirmOutfitId: string;
  onCreate: (file: File) => void;
  onToggleTag: (outfitId: string, tagName: string) => void;
  onDelete: (outfitId: string, isConfirming: boolean) => void;
}) {
  return (
    <div className="outfit-grid">
      <AddOutfitCard disabled={creating} onCreate={onCreate} />
      {outfits.map((outfit) => (
        <OutfitCard
          key={outfit.id}
          outfit={outfit}
          tags={tags}
          deleteConfirmOutfitId={deleteConfirmOutfitId}
          isDeleting={deletingOutfitId === outfit.id}
          onToggleTag={onToggleTag}
          onDelete={onDelete}
        />
      ))}
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
          <h2 id="create-outfit-project-title">{t("common.labels.newProject")}</h2>
          <p>{t("outfitLibrary.createProjectDescription")}</p>
        </div>
        <label className="dialog-field">
          <span>{t("common.labels.projectName")}</span>
          <input value={name} onChange={(event) => setName(event.target.value)} autoFocus maxLength={120} placeholder={t("outfitLibrary.projectPlaceholder")} />
        </label>
        <div className="dialog__actions">
          <button className="button secondary" type="button" onClick={onClose} disabled={isCreating}>
            {t("common.actions.cancel")}
          </button>
          <button className="button primary" type="submit" disabled={isCreating}>
            {isCreating ? t("common.states.creating") : t("common.actions.create")}
          </button>
        </div>
      </form>
    </div>
  );
}

function OutfitTagManager({
  isOpen,
  tags,
  isCreating,
  deleteConfirmTagId,
  onClose,
  onCreateTag,
  onRenameTag,
  onDeleteTag,
}: {
  isOpen: boolean;
  tags: OutfitTag[];
  isCreating: boolean;
  deleteConfirmTagId: string;
  onClose: () => void;
  onCreateTag: (name: string) => void;
  onRenameTag: (tagId: string, name: string) => void;
  onDeleteTag: (tagId: string, isConfirming: boolean) => void;
}) {
  const { t } = useTranslation();
  const [selectedTagId, setSelectedTagId] = useState("");
  const [newTagName, setNewTagName] = useState("");
  const [draftTagName, setDraftTagName] = useState("");
  const selectedTag = tags.find((tag) => tag.id === selectedTagId) || null;

  useEffect(() => {
    if (!isOpen) {
      setSelectedTagId("");
      setNewTagName("");
      setDraftTagName("");
      return;
    }
    if (!selectedTagId && tags.length) {
      setSelectedTagId(tags[0].id);
      return;
    }
    if (selectedTagId && !tags.some((tag) => tag.id === selectedTagId)) {
      setSelectedTagId(tags[0]?.id || "");
    }
  }, [isOpen, selectedTagId, tags]);

  useEffect(() => {
    setDraftTagName(selectedTag?.name || "");
  }, [selectedTag?.id, selectedTag?.name]);

  if (!isOpen) return null;

  function submitActiveTagRename() {
    if (!selectedTag) return;
    const nextName = normalizeTags([draftTagName])[0] || "";
    if (!nextName || nextName === selectedTag.name) {
      setDraftTagName(selectedTag.name);
      return;
    }
    onRenameTag(selectedTag.id, nextName);
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="model-tag-manager" role="dialog" aria-modal="true" aria-labelledby="outfit-tag-manager-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog__head">
          <h2 id="outfit-tag-manager-title">{t("common.labels.manageTags")}</h2>
          <p>{t("outfitLibrary.tagManagerDescription")}</p>
        </div>

        <div className="dialog-field">
          <span>{t("common.labels.newTag")}</span>
          <div className="tag-create-row">
            <input value={newTagName} onChange={(event) => setNewTagName(event.target.value)} maxLength={24} placeholder={t("common.labels.tagNamePlaceholder")} />
            <button
              className="button primary"
              type="button"
              disabled={isCreating}
              onClick={() => {
                onCreateTag(newTagName);
                setNewTagName("");
              }}
            >
              {t("common.actions.add")}
            </button>
          </div>
        </div>

        <div className="model-tag-manager__body">
          <div className="model-tag-manager__list" aria-label={t("common.labels.tagList")}>
            {tags.map((tag) => {
              const selected = selectedTagId === tag.id;
              return (
                <button key={tag.id} className={selected ? "active" : ""} type="button" onClick={() => setSelectedTagId(tag.id)}>
                  {tag.name}
                </button>
              );
            })}
            {!tags.length ? <div className="model-tag-manager__empty">{t("outfitLibrary.noTags")}</div> : null}
          </div>

          {selectedTag ? (
            <div className="model-tag-manager__editor">
              <label className="dialog-field">
                <span>{t("common.labels.editTag")}</span>
                <input
                  value={draftTagName}
                  onChange={(event) => setDraftTagName(event.target.value)}
                  onBlur={submitActiveTagRename}
                  maxLength={24}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      submitActiveTagRename();
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setDraftTagName(selectedTag.name);
                    }
                  }}
                />
              </label>
              <button
                className={`button danger${deleteConfirmTagId === selectedTag.id ? " confirming" : ""}`}
                type="button"
                onClick={() => onDeleteTag(selectedTag.id, deleteConfirmTagId === selectedTag.id)}
              >
                {deleteConfirmTagId === selectedTag.id ? t("common.confirm.delete") : t("common.actions.delete")}
              </button>
            </div>
          ) : (
            <div className="model-tag-manager__editor model-tag-manager__editor--empty">{t("common.labels.emptyTagEditor")}</div>
          )}
        </div>
      </section>
    </div>
  );
}

export function OutfitLibraryPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<"library" | "composer">("library");
  const [composerLibrary, setComposerLibrary] = useState<ComposerLibrary>("outfits");
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [renamingProjectId, setRenamingProjectId] = useState("");
  const [deleteConfirmProjectId, setDeleteConfirmProjectId] = useState("");
  const [deleteConfirmOutfitId, setDeleteConfirmOutfitId] = useState("");
  const [deleteConfirmTagId, setDeleteConfirmTagId] = useState("");
  const [closeMenuToken, setCloseMenuToken] = useState(0);
  const activeProjectId = useOutfitLibraryStore((state) => state.activeProjectId);
  const activeTagId = useOutfitLibraryStore((state) => state.activeTagId);
  const setActiveProjectId = useOutfitLibraryStore((state) => state.setActiveProjectId);
  const setActiveTagId = useOutfitLibraryStore((state) => state.setActiveTagId);
  const activeModelProjectId = useModelLibraryStore((state) => state.activeProjectId);
  const activeModelTagId = useModelLibraryStore((state) => state.activeTagId);
  const setActiveModelProjectId = useModelLibraryStore((state) => state.setActiveProjectId);
  const setActiveModelTagId = useModelLibraryStore((state) => state.setActiveTagId);

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
    queryKey: outfitLibraryKeys.tags,
    queryFn: listOutfitTags,
    enabled: storageConfigured,
  });

  const projects = useMemo(() => projectsQuery.data?.projects || [], [projectsQuery.data?.projects]);

  const modelProjectsQuery = useQuery({
    queryKey: modelLibraryKeys.projects,
    queryFn: listModelProjects,
    enabled: storageConfigured,
  });

  const modelTagsQuery = useQuery({
    queryKey: modelLibraryKeys.tags,
    queryFn: listModelTags,
    enabled: storageConfigured,
  });

  const modelProjects = useMemo(() => modelProjectsQuery.data?.projects || [], [modelProjectsQuery.data?.projects]);

  useEffect(() => {
    if (!activeProjectId && projects.length) setActiveProjectId(projects[0].id);
    if (activeProjectId && projects.length && !projects.some((project) => project.id === activeProjectId)) {
      setActiveProjectId(projects[0].id);
    }
  }, [activeProjectId, projects, setActiveProjectId]);

  useEffect(() => {
    const tags = tagsQuery.data?.tags || [];
    if (activeTagId && !tags.some((tag) => tag.id === activeTagId)) setActiveTagId("");
  }, [activeTagId, setActiveTagId, tagsQuery.data?.tags]);

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
    queryKey: activeProjectId ? outfitLibraryKeys.outfits(activeProjectId, activeTagId) : ["outfits", "empty"],
    queryFn: () => listOutfits({ projectId: activeProjectId, tagId: activeTagId }),
    enabled: Boolean(activeProjectId),
  });

  const modelsQuery = useQuery({
    queryKey: activeModelProjectId ? modelLibraryKeys.models(activeModelProjectId, activeModelTagId) : ["models", "empty"],
    queryFn: () => listModels({ projectId: activeModelProjectId, tagId: activeModelTagId }),
    enabled: storageConfigured && viewMode === "composer" && composerLibrary === "models" && Boolean(activeModelProjectId),
  });

  const createOutfitMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!activeProjectId) throw new Error(t("common.labels.selectProjectFirst"));
      const payload = await fileToUploadPayload(file);
      return createOutfit(activeProjectId, payload);
    },
    onSuccess: async () => {
      if (activeTagId) setActiveTagId("");
      setDeleteConfirmOutfitId("");
      await queryClient.invalidateQueries({ queryKey: ["outfits", activeProjectId] });
      await queryClient.invalidateQueries({ queryKey: outfitLibraryKeys.projects });
      await queryClient.invalidateQueries({ queryKey: outfitLibraryKeys.tags });
    },
  });

  const deleteOutfitMutation = useMutation({
    mutationFn: deleteOutfit,
    onSuccess: async () => {
      setDeleteConfirmOutfitId("");
      await queryClient.invalidateQueries({ queryKey: ["outfits", activeProjectId] });
      await queryClient.invalidateQueries({ queryKey: outfitLibraryKeys.projects });
      await queryClient.invalidateQueries({ queryKey: outfitLibraryKeys.tags });
    },
  });

  const updateOutfitTagsMutation = useMutation({
    mutationFn: ({ outfitId, tags }: { outfitId: string; tags: string[] }) => updateOutfit(outfitId, { tags }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["outfits", activeProjectId] });
      await queryClient.invalidateQueries({ queryKey: outfitLibraryKeys.tags });
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
    mutationFn: ({ projectId, name }: { projectId: string; name: string }) => updateOutfitProject(projectId, { name }),
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
      await queryClient.invalidateQueries({ queryKey: outfitLibraryKeys.tags });
    },
  });

  const createTagMutation = useMutation({
    mutationFn: createOutfitTag,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: outfitLibraryKeys.tags });
    },
  });

  const renameTagMutation = useMutation({
    mutationFn: ({ tagId, name }: { tagId: string; name: string }) => updateOutfitTag(tagId, { name }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: outfitLibraryKeys.tags });
    },
  });

  const deleteTagMutation = useMutation({
    mutationFn: deleteOutfitTag,
    onSuccess: async (_result, tagId) => {
      setDeleteConfirmTagId("");
      if (activeTagId === tagId) setActiveTagId("");
      await queryClient.invalidateQueries({ queryKey: outfitLibraryKeys.tags });
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
    renameTagMutation.mutate({ tagId, name: next });
  }

  function handleDeleteTag(tagId: string, isConfirming: boolean) {
    if (!isConfirming) {
      setDeleteConfirmTagId(tagId);
      return;
    }
    deleteTagMutation.mutate(tagId);
  }

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
  const tags = tagsQuery.data?.tags || [];
  const modelTags = modelTagsQuery.data?.tags || [];
  const activeProject = projects.find((project) => project.id === activeProjectId) || null;
  const activeModelProject = modelProjects.find((project) => project.id === activeModelProjectId) || null;
  const sidebarLibrary: ComposerLibrary = viewMode === "composer" ? composerLibrary : "outfits";
  const sidebarProjects = sidebarLibrary === "models" ? modelProjects : projects;
  const sidebarProjectId = sidebarLibrary === "models" ? activeModelProjectId : activeProjectId;
  const activeComposerProject = composerLibrary === "models" ? activeModelProject : activeProject;
  const composerTags = composerLibrary === "models" ? modelTags : tags;
  const composerTagId = composerLibrary === "models" ? activeModelTagId : activeTagId;
  const composerAssets = composerLibrary === "models"
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
    projectsQuery.error,
    modelProjectsQuery.error,
    tagsQuery.error,
    modelTagsQuery.error,
    outfitsQuery.error,
    modelsQuery.error,
    createOutfitMutation.error,
    deleteOutfitMutation.error,
    updateOutfitTagsMutation.error,
    createProjectMutation.error,
    renameProjectMutation.error,
    deleteProjectMutation.error,
    createTagMutation.error,
    renameTagMutation.error,
    deleteTagMutation.error,
  ]);

  return (
    <section className="model-library-page outfit-library-page" aria-labelledby="outfit-library-title">
      <div className="model-library-header">
        <div className="outfit-view-switch" aria-label="Outfit library view">
          <button className={viewMode === "library" ? "active" : ""} type="button" aria-pressed={viewMode === "library"} onClick={() => setViewMode("library")}>
            <Grid3X3 size={18} aria-hidden="true" />
            <span>{t("outfitLibrary.composerViewLibrary")}</span>
          </button>
          <button className={viewMode === "composer" ? "active" : ""} type="button" aria-pressed={viewMode === "composer"} onClick={() => setViewMode("composer")}>
            <LayoutTemplate size={18} aria-hidden="true" />
            <span>{t("outfitLibrary.composerViewCanvas")}</span>
          </button>
        </div>
        <h1 id="outfit-library-title" className="model-library-title">{t("outfitLibrary.title")}</h1>
      </div>

      <div className="model-library">
        <OutfitProjectSidebar
          projects={sidebarProjects}
          activeProjectId={sidebarProjectId}
          showLibrarySwitch={viewMode === "composer"}
          activeLibrary={composerLibrary}
          canManageProjects={sidebarLibrary === "outfits"}
          renamingProjectId={renamingProjectId}
          deleteConfirmProjectId={deleteConfirmProjectId}
          onSelect={(projectId) => {
            setDeleteConfirmProjectId("");
            setRenamingProjectId("");
            if (sidebarLibrary === "models") {
              setActiveModelProjectId(projectId);
            } else {
              setActiveProjectId(projectId);
            }
          }}
          onCreateProject={() => setCreateProjectOpen(true)}
          onLibraryChange={(library) => {
            setDeleteConfirmProjectId("");
            setRenamingProjectId("");
            setCloseMenuToken((token) => token + 1);
            setComposerLibrary(library);
          }}
          onRenameStart={(projectId) => {
            setDeleteConfirmProjectId("");
            setRenamingProjectId(projectId);
          }}
          onRenameCancel={() => setRenamingProjectId("")}
          onRenameSubmit={submitProjectRename}
          onDeleteProject={handleProjectDelete}
          closeMenuToken={closeMenuToken}
        />

        <main className="model-content-pane">
          {viewMode === "library" ? <div className="model-content-head">
            <OutfitToolbar
              tags={tags}
              activeTagId={activeTagId}
              onTagChange={setActiveTagId}
              onOpenTagManager={() => setTagManagerOpen(true)}
            />
          </div> : null}

          <div className={`model-lib-body${viewMode === "composer" ? " model-lib-body--composer" : ""}`}>
            {errorMessage ? <div className="model-lib-error">{t("outfitLibrary.requestFailed", { message: errorMessage })}</div> : null}
            {storageSettingsQuery.isLoading || projectsQuery.isLoading || (viewMode === "composer" && composerLibrary === "models" && modelProjectsQuery.isLoading) ? <div className="model-lib-empty">{t("common.states.loadingProjects")}</div> : null}
            {!storageConfigured ? <div className="model-lib-empty">{t("outfitLibrary.storageUnavailable")}</div> : null}
            {storageConfigured && viewMode === "library" && !projectsQuery.isLoading && !projects.length ? <div className="model-lib-empty">{t("common.empty.noProjects")}</div> : null}
            {storageConfigured && viewMode === "composer" && !modelProjectsQuery.isLoading && !sidebarProjects.length ? <div className="model-lib-empty">{t("common.empty.noProjects")}</div> : null}
            {activeProject && viewMode === "library" ? (
              <OutfitGrid
                outfits={outfits}
                tags={tags}
                creating={createOutfitMutation.isPending}
                deletingOutfitId={deleteOutfitMutation.isPending ? deleteOutfitMutation.variables || "" : ""}
                deleteConfirmOutfitId={deleteConfirmOutfitId}
                onCreate={(file) => createOutfitMutation.mutate(file)}
                onToggleTag={handleToggleOutfitTag}
                onDelete={handleOutfitDelete}
              />
            ) : null}
            {activeComposerProject && viewMode === "composer" ? (
              <OutfitComposer
                assets={composerAssets}
                tags={composerTags}
                activeTagId={composerTagId}
                onTagChange={composerLibrary === "models" ? setActiveModelTagId : setActiveTagId}
                onLoadAssetChoices={composerLibrary === "models" ? loadModelImageChoices : undefined}
                assetTitle={composerLibrary === "models" ? t("outfitLibrary.modelAssets") : t("outfitLibrary.outfitAssets")}
                assetAltText={composerLibrary === "models" ? t("outfitLibrary.modelImage") : t("outfitLibrary.outfitImage")}
                emptyText={composerLibrary === "models" ? t("outfitLibrary.noFilteredModels") : t("outfitLibrary.noFilteredOutfits")}
                canvasEmptyText={composerLibrary === "models" ? t("outfitLibrary.canvasEmptyModels") : t("outfitLibrary.canvasEmptyOutfits")}
                tagFilterLabel={composerLibrary === "models" ? t("outfitLibrary.filterModelTags") : t("outfitLibrary.filterOutfitTags")}
                cardVariant={composerLibrary === "models" ? "choice" : "direct"}
              />
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
      <OutfitTagManager
        isOpen={tagManagerOpen}
        tags={tags}
        isCreating={createTagMutation.isPending}
        deleteConfirmTagId={deleteConfirmTagId}
        onClose={() => setTagManagerOpen(false)}
        onCreateTag={handleCreateTag}
        onRenameTag={handleRenameTag}
        onDeleteTag={handleDeleteTag}
      />
    </section>
  );
}

