import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LibraryAssetPickerContent } from "./LibraryAssetPickerContent";
import type { LibraryAssetSelection, LibraryAssetTab } from "./types";

export type { LibraryAssetSelection } from "./types";

interface LibraryAssetPickerDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (selection: LibraryAssetSelection) => void;
  sources?: readonly LibraryAssetTab[];
  initialTab?: LibraryAssetTab;
  title?: string;
}

export function LibraryAssetPickerDialog({
  open,
  onClose,
  onSelect,
  sources,
  initialTab = "outfits",
  title,
}: LibraryAssetPickerDialogProps) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="library-asset-picker-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="library-asset-picker library-asset-picker--dialog nodrag nopan" role="dialog" aria-modal="true" aria-labelledby="library-asset-picker-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="library-asset-picker__head">
          <div>
            <h2 id="library-asset-picker-title">{title || t("infiniteCanvas:importFromLibrary")}</h2>
          </div>
          <button type="button" aria-label={t("common:actions.close")} title={t("common:actions.close")} onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <LibraryAssetPickerContent enabled={open} sources={sources} initialTab={initialTab} onSelect={onSelect} />
      </section>
    </div>,
    document.body,
  );
}
