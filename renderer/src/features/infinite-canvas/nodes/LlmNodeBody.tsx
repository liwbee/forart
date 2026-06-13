import { Bot, Check, ChevronDown, Play, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
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
  const modelOptions = selectedProvider?.chatModels.length
    ? selectedProvider.chatModels.map((model) => ({ value: model, label: getModelDisplayName(selectedProvider, "chat", model) }))
    : [{ value: "", label: t("settings.noChatModels") }];
  const selectedOption = modelOptions.find((option) => option.value === selectedModel) || modelOptions[0];

  return (
    <div className="ic-node-body ic-llm-node-body nowheel">
      <div className="ic-llm-node__top nodrag nopan">
        <div className={`ic-composer-select ic-llm-node__model${selectOpen ? " open" : ""}${!providers.length ? " disabled" : ""}`}>
          <button
            type="button"
            className="ic-composer-select__trigger"
            aria-label={t("infiniteCanvas.chatModel")}
            aria-haspopup="listbox"
            aria-expanded={selectOpen}
            disabled={!providers.length}
            onClick={() => onSelectOpenChange(!selectOpen)}
          >
            <span title={selectedOption?.label || undefined}>{selectedOption?.label || t("settings.noChatModels")}</span>
            <ChevronDown size={18} aria-hidden="true" />
          </button>
          {selectOpen ? (
            <div className="ic-composer-select__menu" role="listbox" aria-label={t("infiniteCanvas.chatModel")}>
              {providers.flatMap((provider) => provider.chatModels.map((model) => ({ provider, model }))).map(({ provider, model }) => {
                const selected = provider.id === selectedProvider?.id && model === selectedModel;
                return (
                  <button
                    key={`${provider.id}:${model}`}
                    type="button"
                    className={selected ? "selected" : ""}
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      onPatch({ chatProviderId: provider.id, chatModel: model, generationError: "" });
                      onSelectOpenChange(false);
                    }}
                  >
                    <span className="ic-composer-select__option-text" title={getModelDisplayName(provider, "chat", model)}>
                      <strong>{getModelDisplayName(provider, "chat", model)}</strong>
                    </span>
                    {selected ? <Check size={14} aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className={`ic-llm-node__run${node.running ? " is-stop" : ""}`}
          aria-label={node.running ? t("infiniteCanvas.stopRun") : t("infiniteCanvas.run")}
          title={node.running ? t("infiniteCanvas.stopRun") : t("infiniteCanvas.run")}
          disabled={!node.running && (!selectedProvider || !selectedModel)}
          onClick={() => (node.running ? onStop() : onRun())}
        >
          {node.running ? <Square size={14} aria-hidden="true" fill="currentColor" /> : <Play size={16} aria-hidden="true" fill="currentColor" />}
        </button>
      </div>
      <textarea
        className="ic-llm-node__instruction nodrag nopan nowheel"
        value={node.variablePrompt || ""}
        placeholder={t("infiniteCanvas.llmInstructionPlaceholder")}
        onChange={(event) => onPatch({ variablePrompt: event.target.value })}
      />
      <div className={`ic-llm-node__output${node.text ? "" : " empty"}`}>
        {node.running ? (
          <span className="ic-llm-node__status"><Bot size={14} aria-hidden="true" />{node.generationStatus || t("infiniteCanvas.running")}</span>
        ) : node.text || t("infiniteCanvas.llmOutputPlaceholder")}
      </div>
      {node.generationError ? <div className="ic-llm-node__error">{node.generationError}</div> : null}
    </div>
  );
}
