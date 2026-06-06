import { FolderOpen, RefreshCw, Server, Settings, TestTube2 } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ForartAppConfig, ForartMode, normalizeConfig } from "../../app/appConfig";

interface SettingsPageProps {
  config: ForartAppConfig;
  onConfigChange: (config: ForartAppConfig) => void;
}

interface StatusState {
  tone: "idle" | "ready" | "error" | "busy";
  text: string;
}

export function SettingsPage({ config, onConfigChange }: SettingsPageProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<ForartMode>(config.mode);
  const [localLibraryPath, setLocalLibraryPath] = useState(config.localLibraryPath);
  const [serverUrl, setServerUrl] = useState(config.serverUrl);
  const [accessToken, setAccessToken] = useState(config.accessToken);
  const [status, setStatus] = useState<StatusState>({ tone: "idle", text: t("settings.loaded") });
  const [localStatus, setLocalStatus] = useState<StatusState>({ tone: "idle", text: t("settings.localStatusIdle") });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setMode(config.mode);
    setLocalLibraryPath(config.localLibraryPath);
    setServerUrl(config.serverUrl);
    setAccessToken(config.accessToken);
  }, [config]);

  async function chooseDirectory() {
    const result = await window.forartConfig?.chooseDirectory();
    if (result && !result.canceled) setLocalLibraryPath(result.path);
  }

  async function refreshLocalStatus() {
    setLocalStatus({ tone: "busy", text: t("settings.localStatusBusy") });
    const result = await window.forartConfig?.localServerStatus();
    if (result?.ok) {
      setLocalStatus({
        tone: "ready",
        text: result.managed ? t("settings.localStatusManaged") : t("settings.localStatusExternal"),
      });
      return;
    }
    setLocalStatus({ tone: "error", text: result?.error || t("settings.localStatusDisconnected") });
  }

  async function testRemoteServer() {
    setStatus({ tone: "busy", text: t("settings.testingServer") });
    const result = await window.forartConfig?.testServer(serverUrl);
    if (result?.ok) {
      setStatus({ tone: "ready", text: t("settings.serverOk") });
      return;
    }
    setStatus({ tone: "error", text: result?.error || `${t("settings.connectionFailed")}${result?.status ? ` (${result.status})` : ""}` });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const nextConfig = normalizeConfig({ mode, localLibraryPath, serverUrl, accessToken });

    if (nextConfig.mode === "local" && !nextConfig.localLibraryPath) {
      setStatus({ tone: "error", text: t("settings.localPathRequired") });
      return;
    }

    if (nextConfig.mode === "remote" && !nextConfig.serverUrl) {
      setStatus({ tone: "error", text: t("settings.serverUrlRequired") });
      return;
    }

    setSaving(true);
    setStatus({ tone: "busy", text: t("settings.savingConfig") });
    try {
      const result = await window.forartConfig?.save(nextConfig);
      onConfigChange(result?.config || nextConfig);
      setStatus({ tone: "ready", text: nextConfig.mode === "local" ? t("settings.switchedLocal") : t("settings.switchedRemote") });
      if (nextConfig.mode === "local") await refreshLocalStatus();
    } catch (error) {
      setStatus({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="settings-page" aria-label={t("settings.title")}>
      <header className="settings-header">
        <div>
          <h1>{t("settings.title")}</h1>
          <p>{t("settings.description")}</p>
        </div>
        <div className="settings-status" data-tone={status.tone}>
          {status.text}
        </div>
      </header>

      <form className="settings-layout" onSubmit={handleSubmit}>
        <section className="settings-section" aria-label={t("settings.runMode")}>
          <div className="settings-section__head">
            <Settings size={20} aria-hidden="true" />
            <h2>{t("settings.runMode")}</h2>
          </div>

          <div className="settings-segmented" role="radiogroup" aria-label={t("settings.runMode")}>
            <button className={mode === "local" ? "active" : ""} type="button" role="radio" aria-checked={mode === "local"} onClick={() => setMode("local")}>
              {t("settings.localMode")}
            </button>
            <button className={mode === "remote" ? "active" : ""} type="button" role="radio" aria-checked={mode === "remote"} onClick={() => setMode("remote")}>
              {t("settings.remoteMode")}
            </button>
          </div>
          <p className="settings-mode-description">
            {mode === "local" ? t("settings.localModeDescription") : t("settings.remoteModeDescription")}
          </p>
        </section>

        {mode === "local" ? (
          <section className="settings-section" aria-label={t("settings.localConfig")}>
            <div className="settings-section__head">
              <FolderOpen size={20} aria-hidden="true" />
              <h2>{t("settings.localLibrary")}</h2>
            </div>

            <label className="settings-field">
              <span>{t("settings.libraryPath")}</span>
              <div className="settings-path-row">
                <input value={localLibraryPath} onChange={(event) => setLocalLibraryPath(event.target.value)} placeholder="D:/ForartLibrary" />
                <button type="button" className="settings-icon-button" title={t("setup.chooseDirectory")} aria-label={t("setup.chooseDirectory")} onClick={chooseDirectory}>
                  <FolderOpen size={18} aria-hidden="true" />
                </button>
              </div>
            </label>

            <div className="settings-inline-status" data-tone={localStatus.tone}>
              {localStatus.text}
            </div>
            <button className="settings-secondary-button" type="button" onClick={refreshLocalStatus}>
              <RefreshCw size={16} aria-hidden="true" />
              {t("settings.checkLocalServer")}
            </button>
          </section>
        ) : (
          <section className="settings-section" aria-label={t("settings.serverConfig")}>
            <div className="settings-section__head">
              <Server size={20} aria-hidden="true" />
              <h2>{t("settings.remoteServer")}</h2>
            </div>

            <label className="settings-field">
              <span>{t("settings.serverUrl")}</span>
              <input value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} placeholder="http://192.168.1.20:5175" />
            </label>

            <label className="settings-field">
              <span>{t("settings.accessToken")}</span>
              <input value={accessToken} onChange={(event) => setAccessToken(event.target.value)} placeholder={t("settings.accessTokenPlaceholder")} />
            </label>

            <button className="settings-secondary-button" type="button" onClick={testRemoteServer}>
              <TestTube2 size={16} aria-hidden="true" />
              {t("settings.testServer")}
            </button>
          </section>
        )}

        <div className="settings-actions">
          <button className="settings-submit" type="submit" disabled={saving}>
            {saving ? t("settings.saving") : t("settings.saveSettings")}
          </button>
        </div>
      </form>
    </section>
  );
}
