import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppSelect } from "../../components/AppSelect";
import { Button } from "../../components/ui/button";
import { Field, FieldLabel } from "../../components/ui/field";
import { Progress } from "../../components/ui/progress";
import { Switch } from "../../components/ui/switch";
import type { ForartExtensionSettings } from "../../app/appConfig";
import { API_PROVIDER_CHANGED_EVENT, getModelDisplayName, isChatProviderConfigured, loadApiSettings, orderedApiProviders, readApiSettings, type ApiSettings } from "./apiProviders";
import { EXTENSION_SETTINGS_CHANGED_EVENT, loadExtensionSettings, readExtensionSettings, saveExtensionSettings } from "./extensionSettings";

interface ExtensionSettingsPanelProps { hidden?: boolean; }
function modelValue(providerId: string, model: string) { return `${providerId}\u0000${model}`; }
function parseModelValue(value: string) { const separator = value.indexOf("\u0000"); if (separator < 1) return null; const providerId = value.slice(0, separator).trim(); const model = value.slice(separator + 1).trim(); return providerId && model ? { providerId, model } : null; }

export function ExtensionSettingsPanel({ hidden = false }: ExtensionSettingsPanelProps) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<ForartExtensionSettings>(() => readExtensionSettings());
  const [apiSettings, setApiSettings] = useState<ApiSettings>(() => readApiSettings());
  const [loaded, setLoaded] = useState(false);
  const [rmbg, setRmbg] = useState({ downloaded: false, downloading: false, size: 0, downloadedBytes: 0 });
  useEffect(() => { let canceled = false; void Promise.all([loadExtensionSettings(), loadApiSettings()]).then(([nextSettings, nextApi]) => { if (canceled) return; setSettings(nextSettings); setApiSettings(nextApi); setLoaded(true); }).catch(() => { if (!canceled) setLoaded(true); }); return () => { canceled = true; }; }, []);
  useEffect(() => { void window.easyTool?.backgroundRemovalStatus?.().then(setRmbg).catch(() => undefined); const timer = window.setInterval(() => { void window.easyTool?.backgroundRemovalStatus?.().then(setRmbg).catch(() => undefined); }, 500); return () => window.clearInterval(timer); }, []);
  const downloadRmbg = async () => { setRmbg((current) => ({ ...current, downloading: true })); try { if (window.easyTool) setRmbg(await window.easyTool.downloadBackgroundRemovalModel()); } finally { setRmbg((current) => ({ ...current, downloading: false })); } };
  const removeRmbg = async () => { try { if (window.easyTool) setRmbg(await window.easyTool.removeBackgroundRemovalModel()); } catch { void window.easyTool?.backgroundRemovalStatus?.().then(setRmbg).catch(() => undefined); } };
  useEffect(() => { const syncApi = () => setApiSettings(readApiSettings()); const syncExtension = () => setSettings(readExtensionSettings()); window.addEventListener(API_PROVIDER_CHANGED_EVENT, syncApi); window.addEventListener(EXTENSION_SETTINGS_CHANGED_EVENT, syncExtension); return () => { window.removeEventListener(API_PROVIDER_CHANGED_EVENT, syncApi); window.removeEventListener(EXTENSION_SETTINGS_CHANGED_EVENT, syncExtension); }; }, []);
  useEffect(() => { if (!loaded) return; const timer = window.setTimeout(() => { void saveExtensionSettings(settings).catch(() => undefined); }, 250); return () => window.clearTimeout(timer); }, [loaded, settings]);
  const modelOptions = useMemo(() => [{ value: "", label: t("settings:agentModelNone") }, ...orderedApiProviders(apiSettings.providers, apiSettings.providerOrder).filter(isChatProviderConfigured).flatMap((provider) => provider.chatModels.map((model) => ({ value: modelValue(provider.id, model), label: `${provider.name} / ${getModelDisplayName(provider, "chat", model)}` })))], [apiSettings, t]);
  const selectedModelValue = settings.imageGeneratorPromptOptimization ? modelValue(settings.imageGeneratorPromptOptimization.providerId, settings.imageGeneratorPromptOptimization.model) : "";
  const reasoningValue = settings.thinkingMode ? settings.reasoningLevel : "none";
  const progress = rmbg.size > 0 ? Math.max(0, Math.min(100, Math.round((rmbg.downloadedBytes / rmbg.size) * 100))) : 0;
  const reasoningOptions = [{ value: "none", label: t("settings:agentReasoningNone") }, { value: "minimal", label: t("settings:agentReasoningMinimal") }, { value: "low", label: t("settings:agentReasoningLow") }, { value: "medium", label: t("settings:agentReasoningMedium") }, { value: "high", label: t("settings:agentReasoningHigh") }, { value: "xhigh", label: t("settings:agentReasoningXhigh") }, { value: "max", label: t("settings:agentReasoningMax") }];
  return (
    <div hidden={hidden}>
      <div className="settings-layout" role="tabpanel" aria-label={t("settings:extensionSettings")}>
        <div className="settings-extension-section">
          <div className="settings-extension-grid">
            <article className="settings-extension-card">
              <div className="settings-extension-card__header">
                <div>
                  <h3>{t("settings:backgroundRemoval")}</h3>
                  <p className="settings-field-description">{rmbg.downloaded ? t("settings:backgroundRemovalReady") : t("settings:backgroundRemovalDescription")}</p>
                </div>
                <label className="settings-extension-toggle">
                  <span>{t("settings:extensionEnabled")}</span>
                  <Switch checked={settings.backgroundRemovalEnabled} onCheckedChange={(checked) => setSettings((current) => ({ ...current, backgroundRemovalEnabled: checked }))} aria-label={`${t("settings:backgroundRemoval")} ${t("settings:extensionEnabled")}`} />
                </label>
              </div>
              <div className="settings-rmbg-control">
                {rmbg.downloading ? <div className="settings-rmbg-progress-wrap"><div className="settings-rmbg-progress-head"><span>{t("settings:backgroundRemovalDownloading")}</span><strong>{progress}%</strong></div><Progress value={progress} aria-label={t("settings:backgroundRemovalDownloading")} /></div> : null}
                <Button type="button" size="sm" disabled={rmbg.downloading} onClick={() => void (rmbg.downloaded ? removeRmbg() : downloadRmbg())}>{rmbg.downloading ? t("settings:backgroundRemovalDownloadingShort") : rmbg.downloaded ? t("settings:backgroundRemovalRemove") : t("settings:backgroundRemovalDownload")}</Button>
              </div>
            </article>
            <article className="settings-extension-card">
              <div className="settings-extension-card__header">
                <div>
                  <h3>{t("settings:promptOptimization")}</h3>
                  <p className="settings-field-description">{t("settings:promptOptimizationDescription")}</p>
                </div>
                <label className="settings-extension-toggle">
                  <span>{t("settings:extensionEnabled")}</span>
                  <Switch checked={settings.promptOptimizationEnabled} onCheckedChange={(checked) => setSettings((current) => ({ ...current, promptOptimizationEnabled: checked }))} aria-label={`${t("settings:promptOptimization")} ${t("settings:extensionEnabled")}`} />
                </label>
              </div>
              <div className="settings-agent-controls">
                <Field className="settings-agent-control"><FieldLabel className="settings-agent-control__label">{t("settings:agentReasoningLevel")}</FieldLabel><AppSelect value={reasoningValue} options={reasoningOptions} onChange={(value) => setSettings((current) => value === "none" ? { ...current, thinkingMode: false } : { ...current, thinkingMode: true, reasoningLevel: value as ForartExtensionSettings["reasoningLevel"] })} ariaLabel={t("settings:agentReasoningLevel")} size="sm" /></Field>
                <Field className="settings-agent-control"><FieldLabel className="settings-agent-control__label">{t("settings:agentLlmModel")}</FieldLabel><AppSelect value={selectedModelValue} options={modelOptions} onChange={(value) => setSettings((current) => ({ ...current, imageGeneratorPromptOptimization: parseModelValue(value) }))} ariaLabel={t("settings:agentLlmModel")} placeholder={t("settings:agentModelNone")} size="sm" /></Field>
              </div>
            </article>
          </div>
        </div>
      </div>
    </div>
  );
}
