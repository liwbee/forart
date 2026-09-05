import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppSelect } from "../../components/AppSelect";
import { Field, FieldGroup, FieldLabel } from "../../components/ui/field";
import type { ForartAgentSettings } from "../../app/appConfig";
import {
  API_PROVIDER_CHANGED_EVENT,
  getModelDisplayName,
  isChatProviderConfigured,
  loadApiSettings,
  orderedApiProviders,
  readApiSettings,
  type ApiSettings,
} from "./apiProviders";
import {
  AGENT_SETTINGS_CHANGED_EVENT,
  loadAgentSettings,
  readAgentSettings,
  saveAgentSettings,
} from "./agentSettings";

interface AgentSettingsPanelProps {
  hidden?: boolean;
}

function modelValue(providerId: string, model: string) {
  return `${providerId}\u0000${model}`;
}

function parseModelValue(value: string) {
  const separator = value.indexOf("\u0000");
  if (separator < 1) return null;
  const providerId = value.slice(0, separator).trim();
  const model = value.slice(separator + 1).trim();
  return providerId && model ? { providerId, model } : null;
}

export function AgentSettingsPanel({ hidden = false }: AgentSettingsPanelProps) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<ForartAgentSettings>(() => readAgentSettings());
  const [apiSettings, setApiSettings] = useState<ApiSettings>(() => readApiSettings());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let canceled = false;
    void Promise.all([loadAgentSettings(), loadApiSettings()]).then(([nextAgentSettings, nextApiSettings]) => {
      if (canceled) return;
      setSettings(nextAgentSettings);
      setApiSettings(nextApiSettings);
      setLoaded(true);
    }).catch(() => {
      if (!canceled) setLoaded(true);
    });
    return () => { canceled = true; };
  }, []);

  useEffect(() => {
    const syncApiSettings = () => {
      setApiSettings(readApiSettings());
    };
    const syncAgentSettings = () => setSettings((current) => {
      const next = readAgentSettings();
      const currentRoute = current.imageGeneratorPromptOptimization;
      const nextRoute = next.imageGeneratorPromptOptimization;
      if (current.thinkingMode === next.thinkingMode
        && current.reasoningLevel === next.reasoningLevel
        && currentRoute?.providerId === nextRoute?.providerId
        && currentRoute?.model === nextRoute?.model) return current;
      return next;
    });
    window.addEventListener(API_PROVIDER_CHANGED_EVENT, syncApiSettings);
    window.addEventListener(AGENT_SETTINGS_CHANGED_EVENT, syncAgentSettings);
    return () => {
      window.removeEventListener(API_PROVIDER_CHANGED_EVENT, syncApiSettings);
      window.removeEventListener(AGENT_SETTINGS_CHANGED_EVENT, syncAgentSettings);
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const timer = window.setTimeout(() => {
      void saveAgentSettings(settings).catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [loaded, settings]);

  const modelOptions = useMemo(() => {
    const providers = orderedApiProviders(apiSettings.providers, apiSettings.providerOrder)
      .filter(isChatProviderConfigured);
    return [
      { value: "", label: t("settings:agentModelNone") },
      ...providers.flatMap((provider) => provider.chatModels.map((model) => ({
        value: modelValue(provider.id, model),
        label: `${provider.name} / ${getModelDisplayName(provider, "chat", model)}`,
      }))),
    ];
  }, [apiSettings.providerOrder, apiSettings.providers, t]);

  const selectedModel = settings.imageGeneratorPromptOptimization;
  const selectedModelValue = selectedModel ? modelValue(selectedModel.providerId, selectedModel.model) : "";
  const reasoningValue = settings.thinkingMode ? settings.reasoningLevel : "none";

  return (
    <div hidden={hidden}>
      <div className="settings-layout" role="tabpanel" aria-label={t("settings:agentSettings")}>
        <section className="settings-section" aria-label={t("settings:agentSettings")}>
          <div className="settings-section__head">
            <div>
              <h2>{t("settings:agentSettings")}</h2>
            </div>
          </div>

          <FieldGroup className="settings-subsection">
            <Field orientation="horizontal" className="settings-download-path-row">
              <h3>{t("settings:agentOptimization")}</h3>
              <div className="settings-agent-controls">
                <Field className="settings-agent-control">
                  <FieldLabel className="settings-agent-control__label">{t("settings:agentReasoningLevel")}</FieldLabel>
                  <AppSelect
                    value={reasoningValue}
                    options={[
                      { value: "none", label: t("settings:agentReasoningNone") },
                      { value: "minimal", label: t("settings:agentReasoningMinimal") },
                      { value: "low", label: t("settings:agentReasoningLow") },
                      { value: "medium", label: t("settings:agentReasoningMedium") },
                      { value: "high", label: t("settings:agentReasoningHigh") },
                      { value: "xhigh", label: t("settings:agentReasoningXhigh") },
                      { value: "max", label: t("settings:agentReasoningMax") },
                    ]}
                    onChange={(value) => setSettings((current) => value === "none"
                      ? { ...current, thinkingMode: false }
                      : {
                        ...current,
                        thinkingMode: true,
                        reasoningLevel: value as ForartAgentSettings["reasoningLevel"],
                      })}
                    ariaLabel={t("settings:agentReasoningLevel")}
                    className="settings-agent-reasoning-select"
                    size="sm"
                  />
                </Field>
                <Field className="settings-agent-control">
                  <FieldLabel className="settings-agent-control__label">{t("settings:agentLlmModel")}</FieldLabel>
                  <AppSelect
                    value={selectedModelValue}
                    options={modelOptions}
                    onChange={(value) => setSettings((current) => ({
                      ...current,
                      imageGeneratorPromptOptimization: parseModelValue(value),
                    }))}
                    ariaLabel={t("settings:agentLlmModel")}
                    placeholder={t("settings:agentModelNone")}
                    size="sm"
                  />
                </Field>
              </div>
            </Field>
          </FieldGroup>
        </section>
      </div>
    </div>
  );
}
