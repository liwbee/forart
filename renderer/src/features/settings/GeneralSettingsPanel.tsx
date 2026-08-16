import { ChevronDown, FolderOpen } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ForartAppConfig, ForartMode, normalizeConfig } from "../../app/appConfig";
import { NativeTabs, type NativeTabItem } from "../../components/NativeTabs";
import { Button } from "../../components/ui/button";
import { openServerLoginDialog } from "../server-auth/serverLoginDialogStore";

interface GeneralSettingsPanelProps {
  config: ForartAppConfig;
  onConfigChange: (config: ForartAppConfig) => void;
  hidden?: boolean;
}

interface StatusState {
  tone: "ready" | "warning" | "error" | "busy";
  text: string;
}

function sameAppConfig(left: ForartAppConfig, right: ForartAppConfig) {
  return left.mode === right.mode
    && left.localLibraryPath === right.localLibraryPath
    && left.imageDownloadPath === right.imageDownloadPath
    && left.photoshopExecutablePath === right.photoshopExecutablePath
    && left.serverUrl === right.serverUrl
    && left.serverAuthUsername === right.serverAuthUsername
    && left.serverAuthToken === right.serverAuthToken
    && left.language === right.language;
}

export function GeneralSettingsPanel({ config, onConfigChange, hidden = false }: GeneralSettingsPanelProps) {
  const { i18n, t } = useTranslation();
  const [mode, setMode] = useState<ForartMode>(config.mode);
  const [runModeExpanded, setRunModeExpanded] = useState(false);
  const [localLibraryPath, setLocalLibraryPath] = useState(config.localLibraryPath);
  const [imageDownloadPath, setImageDownloadPath] = useState(config.imageDownloadPath);
  const [photoshopExecutablePath, setPhotoshopExecutablePath] = useState(config.photoshopExecutablePath);
  const [defaultImageDownloadPath, setDefaultImageDownloadPath] = useState("");
  const [serverUrl, setServerUrl] = useState(config.serverUrl);
  const [serverAuthUsername, setServerAuthUsername] = useState(config.serverAuthUsername);
  const [serverAuthToken, setServerAuthToken] = useState(config.serverAuthToken);
  const [status, setStatus] = useState<StatusState>({ tone: "busy", text: t("settings:connectionChecking") });
  const didMount = useRef(false);
  const connectionCheckIdRef = useRef(0);
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
    setPhotoshopExecutablePath(config.photoshopExecutablePath);
    setServerUrl(config.serverUrl);
    setServerAuthUsername(config.serverAuthUsername);
    setServerAuthToken(config.serverAuthToken);
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

  async function choosePhotoshopExecutable() {
    const result = await window.forartConfig?.chooseFile({
      title: t("settings:photoshopExecutableChoose"),
      filterName: t("settings:photoshopExecutableFilter"),
      extensions: ["exe"],
    });
    if (result && !result.canceled) setPhotoshopExecutablePath(result.path);
  }

  const refreshConnectionStatus = useCallback(async (nextMode: ForartMode, nextServerUrl: string) => {
    const connectionCheckId = ++connectionCheckIdRef.current;
    const updateStatus = (nextStatus: StatusState) => {
      if (connectionCheckId === connectionCheckIdRef.current) setStatus(nextStatus);
    };

    if (nextMode === "local") {
      updateStatus({ tone: "busy", text: t("settings:localStatusBusy") });
      const result = await window.forartConfig?.localServerStatus();
      if (result?.ok) {
        updateStatus({ tone: "ready", text: t("settings:localServiceStarted") });
        return;
      }
      updateStatus({ tone: "error", text: t("settings:connectionFailed") });
      return;
    }

    const trimmedServerUrl = nextServerUrl.trim();
    if (!trimmedServerUrl) {
      updateStatus({ tone: "error", text: t("settings:connectionFailed") });
      return;
    }

    updateStatus({ tone: "busy", text: t("settings:testingServer") });
    const result = await window.forartConfig?.testServer(trimmedServerUrl);
    if (connectionCheckId !== connectionCheckIdRef.current) return;
    if (result?.ok) {
      if (!serverAuthToken) {
        updateStatus({ tone: "warning", text: t("settings:serverNotLoggedIn") });
        return;
      }

      const session = await window.forartConfig?.serverSession({ serverUrl: trimmedServerUrl, token: serverAuthToken });
      if (connectionCheckId !== connectionCheckIdRef.current) return;
      if (session?.ok) {
        updateStatus({ tone: "ready", text: t("settings:serverOk") });
        return;
      }

      if (session?.status === 401) {
        const logoutResult = await window.forartConfig?.serverLogout();
        if (connectionCheckId !== connectionCheckIdRef.current) return;
        if (logoutResult?.config) {
          persistedConfigRef.current = logoutResult.config;
          onConfigChange(logoutResult.config);
        }
        setServerAuthToken("");
        updateStatus({ tone: "warning", text: t("settings:serverNotLoggedIn") });
        return;
      }

      updateStatus({ tone: "error", text: t("settings:connectionFailed") });
      return;
    }
    updateStatus({ tone: "error", text: t("settings:connectionFailed") });
  }, [onConfigChange, serverAuthToken, t]);

  const saveGeneralSettings = useCallback(async (nextConfig: ForartAppConfig) => {
    if (!nextConfig.serverAuthToken
      && persistedConfigRef.current.serverAuthToken
      && nextConfig.serverUrl === persistedConfigRef.current.serverUrl
      && nextConfig.serverAuthUsername === persistedConfigRef.current.serverAuthUsername) {
      nextConfig = { ...nextConfig, serverAuthToken: persistedConfigRef.current.serverAuthToken };
    }
    if (nextConfig.mode === "local" && !nextConfig.localLibraryPath) {
      setStatus({ tone: "error", text: t("settings:connectionFailed") });
      return;
    }

    if (nextConfig.mode === "remote" && !nextConfig.serverUrl) {
      setStatus({ tone: "error", text: t("settings:connectionFailed") });
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
    } catch {
      setStatus({ tone: "error", text: t("settings:connectionFailed") });
    } finally {
      savingConfigRef.current = false;
      const pendingConfig = pendingConfigRef.current;
      pendingConfigRef.current = null;
      if (pendingConfig && !sameAppConfig(pendingConfig, persistedConfigRef.current)) {
        void saveGeneralSettings(pendingConfig);
      }
    }
  }, [onConfigChange, refreshConnectionStatus, t]);

  async function logoutRemoteServer() {
    const result = await window.forartConfig?.serverLogout();
    if (result?.config) {
      setServerAuthToken("");
      persistedConfigRef.current = result.config;
      onConfigChange(result.config);
      setStatus({ tone: "warning", text: t("settings:serverNotLoggedIn") });
    }
  }

  function openLoginDialog() {
    openServerLoginDialog({ serverUrl, username: serverAuthUsername });
  }

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
        photoshopExecutablePath,
        serverUrl,
        serverAuthUsername,
        serverAuthToken,
        language: i18n.language === "en-US" ? "en-US" : "zh-CN",
      }));
    }, 450);

    return () => window.clearTimeout(timeout);
  }, [config.mode, config.serverUrl, imageDownloadPath, i18n.language, localLibraryPath, mode, photoshopExecutablePath, refreshConnectionStatus, saveGeneralSettings, serverAuthToken, serverAuthUsername, serverUrl]);

  return (
    <div hidden={hidden}>
      <div className="settings-layout" role="tabpanel" aria-label={t("settings:generalSettings")}>
        <section className="settings-section" aria-label={t("settings:generalSettings")}>
        <div className="settings-section__head">
          <div>
            <h2>{t("settings:generalSettings")}</h2>
          </div>
        </div>

        <div className={`settings-subsection settings-run-mode${runModeExpanded ? " settings-run-mode--expanded" : ""}`}>
          <div className="settings-run-mode-row">
            <div className="settings-run-mode-title">
              <div>
                <h3>{t("settings:runMode")}</h3>
              </div>
            </div>
            <div className="settings-run-mode-controls">
              <div className="settings-status" data-tone={status.tone} role="status" aria-live="polite">
                {status.text}
              </div>
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
                <div className="settings-remote-config">
                  <div className="settings-field">
                    <label htmlFor="settings-server-url">{t("settings:serverUrl")}</label>
                    <div className="settings-remote-server-row">
                      <input
                        id="settings-server-url"
                        value={serverUrl}
                        onChange={(event) => {
                          setServerUrl(event.target.value);
                          setServerAuthToken("");
                        }}
                        placeholder="http://192.168.1.20:6980"
                      />
                      {serverAuthToken ? (
                        <Button type="button" variant="outline" onClick={() => void logoutRemoteServer()}>{t("settings:logout")}</Button>
                      ) : (
                        <Button type="button" variant="outline" onClick={openLoginDialog}>{t("settings:login")}</Button>
                      )}
                    </div>
                  </div>
                </div>
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

        <div className="settings-subsection settings-download-path-row" aria-label={t("settings:photoshopConfig")}>
          <h3>{t("settings:photoshopExecutablePath")}</h3>
          <div className="settings-download-path-control">
            <input
              value={photoshopExecutablePath}
              onChange={(event) => setPhotoshopExecutablePath(event.target.value)}
              placeholder={t("settings:photoshopExecutableAuto")}
              aria-label={t("settings:photoshopExecutablePath")}
            />
            <Button type="button" variant="ghost" size="icon-lg" title={t("settings:photoshopExecutableChoose")} aria-label={t("settings:photoshopExecutableChoose")} onClick={choosePhotoshopExecutable}>
              <FolderOpen aria-hidden="true" />
            </Button>
          </div>
        </div>
        </section>
      </div>
    </div>
  );
}
