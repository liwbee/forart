import { Download, Play, RefreshCw, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Select } from "../../../../components/Select";
import { SizePresetPicker } from "../../../../components/SizePresetPicker";
import type { ActionEntry, ActionTag } from "../../../action-library/types";
import { getModelDisplayName, type ApiProvider } from "../../../settings/apiProviders";
import { detectImageModelRuleId, getImageModelRule, normalizeImageModelSizeSelection } from "../../../settings/imageModelRules";
import type { ActionFissionBulkActions } from "../../action-fission/actionFissionBulkActions";
import type { ActionFissionState } from "../../action-fission/actionFissionTypes";
import { listLibtvImageModels } from "../../libtv-generation/libtvGenerationApi";
import type { LibtvImageModelRecord } from "../../libtv-generation/libtvGenerationTypes";

const AUTO_SIZE_VALUE = "auto";

interface ActionFissionFooterProps {
  nodeId: string;
  state: ActionFissionState;
  selectedProvider: ApiProvider | null;
  selectedModel: string;
  libtvReady: boolean;
  openSelectId: string;
  bulkActions: ActionFissionBulkActions;
  onOpenSelectChange: (selectId: string) => void;
  onSetModel: (model: string, providerId: string, sizePatch?: Pick<ActionFissionState, "resolution" | "aspectRatio">) => void;
  onSetLibtvModel: (modelName: string) => void;
  onSetResolution: (resolution: ActionFissionState["resolution"]) => void;
  onSetAspectRatio: (aspectRatio: ActionFissionState["aspectRatio"]) => void;
  onRunAllRows: (nodeId: string, rowsData: Array<{ rowId: string; actions: ActionEntry[]; tags: ActionTag[] }>) => void;
  onSwitchAllRows: (nodeId: string, rowsData: Array<{ rowId: string; actions: ActionEntry[]; tags: ActionTag[] }>) => void;
  onDownloadAllRows: (nodeId: string, rowsData: Array<{ rowId: string }>) => void;
  onStopAllRows: (nodeId: string) => void;
}

function selectId(nodeId: string, name: string) {
  return `${nodeId}:action-fission:${name}`;
}

