import { LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CanvasTransferProgress, CanvasTransferType } from "../../app/appConfig";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Progress } from "../../components/ui/progress";

export interface ActiveCanvasTransfer extends CanvasTransferProgress {
  canceling?: boolean;
}

function formatBytes(value: number) {
  if (!(value > 0)) return "";
  const units = ["B", "KB", "MB", "GB"];
  let amount = value;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  return `${amount >= 10 || unitIndex === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unitIndex]}`;
}

function transferTitleKey(type: CanvasTransferType) {
  if (type === "upload") return "infiniteCanvas:canvasTransferUploadTitle";
  if (type === "import") return "infiniteCanvas:canvasTransferImportTitle";
  return "infiniteCanvas:canvasTransferExportTitle";
}

export function CanvasTransferProgressDialog({
  transfer,
  onCancel,
}: {
  transfer: ActiveCanvasTransfer | null;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const percent = Math.max(0, Math.min(100, Math.round(transfer?.percent || 0)));
  const loadedText = formatBytes(transfer?.loadedBytes || 0);
  const totalText = formatBytes(transfer?.totalBytes || 0);

  return (
    <Dialog open={Boolean(transfer)}>
      <DialogContent
        className="sm:max-w-md"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{transfer ? t(transferTitleKey(transfer.transferType)) : t("infiniteCanvas:canvasTransferExportTitle")}</DialogTitle>
          <DialogDescription>
            {transfer ? t(`infiniteCanvas:canvasTransferPhase.${transfer.phase}`) : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Progress value={percent} aria-label={t("infiniteCanvas:canvasTransferProgress")} />
          <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>{loadedText && totalText ? `${loadedText} / ${totalText}` : t("infiniteCanvas:canvasTransferPreparing")}</span>
            <span>{percent}%</span>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={transfer?.canceling} onClick={onCancel}>
            {transfer?.canceling ? <LoaderCircle data-icon="inline-start" className="animate-spin" aria-hidden="true" /> : null}
            {t("common:actions.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
