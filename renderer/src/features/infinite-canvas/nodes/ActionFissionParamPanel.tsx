import { Download, Shuffle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../components/ui/button";
import { ButtonGroup } from "../../../components/ui/button-group";
import type { NativeCanvasNodeData } from "../nativeCanvas";
import { ImageGeneratorParamPanel } from "./ImageGeneratorParamPanel";

interface ActionFissionParamPanelProps {
  nodeId: string;
  data: NativeCanvasNodeData;
  visible: boolean;
  canRandomize: boolean;
  onRandomize: () => void;
  canDownload: boolean;
  isDownloading: boolean;
  onDownload: () => void | Promise<void>;
  canRun: boolean;
  isRunning: boolean;
  onRun: () => void | Promise<void>;
  onStop: () => void | Promise<void>;
}

export function ActionFissionParamPanel({
  nodeId,
  data,
  visible,
  canRandomize,
  onRandomize,
  canDownload,
  isDownloading,
  onDownload,
  canRun,
  isRunning,
  onRun,
  onStop,
}: ActionFissionParamPanelProps) {
  const { t } = useTranslation();

  return (
    <ImageGeneratorParamPanel
      nodeId={nodeId}
      data={data}
      visible={visible}
      showPrompt={false}
      showImageCount={false}
      runDisabled={!canRun && !isRunning}
      taskRunningOverride={isRunning}
      onRun={onRun}
      onStop={onStop}
      beforeRunControl={(
        <ButtonGroup>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={!canDownload || isDownloading}
            aria-label={t("infiniteCanvas:actionFissionDownloadAll")}
            title={t("infiniteCanvas:actionFissionDownloadAll")}
            onClick={onDownload}
          >
            <Download aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={!canRandomize}
            aria-label={t("infiniteCanvas:actionFissionSwitchAllActions")}
            title={t("infiniteCanvas:actionFissionSwitchAllActions")}
            onClick={onRandomize}
          >
            <Shuffle aria-hidden="true" />
          </Button>
        </ButtonGroup>
      )}
    />
  );
}
