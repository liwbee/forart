import { ChevronDown, FolderOpen } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ForartAppConfig, ForartMode, normalizeConfig } from "../../app/appConfig";
import { ErrorCopyLine } from "../../components/ErrorCopyLine";
import { NativeTabs, type NativeTabItem } from "../../components/NativeTabs";
import { Button } from "../../components/ui/button";

interface GeneralSettingsPanelProps {
  config: ForartAppConfig;
  onConfigChange: (config: ForartAppConfig) => void;
  hidden?: boolean;
}

interface StatusState {
  tone: "idle" | "ready" | "error" | "busy";
  text: string;
}

function sameAppConfig(left: ForartAppConfig, right: ForartAppConfig) {
  return left.mode === right.mode
    && left.localLibraryPath === right.localLibraryPath
    && left.imageDownloadPath === right.imageDownloadPath
    && left.serverUrl === right.serverUrl
    && left.language === right.language;
}

export function GeneralSettingsPanel({ config, onConfigChange, hidden = false }: GeneralSettingsPanelProps) {
  const { i18n, t } = useTranslation();
  const [mode, setMode] = useState<ForartMode>(config.mode);
  const [runModeExpanded, setRunModeExpanded] = useState(false);
  const [localLibraryPath, setLocalLibraryPath] = useState(config.localLibraryPath);
  const [imageDownloadPath, setImageDownloadPath] = useState(config.imageDownloadPath);
  const [defaultImageDownloadPath, setDefaultImageDownloadPath] = useState("");
  const [serverUrl, setServerUrl] = useState(config.serverUrl);
  const [status, setStatus] = useState<StatusState>({ tone: "idle", text: t("settings:connectionChecking") });
  const didMount = useRef(false);
  const savingConfigRef = useRef(false);
  const pendingConfigRef = useRef<ForartAppConfig | null>(null);
  const persistedConfigRef = useRef(config);
  const runModeTabs = useMemo<NativeTabItem<ForartMode>[]>(() => [
    { value: "local", label: t("settings:localMode") },
    { value: "remote", label: t("settings:remoteMode") },
  ], [t]);

  useEffect(() => {
    persistedConfigRef.current = config;
    if (savingConfigRef.current) return;
    setMode(config.mode);
    setLocalLibraryPath(config.localLibraryPath);
    setImageDownloadPath(config.imageDownloadPath);
    setServerUrl(config.serverUrl);
  }, [config]);

  useEffect(() => {
    let canceled = false;
    async function loadDefaultPaths() {
      const paths = await window.forartConfig?.defaultPaths().catch(() => null);
      if (!canceled && paths?.imageDownloadPath) setDefaultImageDownloadPath(paths.imageDownloadPath);
    }
    void loadDefaultPaths();
    return () => {
      canceled = true;
    };
  }, []);

  async function chooseDirectory() {
    const result = await window.forartConfig?.chooseDirectory();
    if (result && !result.canceled) setLocalLibraryPath(result.path);
  }

  async function chooseImageDownloadDirectory() {
    const result = await window.forartConfig?.chooseDirectory();
    if (result && !result.canceled) setImageDownloadPath(result.path);
  }

  const refreshConnectionStatus = useCallback(async (nextMode: ForartMode, nextServerUrl: string) => {
    if (nextMode === "local") {
      setStatus({ tone: "busy", text: t("settings:localStatusBusy") });
      const result = await window.forartConfig?.localServerStatus();
      if (result?.ok) {
        setStatus({
          tone: "ready",
          text: result.transport === "ipc" ? t("settings:serverOk") : result.managed ? t("settings:localStatusManaged") : t("settings:localStatusExternal"),
        });
        return;
      }
      setStatus({ tone: "error", text: result?.error || t("settings:localStatusDisconnected") });
      return;
    }

    const trimmedServerUrl = nextServerUrl.trim();
    if (!trimmedServerUrl) {
      setStatus({ tone: "idle", text: t("settings:serverUrlRequired") });
      return;
    }

    setStatus({ tone: "busy", text: t("settings:testingServer") });
    const result = await window.forartConfig?.testServer(trimmedServerUrl);
    if (result?.ok) {
      setStatus({ tone: "ready", text: t("settings:serverOk") });
      return;
    }
    setStatus({ tone: "error", text: result?.error || `${t("settings:connectionFailed")}${result?.status ? ` (${result.status})` : ""}` });
  }, [t]);

  const saveGeneralSettings = useCallback(async (nextConfig: ForartAppConfig) => {
    if (nextConfig.mode === "local" && !nextConfig.localLibraryPath) {
      setStatus({ tone: "error", text: t("settings:localPathRequired") });
      return;
    }

    if (nextConfig.mode === "remote" && !nextConfig.serverUrl) {
      setStatus({ tone: "error", text: t("settings:serverUrlRequired") });
      return;
    }

    if (savingConfigRef.current) {
      pendingConfigRef.current = nextConfig;
      return;
    }

    if (sameAppConfig(nextConfig, persistedConfigRef.current)) {
      void refreshConnectionStatus(nextConfig.mode, nextConfig.serverUrl);
      return;
    }

    savingConfigRef.current = true;
    try {
      const result = await window.forartConfig?.save(nextConfig);
      const savedConfig = result?.config || nextConfig;
      persistedConfigRef.current = savedConfig;
      onConfigChange(savedConfig);
      void refreshConnectionStatus(savedConfig.mode, savedConfig.serverUrl);
    } catch (error) {
      setStatus({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      savingConfigRef.current = false;
      const pendingConfig = pendingConfigRef.current;
      pendingConfigRef.current = null;
      if (pendingConfig && !sameAppConfig(pendingConfig, persistedConfigRef.current)) {
        void saveGeneralSettings(pendingConfig);
      }
    }
  }, [onConfigChange, refreshConnectionStatus, t]);

  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      void refreshConnectionStatus(config.mode, config.serverUrl);
      return;
    }

    const timeout = window.setTimeout(() => {
      void saveGeneralSettings(normalizeConfig({
        mode,
        localLibraryPath,
        imageDownloadPath,
        serverUrl,
        language: i18n.language === "en-US" ? "en-US" : "zh-CN",
      }));
    }, 450);

    return () => window.clearTimeout(timeout);
  }, [config.mode, config.serverUrl, imageDownloadPath, i18n.language, localLibraryPath, mode, refreshConnectionStatus, saveGeneralSettings, serverUrl]);

  return (
    <div hidden={hidden}>
      <div className="settings-layout" role="tabpanel" aria-label={t("settings:generalSettings")}>
        <section className="settings-section" aria-label={t("settings:generalSettings")}>
        <div className="settings-section__head">
          <div>
            <h2>{t("settings:generalSettings")}</h2>
          </div>
          {status.tone === "error" ? (
            <ErrorCopyLine className="settings-status" text={status.text} />
          ) : (
            <div className="settings-status" data-tone={status.tone}>
              {status.text}
            </div>
          )}
        </div>

        <div className={`settings-subsection settings-run-mode${runModeExpanded ? " settings-run-mode--expanded" : ""}`}>
          <div className="settings-run-mode-row">
            <div className="settings-run-mode-title">
              <div>
                <h3>{t("settings:runMode")}</h3>
              </div>
            </div>
            <div className="settings-run-mode-controls">
              <NativeTabs
                items={runModeTabs}
                value={mode}
                onChange={(nextMode) => {
                  setMode(nextMode);
                  setRunModeExpanded(true);
                }}
                ariaLabel={t("settings:runMode")}
                className="settings-run-mode-tabs"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                aria-expanded={runModeExpanded}
                aria-controls="settings-run-mode-panel"
                aria-label={runModeExpanded ? t("settings:collapseRunModeConfig") : t("settings:expandRunModeConfig")}
                title={runModeExpanded ? t("settings:collapseRunModeConfig") : t("settings:expandRunModeConfig")}
                onClick={() => setRunModeExpanded((expanded) => !expanded)}
              >
                <ChevronDown className={runModeExpanded ? "rotate-180 transition-transform" : "transition-transform"} aria-hidden="true" />
              </Button>
            </div>
          </div>

          {runModeExpanded ? (
            <div id="settings-run-mode-panel" className="settings-run-mode-panel" aria-label={mode === "local" ? t("settings:localConfig") : t("settings:serverConfig")}>
              {mode === "local" ? (
                <label className="settings-field">
                  <span>{t("settings:libraryPath")}</span>
                  <div className="settings-path-row">
                    <input value={localLibraryPath} onChange={(event) => setLocalLibraryPath(event.target.value)} placeholder="D:/ForartLibrary" />
                    <Button type="button" variant="ghost" size="icon-lg" title={t("setup:chooseDirectory")} aria-label={t("setup:chooseDirectory")} onClick={chooseDirectory}>
                      <FolderOpen aria-hidden="true" />
                    </Button>
                  </div>
                </label>
              ) : (
                <label className="settings-field">
                  <span>{t("settings:serverUrl")}</span>
                  <input value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} placeholder="http://192.168.1.20:6980" />
                </label>
              )}
            </div>
          ) : null}
        </div>

        <div className="settings-subsection settings-download-path-row" aria-label={t("settings:imageDownloadConfig")}>
          <h3>{t("settings:imageDownloadPath")}</h3>
          <div className="settings-download-path-control">
            <input
              value={imageDownloadPath}
              onChange={(event) => setImageDownloadPath(event.target.value)}
              placeholder={defaultImageDownloadPath || t("settings:imageDownloadDefault")}
              aria-label={t("settings:imageDownloadDirectory")}
            />
            <Button type="button" variant="ghost" size="icon-lg" title={t("setup:chooseDirectory")} aria-label={t("setup:chooseDirectory")} onClick={chooseImageDownloadDirectory}>
              <FolderOpen aria-hidden="true" />
            </Button>
          </div>
        </div>
        </section>
      </div>
    </div>
  );
}
