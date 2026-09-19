import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CircleAlert, Download, Image as ImageIcon, LoaderCircle, Shuffle, Sparkles, Square } from "lucide-react";
import { AppSelect } from "../../../components/AppSelect";
import { Alert, AlertDescription } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { ButtonGroup } from "../../../components/ui/button-group";
import {
  API_PROVIDER_CHANGED_EVENT,
  getModelDisplayName,
  isChatProviderConfigured,
  loadApiSettings,
  orderedApiProviders,
  readApiSettings,
  type ApiSettings,
} from "../../settings/apiProviders";
import { normalizeActionFissionState } from "../action-fission/actionFissionState";
import {
  DEFAULT_ACTION_FISSION_AGENT_REASONING,
  type ActionFissionAgentReasoning,
  type ActionFissionMode,
} from "../action-fission/actionFissionTypes";
import type { ActionFissionPromptGenerationBlocker } from "../action-fission/actionFissionRules";
import { useNativeCanvasActions } from "../canvasActions";
import type { NativeCanvasNodeData } from "../nativeCanvas";
import { ImageGeneratorParamPanel } from "./ImageGeneratorParamPanel";

interface ActionFissionParamPanelProps {
  nodeId: string;
  data: NativeCanvasNodeData;
  visible: boolean;
  mode: ActionFissionMode;
  canRandomize: boolean;
  onRandomize: () => void;
  canDownload: boolean;
  isDownloading: boolean;
  onDownload: () => void | Promise<void>;
  canRun: boolean;
  isRunning: boolean;
  onRun: () => void | Promise<void>;
  onStop: () => void | Promise<void>;
  agentRunning: boolean;
  agentError: string;
  /** 空字符串表示可以生成提示词，其他值是阻止原因。 */
  promptGenerationBlocker: ActionFissionPromptGenerationBlocker | "";
  onGeneratePrompts: (route: { providerId: string; model: string; reasoning: ActionFissionAgentReasoning }) => void;
  onCancelPrompts: () => void;
}

interface ActionFissionBatchActionsProps {
  grouped?: boolean;
  showRandomize?: boolean;
  canRandomize: boolean;
  onRandomize: () => void;
  canDownload: boolean;
  isDownloading: boolean;
  onDownload: () => void | Promise<void>;
}

export function ActionFissionBatchActions({
  grouped = true,
  showRandomize = true,
  canRandomize,
  onRandomize,
  canDownload,
  isDownloading,
  onDownload,
}: ActionFissionBatchActionsProps) {
  const { t } = useTranslation();
  const buttons = (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={!canDownload || isDownloading}
        aria-label={t("infiniteCanvas:actionFissionDownloadAll")}
        title={t("infiniteCanvas:actionFissionDownloadAll")}
        onClick={() => void onDownload()}
      >
        {isDownloading
          ? <LoaderCircle className="animate-spin" aria-hidden="true" />
          : <Download aria-hidden="true" />}
      </Button>
      {showRandomize ? (
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
      ) : null}
    </>
  );

  return grouped ? <ButtonGroup>{buttons}</ButtonGroup> : buttons;
}

/**
 * Agent 模式的控制行：平台 / 模型 / 推理强度 + 生成提示词。
 * 平台与模型写在节点数据上，运行状态与错误由节点主体传入。
 */
