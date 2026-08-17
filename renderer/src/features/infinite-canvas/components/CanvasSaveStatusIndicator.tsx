import { useTranslation } from "react-i18next";
import { Button } from "../../../components/ui/button";
import { useCanvasSaveStatus, type CanvasSaveStatus } from "../canvasSaveStatusStore";

const SAVE_STATUS_LABEL_KEYS: Record<CanvasSaveStatus, string> = {
  saved: "infiniteCanvas:saveStatusSaved",
  unsaved: "infiniteCanvas:saveStatusUnsaved",
  saving: "infiniteCanvas:saveStatusSaving",
};

export function CanvasSaveStatusIndicator({ canvasId, onSave }: {
  canvasId: string;
  onSave?: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const saveStatus = useCanvasSaveStatus(canvasId);

  return (
    <Button
      type="button"
      variant="ghost"
      className={`rf-canvas-save-status rf-canvas-save-status--${saveStatus}`}
      disabled={!onSave || saveStatus === "saving"}
      aria-label={t("infiniteCanvas:saveCanvas")}
      aria-live="polite"
      aria-atomic="true"
      title={t("infiniteCanvas:saveCanvas")}
      onClick={() => void onSave?.()}
    >
      <span className="rf-canvas-save-status__dot" aria-hidden="true" />
      <span>{t(SAVE_STATUS_LABEL_KEYS[saveStatus])}</span>
    </Button>
  );
}
