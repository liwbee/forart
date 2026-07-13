import { FormEvent, useEffect, useMemo, useState } from "react";
import { CheckSquare, Settings, Tags, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AppScrollArea } from "../../components/AppScrollArea";
import { ConfirmingDeleteButton } from "../../components/ConfirmingDeleteButton";
import { Button } from "../../components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { LibraryTagChoiceButton, type LibraryTagColor } from "../library-tags";

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

  useEffect(() => {
    if (!selectionMode) {
      setTagDialogMode(null);
    }
  }, [selectionMode]);

  if (!selectionMode) return null;

  return (
    <>
      <div className="library-bulk-bar" role="region" aria-label={t("common:bulk.selectionMode")}>
        <div className="library-bulk-bar__summary">
          <strong>{t("common:bulk.selectedCount", { count: selectedCount })}</strong>
          <span>{t("common:bulk.matchingCount", { count: totalMatchingCount })}</span>
        </div>
        <div className="library-bulk-bar__actions">
          <Button type="button" variant="default" disabled={isBusy || !totalMatchingCount} onClick={onSelectMatching}>
            <CheckSquare data-icon="inline-start" aria-hidden="true" />
            <span>{t("common:bulk.selectMatching")}</span>
          </Button>
          <Button type="button" variant="default" disabled={isBusy || !selectedCount} onClick={onClearSelection}>
            <X data-icon="inline-start" aria-hidden="true" />
            <span>{t("common:bulk.clearSelection")}</span>
          </Button>
          <Button type="button" variant="default" disabled={isBusy || !selectedCount || !tags.length} onClick={() => setTagDialogMode("add")}>
            <Tags data-icon="inline-start" aria-hidden="true" />
            <span>{t("common:bulk.addTags")}</span>
          </Button>
          <Button type="button" variant="default" disabled={isBusy || !selectedCount || !tags.length} onClick={() => setTagDialogMode("remove")}>
            <Tags data-icon="inline-start" aria-hidden="true" />
            <span>{t("common:bulk.removeTags")}</span>
          </Button>
          <Button type="button" variant="default" disabled={isBusy} onClick={onOpenTagManager}>
            <Settings data-icon="inline-start" aria-hidden="true" />
            <span>{t("common:labels.manageTags")}</span>
          </Button>
          <ConfirmingDeleteButton
            disabled={isBusy || !selectedCount}
            icon={<Trash2 size={17} aria-hidden="true" />}
            label={t("common:bulk.deleteSelected")}
            confirmLabel={t("common:bulk.confirmDelete")}
            resetKey={`${selectionMode}-${selectedCount}`}
            onDelete={onDeleteSelected}
          />
          <Button className="library-bulk-bar__close" type="button" variant="ghost" size="icon" disabled={isBusy} onClick={onExitSelectionMode} aria-label={t("common:actions.close")} title={t("common:actions.close")}>
            <X aria-hidden="true" />
          </Button>
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
    <Button
      className="library-bulk-manage-button"
      type="button"
      variant="default"
      size="icon"
      disabled={disabled}
      onClick={onClick}
      aria-label={t("common:bulk.manage")}
      title={t("common:bulk.manage")}
    >
      <Settings aria-hidden="true" />
    </Button>
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

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (isBusy || !selectedTagNameList.length) return;
    onSubmit(selectedTagNameList);
  }

  const title = mode === "add" ? t("common:bulk.addTags") : t("common:bulk.removeTags");

  return (
    <Dialog open={mode !== null} onOpenChange={(open) => {
      if (!open) onClose();
    }}>
      <DialogContent asChild className="library-bulk-dialog overflow-hidden">
        <form onSubmit={handleSubmit}>
          <DialogHeader className="text-left">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{t("common:bulk.selectedCount", { count: selectedCount })}</DialogDescription>
          </DialogHeader>
          <AppScrollArea className="library-bulk-tag-list" viewportClassName="library-bulk-tag-list__viewport" aria-label={t("common:labels.tagList")}>
            {tags.map((tag) => {
              const selected = selectedTagNames.has(tag.name);
              return (
                <LibraryTagChoiceButton
                  key={tag.id}
                  mode="select"
                  name={tag.name}
                  color={tag.color}
                  selected={selected}
                  onToggleSelect={() => {
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
                />
              );
            })}
          </AppScrollArea>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" type="button">
                {t("common:actions.cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={isBusy || !selectedTagNameList.length}>
              {title}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