function ActionFissionAgentControls({
  nodeId,
  data,
  visible,
  agentRunning,
  agentError,
  promptGenerationBlocker,
  onGeneratePrompts,
  onCancelPrompts,
}: {
  nodeId: string;
  data: NativeCanvasNodeData;
  visible: boolean;
  agentRunning: boolean;
  agentError: string;
  promptGenerationBlocker: ActionFissionPromptGenerationBlocker | "";
  onGeneratePrompts: (route: { providerId: string; model: string; reasoning: ActionFissionAgentReasoning }) => void;
  onCancelPrompts: () => void;
}) {
  const { t } = useTranslation();
  const actions = useNativeCanvasActions();
  const [apiSettings, setApiSettings] = useState<ApiSettings>(() => readApiSettings());
  const state = useMemo(() => normalizeActionFissionState(data.actionFission), [data.actionFission]);
  const providers = useMemo(
    () => orderedApiProviders(apiSettings.providers, apiSettings.providerOrder).filter(isChatProviderConfigured),
    [apiSettings.providerOrder, apiSettings.providers],
  );
  const provider = providers.find((item) => item.id === state.agentProviderId) || providers[0] || null;
  const model = provider?.chatModels.includes(String(state.agentModel || ""))
    ? String(state.agentModel)
    : provider?.chatModels[0] || "";
  const reasoning = state.agentReasoning || DEFAULT_ACTION_FISSION_AGENT_REASONING;
  const modelMissing = !provider || !model;
  // 生图进行中、缺少参考图等硬性规则由节点主体判定：按钮直接禁用，不再额外弹提示。
  // 每次执行都是独立的一次生成，所以按钮文案固定为「生成提示词」。
  const generateLabel = t(agentRunning ? "infiniteCanvas:stopRun" : "infiniteCanvas:actionFissionAgentPrompt");
  const generateTitle = agentRunning
    ? t("infiniteCanvas:stopRun")
    : modelMissing
      ? t("infiniteCanvas:actionFissionAgentNoModel")
      : generateLabel;

  useEffect(() => {
    if (!visible) return;
    const sync = () => setApiSettings(readApiSettings());
    window.addEventListener(API_PROVIDER_CHANGED_EVENT, sync);
    void loadApiSettings().then(setApiSettings).catch(() => undefined);
    return () => window.removeEventListener(API_PROVIDER_CHANGED_EVENT, sync);
  }, [visible]);

  const patchAgentState = (patch: Partial<typeof state>) => {
    actions.patchNodeData(nodeId, { actionFission: { ...state, ...patch } });
  };

  return (
    <div className="rf-action-fission-agent-row">
      <div className="flex w-max min-w-full items-end gap-2">
        <span
          className="rf-action-fission-row-icon"
          role="img"
          aria-label={t("infiniteCanvas:actionFissionAgentPromptRowLabel")}
          title={t("infiniteCanvas:actionFissionAgentPromptRowLabel")}
        >
          <Sparkles aria-hidden="true" />
        </span>
        <div className="grid w-max min-w-0 gap-1">
          <span className="pl-2 text-[9px] font-medium leading-none text-muted-foreground">{t("infiniteCanvas:platform")}</span>
          <AppSelect
            variant="ghost"
            size="sm"
            triggerTextSize="sm"
            className="w-max min-w-0"
            menuPlacement="top"
            value={provider?.id || ""}
            placeholder={t("infiniteCanvas:noChatApiConfigured")}
            options={providers.map((item) => ({ value: item.id, label: item.name }))}
            ariaLabel={t("infiniteCanvas:platform")}
            disabled={agentRunning || !providers.length}
            onChange={(id) => {
              const next = providers.find((item) => item.id === id);
              patchAgentState({ agentProviderId: id, agentModel: next?.chatModels[0] || "" });
            }}
          />
        </div>
        <div className="grid w-max min-w-0 gap-1">
          <span className="pl-2 text-[9px] font-medium leading-none text-muted-foreground">{t("infiniteCanvas:model")}</span>
          <AppSelect
            variant="ghost"
            size="sm"
            triggerTextSize="sm"
            className="w-max min-w-0"
            menuPlacement="top"
            value={model}
            placeholder={t("infiniteCanvas:noChatApiConfigured")}
            options={(provider?.chatModels || []).map((item) => ({
              value: item,
              label: getModelDisplayName(provider, "chat", item),
            }))}
            menuHint={t("infiniteCanvas:actionFissionAgentVisionHint")}
            ariaLabel={t("infiniteCanvas:model")}
            disabled={agentRunning || !provider}
            onChange={(next) => patchAgentState({ agentProviderId: provider?.id, agentModel: next })}
          />
        </div>
        <div className="grid w-max min-w-0 gap-1">
          <span className="pl-2 text-[9px] font-medium leading-none text-muted-foreground">{t("infiniteCanvas:reasoningLevel")}</span>
          <AppSelect
            variant="ghost"
            size="sm"
            triggerTextSize="sm"
            className="w-max min-w-0"
            menuPlacement="top"
            value={reasoning}
            options={[
              { value: "none", label: t("infiniteCanvas:reasoningNone") },
              { value: "minimal", label: t("infiniteCanvas:reasoningMinimal") },
              { value: "low", label: t("infiniteCanvas:reasoningLow") },
              { value: "medium", label: t("infiniteCanvas:reasoningMedium") },
              { value: "high", label: t("infiniteCanvas:reasoningHigh") },
              { value: "xhigh", label: t("infiniteCanvas:reasoningXhigh") },
              { value: "max", label: t("infiniteCanvas:reasoningMax") },
            ]}
            ariaLabel={t("infiniteCanvas:reasoningLevel")}
            disabled={agentRunning}
            onChange={(next) => patchAgentState({ agentReasoning: next as ActionFissionAgentReasoning })}
          />
        </div>
        <span className="min-w-0 flex-1" data-parameter-panel-spacer aria-hidden="true" />
        <Button
          className="nodrag"
          type="button"
          variant="default"
          size="icon-sm"
          disabled={!agentRunning && (Boolean(promptGenerationBlocker) || modelMissing)}
          aria-label={generateTitle}
          title={generateTitle}
          onClick={() => void (agentRunning
            ? onCancelPrompts()
            : onGeneratePrompts({ providerId: provider?.id || "", model, reasoning }))}
        >
          {agentRunning
            ? <Square aria-hidden="true" fill="currentColor" />
            : <Sparkles aria-hidden="true" />}
        </Button>
      </div>
      {agentError ? (
        <Alert variant="destructive" className="rf-action-fission-agent-alert">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{agentError}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

export function ActionFissionParamPanel({
  nodeId,
  data,
  visible,
  mode,
  canRandomize,
  onRandomize,
  canDownload,
  isDownloading,
  onDownload,
  canRun,
  isRunning,
  onRun,
  onStop,
  agentRunning,
  agentError,
  promptGenerationBlocker,
  onGeneratePrompts,
  onCancelPrompts,
}: ActionFissionParamPanelProps) {
  const { t } = useTranslation();
  const agentMode = mode === "agent";
  return (
    <ImageGeneratorParamPanel
      nodeId={nodeId}
      data={data}
      visible={visible}
      // Agent 模式下这里就是「整组创作要求」编辑器，与批量洗图使用同一套 UI。
      showPrompt={agentMode}
      showImageCount={false}
      runDisabled={!canRun && !isRunning}
      taskRunningOverride={isRunning}
      onRun={onRun}
      onStop={onStop}
      aboveParameterRow={agentMode ? (
        <ActionFissionAgentControls
          nodeId={nodeId}
          data={data}
          visible={visible}
          agentRunning={agentRunning}
          agentError={agentError}
          promptGenerationBlocker={promptGenerationBlocker}
          onGeneratePrompts={onGeneratePrompts}
          onCancelPrompts={onCancelPrompts}
        />
      ) : undefined}
      leadingControl={agentMode ? (
        <span
          className="rf-action-fission-row-icon"
          role="img"
          aria-label={t("infiniteCanvas:actionFissionImageRowLabel")}
          title={t("infiniteCanvas:actionFissionImageRowLabel")}
        >
          <ImageIcon aria-hidden="true" />
        </span>
      ) : undefined}
      beforeRunControl={(
        <ActionFissionBatchActions
          showRandomize={!agentMode}
          canRandomize={canRandomize}
          onRandomize={onRandomize}
          canDownload={canDownload}
          isDownloading={isDownloading}
          onDownload={onDownload}
        />
      )}
    />
  );
}
