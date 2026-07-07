import { FormEvent, useEffect, useMemo, useState } from "react";
import { CheckSquare, Settings, Tags, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { normalizeLibraryTagColor, type LibraryTagColor } from "../library-tags";

export interface LibraryBulkTag {
  id: string;
  name: string;
  color?: LibraryTagColor | string | null;
}

type BulkTagMode = "add" | "remove";

export function LibraryBulkActions({
  selectionMode,
  selectedCount,
  totalMatchingCount,
  tags,
  isBusy,
  onExitSelectionMode,
  onSelectMatching,
  onClearSelection,
  onOpenTagManager,
  onAddTags,
  onRemoveTags,
  onDeleteSelected,
}: {
  selectionMode: boolean;
  selectedCount: number;
  totalMatchingCount: number;
  tags: LibraryBulkTag[];
  isBusy: boolean;
  onExitSelectionMode: () => void;
  onSelectMatching: () => void;
  onClearSelection: () => void;
  onOpenTagManager: () => void;
  onAddTags: (tagNames: string[]) => void;
  onRemoveTags: (tagNames: string[]) => void;
  onDeleteSelected: () => void;
}) {
  const { t } = useTranslation();
  const [tagDialogMode, setTagDialogMode] = useState<BulkTagMode | null>(null);
  const [deleteConfirming, setDeleteConfirming] = useState(false);

  useEffect(() => {
    if (!selectionMode) {
      setTagDialogMode(null);
      setDeleteConfirming(false);
    }
  }, [selectionMode]);

  useEffect(() => {
    if (!deleteConfirming) return;
    const timeout = window.setTimeout(() => setDeleteConfirming(false), 3000);
    return () => window.clearTimeout(timeout);
  }, [deleteConfirming]);

  if (!selectionMode) return null;

  return (
    <>
      <div className="library-bulk-bar" role="region" aria-label={t("common:bulk.selectionMode")}>
        <div className="library-bulk-bar__summary">
          <strong>{t("common:bulk.selectedCount", { count: selectedCount })}</strong>
          <span>{t("common:bulk.matchingCount", { count: totalMatchingCount })}</span>
        </div>
        <div className="library-bulk-bar__actions">
          <button type="button" disabled={isBusy || !totalMatchingCount} onClick={onSelectMatching}>
            <CheckSquare size={17} aria-hidden="true" />
            <span>{t("common:bulk.selectMatching")}</span>
          </button>
          <button type="button" disabled={isBusy || !selectedCount} onClick={onClearSelection}>
            <X size={17} aria-hidden="true" />
            <span>{t("common:bulk.clearSelection")}</span>
          </button>
          <button type="button" disabled={isBusy || !selectedCount || !tags.length} onClick={() => setTagDialogMode("add")}>
            <Tags size={17} aria-hidden="true" />
            <span>{t("common:bulk.addTags")}</span>
          </button>
          <button type="button" disabled={isBusy || !selectedCount || !tags.length} onClick={() => setTagDialogMode("remove")}>
            <Tags size={17} aria-hidden="true" />
            <span>{t("common:bulk.removeTags")}</span>
          </button>
          <button type="button" disabled={isBusy} onClick={onOpenTagManager}>
            <Settings size={17} aria-hidden="true" />
            <span>{t("common:labels.manageTags")}</span>
          </button>
          <button
            className={`danger${deleteConfirming ? " confirming" : ""}`}
            type="button"
            disabled={isBusy || !selectedCount}
            onClick={() => {
              if (!deleteConfirming) {
                setDeleteConfirming(true);
                return;
              }
              setDeleteConfirming(false);
              onDeleteSelected();
            }}
          >
            <Trash2 size={17} aria-hidden="true" />
            <span>{deleteConfirming ? t("common:bulk.confirmDelete") : t("common:bulk.deleteSelected")}</span>
          </button>
          <button type="button" disabled={isBusy} onClick={onExitSelectionMode}>
            <X size={17} aria-hidden="true" />
            <span>{t("common:actions.close")}</span>
          </button>
        </div>
      </div>

      <BulkTagDialog
        mode={tagDialogMode}
        tags={tags}
        isBusy={isBusy}
        selectedCount={selectedCount}
        onClose={() => setTagDialogMode(null)}
        onSubmit={(tagNames) => {
          if (tagDialogMode === "add") onAddTags(tagNames);
          if (tagDialogMode === "remove") onRemoveTags(tagNames);
          setTagDialogMode(null);
        }}
      />
    </>
  );
}

export function LibraryBulkManageButton({
  disabled = false,
  onClick,
}: {
  disabled?: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      className="library-bulk-manage-button"
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={t("common:bulk.manage")}
      title={t("common:bulk.manage")}
    >
      <Settings size={18} aria-hidden="true" />
    </button>
  );
}

function BulkTagDialog({
  mode,
  tags,
  selectedCount,
  isBusy,
  onClose,
  onSubmit,
}: {
  mode: BulkTagMode | null;
  tags: LibraryBulkTag[];
  selectedCount: number;
  isBusy: boolean;
  onClose: () => void;
  onSubmit: (tagNames: string[]) => void;
}) {
  const { t } = useTranslation();
  const [selectedTagNames, setSelectedTagNames] = useState<Set<string>>(() => new Set());
  const selectedTagNameList = useMemo(() => Array.from(selectedTagNames), [selectedTagNames]);

  useEffect(() => {
    setSelectedTagNames(new Set());
  }, [mode]);

  if (!mode) return null;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!selectedTagNameList.length) return;
    onSubmit(selectedTagNameList);
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        className="library-bulk-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-bulk-tag-dialog-title"
        onSubmit={handleSubmit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog__head">
          <h2 id="library-bulk-tag-dialog-title">
            {mode === "add" ? t("common:bulk.addTags") : t("common:bulk.removeTags")}
          </h2>
          <p>{t("common:bulk.selectedCount", { count: selectedCount })}</p>
        </div>
        <div className="library-bulk-tag-list" aria-label={t("common:labels.tagList")}>
          {tags.map((tag) => {
            const selected = selectedTagNames.has(tag.name);
            return (
              <button
                key={tag.id}
                className={selected ? "selected" : ""}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  setSelectedTagNames((current) => {
                    const next = new Set(current);
                    if (next.has(tag.name)) {
                      next.delete(tag.name);
                    } else {
                      next.add(tag.name);
                    }
                    return next;
                  });
                }}
              >
                <span className={`library-tag-color-dot library-tag-color-dot--${normalizeLibraryTagColor(tag.color)}`} aria-hidden="true" />
                <span>{tag.name}</span>
              </button>
            );
          })}
        </div>
        <div className="dialog__actions">
          <button className="button" type="button" disabled={isBusy} onClick={onClose}>
            {t("common:actions.cancel")}
          </button>
          <button className="button primary" type="submit" disabled={isBusy || !selectedTagNameList.length}>
            {mode === "add" ? t("common:bulk.addTags") : t("common:bulk.removeTags")}
          </button>
        </div>
      </form>
    </div>
  );
}