export function ActionFissionFooter({
  nodeId,
  state,
  selectedProvider,
  selectedModel,
  libtvReady,
  openSelectId,
  bulkActions,
  onOpenSelectChange,
  onSetModel,
  onSetLibtvModel,
  onSetResolution,
  onSetAspectRatio,
  onRunAllRows,
  onSwitchAllRows,
  onDownloadAllRows,
  onStopAllRows,
}: ActionFissionFooterProps) {
  const { t } = useTranslation();
  const [libtvModels, setLibtvModels] = useState<LibtvImageModelRecord[]>([]);
  const modelLoadSeqRef = useRef(0);
  const modelNameRef = useRef(state.libtvModelName || "");
  const setModelRef = useRef(onSetLibtvModel);

  useEffect(() => {
    modelNameRef.current = state.libtvModelName || "";
    setModelRef.current = onSetLibtvModel;
  });

  const loadLibtvModels = useCallback(() => {
    const seq = ++modelLoadSeqRef.current;
    return listLibtvImageModels()
      .then((modelResult) => {
        if (modelLoadSeqRef.current !== seq) return [];
        const models = modelResult.models || [];
        setLibtvModels(models);
        return models;
      })
      .catch(() => {
        if (modelLoadSeqRef.current !== seq) return [];
        setLibtvModels([]);
        return [];
      });
  }, []);

  useEffect(() => {
    if (state.apiType !== "libtv-api" || !libtvReady) return;
    let canceled = false;
    void loadLibtvModels().then((models) => {
      if (canceled) return;
      const currentModelName = modelNameRef.current;
      const hasCurrentModel = models.some((model) => (model.modelName || model.modelKey) === currentModelName);
      const firstModel = models[0];
      const firstModelName = firstModel ? firstModel.modelName || firstModel.modelKey : "";
      if ((!currentModelName || !hasCurrentModel) && firstModelName) {
        setModelRef.current(firstModelName);
      }
    });
    return () => {
      canceled = true;
    };
  }, [loadLibtvModels, state.apiType]);

  const renderNodeSelect = (name: string, ariaLabel: string, value: string, options: Array<{ value: string; label: string; hint?: string }>, onChange: (value: string) => void, disabled = false) => {
    const id = selectId(nodeId, name);
    return (
      <Select
        value={value}
        options={options}
        ariaLabel={ariaLabel}
        disabled={disabled}
        open={openSelectId === id && !disabled}
        onOpenChange={(open) => {
          onOpenSelectChange(open ? id : "");
          if (open && name === "model" && state.apiType === "libtv-api" && libtvReady) void loadLibtvModels();
        }}
        onChange={onChange}
        menuPlacement="top"
        maxMenuHeight={170}
      />
    );
  };
  const sizePanelId = selectId(nodeId, "size");
  const isLibtvApi = state.apiType === "libtv-api" && libtvReady;
  const modelValue = isLibtvApi ? state.libtvModelName || "" : selectedModel;
  const selectedRule = selectedProvider && selectedModel
    ? getImageModelRule(selectedProvider.modelRules.image[selectedModel] || detectImageModelRuleId(selectedModel))
    : getImageModelRule("generic-image");
  const selectedSize = isLibtvApi
    ? {
      resolution: state.resolution || "1k",
      aspectRatio: state.aspectRatio || "1:1",
    }
    : normalizeImageModelSizeSelection(selectedRule, state.resolution, state.aspectRatio);
  const selectedResolution = selectedSize.resolution || AUTO_SIZE_VALUE;
  const selectedAspectRatio = selectedSize.aspectRatio;
  const resolutionValues = isLibtvApi
    ? ["1k", "2k", "4k"]
    : selectedRule.sizeRule.resolutions.length ? selectedRule.sizeRule.resolutions : [AUTO_SIZE_VALUE];
  const aspectRatioValues = isLibtvApi
    ? ["1:1", "2:3", "3:2", "4:3", "3:4", "16:9", "9:16"]
    : selectedRule.sizeRule.aspectRatios;
  const formatSizeValueLabel = (value: string) => value === AUTO_SIZE_VALUE ? t("infiniteCanvas:auto") : value.toUpperCase();
  const modelOptions = isLibtvApi
    ? libtvModels.length
      ? libtvModels.map((model) => ({ value: model.modelName || model.modelKey, label: model.modelName || model.modelKey }))
      : [{ value: "", label: t("infiniteCanvas:libtvNoModels") }]
    : selectedProvider?.imageModels.length
      ? selectedProvider.imageModels.map((model) => ({ value: model, label: getModelDisplayName(selectedProvider, "image", model) }))
      : [{ value: "", label: t("settings:noImageModels") }];

  return (
    <div className="ic-action-fission-footer">
      <div className="ic-action-fission-params">
        {renderNodeSelect(
          "model",
          isLibtvApi ? t("infiniteCanvas:libtvModel") : t("infiniteCanvas:model"),
          modelValue,
          modelOptions,
          (value) => {
            if (isLibtvApi) {
              onSetLibtvModel(value);
              return;
            }
            const nextRule = selectedProvider ? getImageModelRule(selectedProvider.modelRules.image[value] || detectImageModelRuleId(value)) : getImageModelRule("generic-image");
            const nextSize = normalizeImageModelSizeSelection(nextRule, state.resolution, state.aspectRatio);
            onSetModel(value, selectedProvider?.id || "", nextSize);
          },
          isLibtvApi ? false : !selectedProvider,
        )}
        <SizePresetPicker
          open={openSelectId === sizePanelId}
          resolution={selectedResolution}
          aspectRatio={selectedAspectRatio}
          resolutionOptions={resolutionValues.map((value) => ({ value, label: formatSizeValueLabel(value) }))}
          aspectRatioOptions={aspectRatioValues.map((value) => ({ value, label: value === "1:1" ? t("infiniteCanvas:ratioSquare") : value === AUTO_SIZE_VALUE ? t("infiniteCanvas:auto") : value }))}
          labels={{
            trigger: `${t("infiniteCanvas:resolution")} / ${t("infiniteCanvas:ratio")}`,
            resolution: t("infiniteCanvas:resolution"),
            aspectRatio: t("infiniteCanvas:ratio"),
          }}
          formatTrigger={(resolution, aspectRatio) => [formatSizeValueLabel(resolution), aspectRatio === AUTO_SIZE_VALUE ? t("infiniteCanvas:auto") : aspectRatio].filter(Boolean).join(" / ")}
          onOpenChange={(open) => onOpenSelectChange(open ? sizePanelId : "")}
          onResolutionChange={(value) => onSetResolution(value === AUTO_SIZE_VALUE ? "" : value)}
          onAspectRatioChange={onSetAspectRatio}
        />
      </div>
      <div className="ic-action-fission-run-all">
        <button
          type="button"
          className="is-download-all"
          disabled={bulkActions.isRunning || !bulkActions.downloadableRowsData.length}
          onClick={() => onDownloadAllRows(nodeId, bulkActions.downloadableRowsData)}
        >
          <Download size={15} aria-hidden="true" />
          <span>{t("infiniteCanvas:actionFissionDownloadAll")}</span>
        </button>
        <button
          type="button"
          className="is-switch-all"
          disabled={bulkActions.isRunning || !bulkActions.canSwitchAll}
          onClick={() => onSwitchAllRows(nodeId, bulkActions.switchableRowsData)}
        >
          <RefreshCw size={15} aria-hidden="true" />
          <span>{t("infiniteCanvas:actionFissionSwitchAllActions")}</span>
        </button>
        <button
          type="button"
          className={bulkActions.isRunning ? "is-stop" : ""}
          aria-label={bulkActions.isRunning ? t("infiniteCanvas:actionFissionStopAll") : t("infiniteCanvas:actionFissionRunAll")}
          title={bulkActions.isRunning ? t("infiniteCanvas:actionFissionStopAll") : t("infiniteCanvas:actionFissionRunAll")}
          disabled={!bulkActions.isRunning && !bulkActions.canRunAll}
          onClick={() => {
            if (bulkActions.isRunning) {
              onStopAllRows(nodeId);
              return;
            }
            onRunAllRows(nodeId, bulkActions.runnableRowsData);
          }}
        >
          {bulkActions.isRunning ? <Square size={15} fill="currentColor" aria-hidden="true" /> : <Play size={17} fill="currentColor" aria-hidden="true" />}
          <span>{bulkActions.isRunning ? `${bulkActions.completedRows} / ${bulkActions.totalRows}` : t("infiniteCanvas:actionFissionRunAll")}</span>
        </button>
      </div>
    </div>
  );
}
