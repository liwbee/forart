import { Bot, Play, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Select } from "../../../components/Select";
import { getModelDisplayName, type ApiProvider } from "../../settings/apiProviders";
import type { CanvasNode } from "../types";

interface LlmNodeBodyProps {
  node: CanvasNode;
  providers: ApiProvider[];
  selectedProvider: ApiProvider | null;
  selectedModel: string;
  selectOpen: boolean;
  onSelectOpenChange: (open: boolean) => void;
  onPatch: (patch: Partial<CanvasNode>) => void;
  onRun: () => void;
  onStop: () => void;
}

export function LlmNodeBody({
  node,
  providers,
  selectedProvider,
  selectedModel,
  selectOpen,
  onSelectOpenChange,
  onPatch,
  onRun,
  onStop,
}: LlmNodeBodyProps) {
  const { t } = useTranslation();
  const modelOptions = providers.flatMap((provider) => provider.chatModels.map((model) => ({
    value: `${provider.id}:${model}`,
    label: getModelDisplayName(provider, "chat", model),
    providerId: provider.id,
    model,
  })));
  const selectedValue = selectedProvider && selectedModel ? `${selectedProvider.id}:${selectedModel}` : "";
  const options = modelOptions.length ? modelOptions : [{ value: "", label: t("settings:noChatModels"), providerId: "", model: "" }];

  return (
    <div className="ic-node-body ic-llm-node-body nowheel">
      <div className="ic-llm-node__top nodrag nopan">
        <Select
          className="ic-llm-node__model"
          value={selectedValue}
          options={options}
          ariaLabel={t("infiniteCanvas:chatModel")}
          disabled={!modelOptions.length}
          open={selectOpen && Boolean(modelOptions.length)}
          onOpenChange={onSelectOpenChange}
          onChange={(nextValue) => {
            const option = modelOptions.find((item) => item.value === nextValue);
            if (!option) return;
            onPatch({ chatProviderId: option.providerId, chatModel: option.model, generationError: "" });
          }}
          renderOption={(option) => (
            <span className="ic-composer-select__option-text" title={option.label}>
              <strong>{option.label}</strong>
            </span>
          )}
        />
        <button
          type="button"
          className={`ic-llm-node__run${node.running ? " is-stop" : ""}`}
          aria-label={node.running ? t("infiniteCanvas:stopRun") : t("infiniteCanvas:run")}
          title={node.running ? t("infiniteCanvas:stopRun") : t("infiniteCanvas:run")}
          disabled={!node.running && (!selectedProvider || !selectedModel)}
          onClick={() => (node.running ? onStop() : onRun())}
        >
          {node.running ? <Square size={14} aria-hidden="true" fill="currentColor" /> : <Play size={16} aria-hidden="true" fill="currentColor" />}
        </button>
      </div>
      <textarea
        className="ic-llm-node__instruction nodrag nopan nowheel"
        value={node.variablePrompt || ""}
        placeholder={t("infiniteCanvas:llmInstructionPlaceholder")}
        onChange={(event) => onPatch({ variablePrompt: event.target.value })}
      />
      <div className={`ic-llm-node__output${node.text ? "" : " empty"}`}>
        {node.running ? (
          <span className="ic-llm-node__status"><Bot size={14} aria-hidden="true" />{node.generationStatus || t("infiniteCanvas:running")}</span>
        ) : node.text || t("infiniteCanvas:llmOutputPlaceholder")}
      </div>
      {node.generationError ? <div className="ic-llm-node__error">{node.generationError}</div> : null}
    </div>
  );
}
