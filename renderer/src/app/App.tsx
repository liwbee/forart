import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, Languages, Minus, Moon, PanelLeftClose, PanelLeftOpen, RefreshCw, Settings, Square, Sun, X, XCircle } from "lucide-react";
import { setActiveForartConfig } from "../data-source/runtime";
import { isKeepAliveView, navRoutes, workspaceRouteById } from "./appRoutes";
import { AppView, useAppStore } from "./appStore";
import type { ForartAppConfig, ForartAppInfo, ForartUpdateCheckResult, ForartUpdateConnectivityResult, ForartUpdateNotes, ForartUpdateProgress, ForartUpdateRunResult } from "./appConfig";
import { getAppTitle } from "./runtimeConfig";
import { SetupPage } from "./SetupPage";
import { allowsBrowserDiagnosticRuntime, isElectronRuntime, missingElectronBridgeNames } from "./electronRuntime";
import { UnsupportedRuntimePage } from "./UnsupportedRuntimePage";

const VIEW_TRANSITION_MS = 500;
const LIBRARY_QUERY_ROOTS = new Set([
  "storageSettings",
  "modelProjects",
  "modelTags",
  "models",
  "modelImages",
  "actionProjects",
  "actionTags",
  "actions",
  "outfitProjects",
  "outfitTags",
  "outfits",
]);
type UpdateStatus = "idle" | "checking" | "available" | "current" | "error" | "updating" | "updated";

const updateText = {
  checkingSub: "\u68c0\u67e5\u66f4\u65b0",
  checkingTitle: "\u70b9\u51fb\u68c0\u67e5\u66f4\u65b0",
  checking: "\u68c0\u67e5\u4e2d",
  checkingMessage: "\u6b63\u5728\u68c0\u67e5\u66f4\u65b0...",
  checkFailed: "\u68c0\u67e5\u66f4\u65b0\u5931\u8d25",
  updatePrefix: "\u66f4\u65b0",
  updateTo: "\u66f4\u65b0\u5230",
  updating: "\u66f4\u65b0\u4e2d",
  updatingMessage: "\u6b63\u5728\u66f4\u65b0...",
  updateFailed: "\u66f4\u65b0\u5931\u8d25",
  updateFinished: "\u5df2\u4e0b\u8f7d\u66f4\u65b0\uff0c\u6b63\u5728\u9000\u51fa\u5e76\u5e94\u7528",
  updateAvailable: "\u53d1\u73b0\u65b0\u66f4\u65b0\uff0c\u518d\u70b9\u4e00\u6b21\u66f4\u65b0",
  current: "\u5df2\u662f\u6700\u65b0\u66f4\u65b0",
  restart: "\u91cd\u542f\u751f\u6548",
  updateAvailableShort: "\u53ef\u66f4\u65b0",
  connectivity: "\u68c0\u6d4b\u8fde\u901a\u6027",
  connectivityChecking: "\u68c0\u6d4b\u4e2d",
  startUpdate: "\u5f00\u59cb\u66f4\u65b0",
  close: "\u5173\u95ed",
  updateNotes: "\u66f4\u65b0\u65e5\u5fd7",
  noUpdateNotes: "\u6682\u672a\u83b7\u53d6\u5230\u66f4\u65b0\u65e5\u5fd7",
  readyToUpdate: "\u51c6\u5907\u66f4\u65b0",
  connectivityOk: "\u8fde\u901a\u6027\u6b63\u5e38",
  connectivityWarn: "\u5efa\u8bae\u5148\u68c0\u6d4b\u8fde\u901a\u6027",
};

function formatUpdateDate(value: string) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}.${month}.${day}`;
}

function normalizeVersionLabel(value: string) {
  return String(value || "").trim().replace(/^v/i, "");
}

function displayVersion(value: string) {
  const normalized = normalizeVersionLabel(value);
  return normalized ? `v${normalized}` : "";
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
}

function updatePhaseLabel(phase: string, language: "zh-CN" | "en-US") {
  if (language === "zh-CN") {
    if (phase === "listing") return "正在获取发布信息";
    if (phase === "downloading") return "正在下载免安装包";
    if (phase === "scheduling") return "正在准备应用更新";
    if (phase === "scheduled") return "已准备应用更新";
    return "正在更新";
  }
  if (phase === "listing") return "Fetching release";
  if (phase === "downloading") return "Downloading portable package";
  if (phase === "scheduling") return "Preparing update";
  if (phase === "scheduled") return "Update ready to apply";
  return "Updating";
}

function KeepAliveWorkspaceView({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <div className={`workspace-view workspace-view--keepalive${active ? " workspace-view--active" : " workspace-view--hidden"}`} aria-hidden={!active}>
      {children}
    </div>
  );
}

function renderView(view: AppView, appConfig: ForartAppConfig, onConfigChange: (config: ForartAppConfig) => void) {
  const route = workspaceRouteById[view] || workspaceRouteById.library;
  return route.render({ appConfig, onConfigChange });
}

interface WindowTitleBarProps {
  updateStatus: UpdateStatus;
  updateButtonTitle: string;
  updateButtonLabel: string;
  UpdateIcon: typeof RefreshCw;
  onUpdateClick: () => void;
  ThemeIcon: typeof Moon;
  themeToggleLabel: string;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  languageTitle: string;
  languageCode: string;
  onToggleLanguage: () => void;
}

function WindowTitleBar({
  updateStatus,
  updateButtonTitle,
  updateButtonLabel,
  UpdateIcon,
  onUpdateClick,
  ThemeIcon,
  themeToggleLabel,
  theme,
  onToggleTheme,
  languageTitle,
  languageCode,
  onToggleLanguage,
}: WindowTitleBarProps) {
  return (
    <header className="window-titlebar" aria-label="Window controls" onDoubleClick={() => void window.forartWindow?.toggleMaximize()}>
      <div className="window-titlebar-spacer" aria-hidden="true" />
      <div className="window-titlebar-actions" onDoubleClick={(event) => event.stopPropagation()}>
        <button
          className="window-titlebar-update"
          type="button"
          data-status={updateStatus}
          disabled={updateStatus === "checking" || updateStatus === "updating"}
          aria-label={updateButtonTitle}
          title={updateButtonTitle}
          onClick={onUpdateClick}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <UpdateIcon className="side-version-icon" aria-hidden="true" size={14} />
          <span className="side-version-main">{updateButtonLabel}</span>
        </button>
        <button
          className="window-titlebar-tool"
          type="button"
          aria-pressed={theme === "dark"}
          aria-label={themeToggleLabel}
          title={themeToggleLabel}
          onClick={onToggleTheme}
        >
          <ThemeIcon size={15} aria-hidden="true" />
        </button>
        <button
          className="window-titlebar-tool window-titlebar-tool--language"
          type="button"
          aria-label={languageTitle}
          title={languageTitle}
          onClick={onToggleLanguage}
        >
          <Languages size={15} aria-hidden="true" />
          <span>{languageCode}</span>
        </button>
        <button className="window-titlebar-button" type="button" aria-label="Minimize" title="Minimize" onClick={() => void window.forartWindow?.minimize()}>
          <Minus size={15} aria-hidden="true" />
        </button>
        <button className="window-titlebar-button" type="button" aria-label="Maximize" title="Maximize" onClick={() => void window.forartWindow?.toggleMaximize()}>
          <Square size={13} aria-hidden="true" />
        </button>
        <button className="window-titlebar-button window-titlebar-button--close" type="button" aria-label="Close" title="Close" onClick={() => void window.forartWindow?.close()}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

function AppFrame({ electron, titleBar, children }: { electron: boolean; titleBar: ReactNode; children: ReactNode }) {
  return (
    <div className={`app-frame${electron ? " app-frame--electron" : ""}`}>
      {electron ? titleBar : null}
      {children}
    </div>
  );
}

export function App() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const appTitle = getAppTitle();
  const activeView = useAppStore((state) => state.activeView);
  const setActiveView = useAppStore((state) => state.setActiveView);
  const theme = useAppStore((state) => state.theme);
  const toggleTheme = useAppStore((state) => state.toggleTheme);
  const ThemeIcon = theme === "dark" ? Sun : Moon;
  const currentLanguage = i18n.language === "en-US" ? "en-US" : "zh-CN";
  const nextLanguage = currentLanguage === "zh-CN" ? "en-US" : "zh-CN";
  const nextLanguageLabel = nextLanguage === "zh-CN" ? t("settings:chinese") : t("settings:english");
  const previousViewRef = useRef(activeView);
  const [exitingView, setExitingView] = useState<AppView | null>(null);
  const [mountedKeepAliveViews, setMountedKeepAliveViews] = useState<Set<AppView>>(() => (isKeepAliveView(activeView) ? new Set([activeView]) : new Set()));
  const [appConfig, setAppConfig] = useState<ForartAppConfig | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [appInfo, setAppInfo] = useState<ForartAppInfo | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const [latestUpdatedAt, setLatestUpdatedAt] = useState("");
  const [updateMessage, setUpdateMessage] = useState("");
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [updateCheckResult, setUpdateCheckResult] = useState<ForartUpdateCheckResult | null>(null);
  const [updateNotes, setUpdateNotes] = useState<ForartUpdateNotes | null>(null);
  const [updateProgress, setUpdateProgress] = useState<ForartUpdateProgress | null>(null);
  const [connectivity, setConnectivity] = useState<ForartUpdateConnectivityResult | null>(null);
  const [connectivityChecking, setConnectivityChecking] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    document.title = appTitle;
  }, [appTitle]);

  useEffect(() => {
    if (!isElectronRuntime()) return;
    let canceled = false;

    async function loadAppInfo() {
      const info = await window.forartConfig?.appInfo().catch(() => null);
      if (!canceled && info) {
        setAppInfo(info);
        setLatestUpdatedAt(info.currentUpdatedAt);
      }
    }

    loadAppInfo();

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (!appInfo) return;
    void checkForUpdates(false);
  }, [appInfo?.currentRevision]);

  useEffect(() => {
    if (!isElectronRuntime()) return;
    return window.forartConfig?.onUpdateProgress?.((progress) => {
      setUpdateProgress(progress);
      const label = updatePhaseLabel(progress.phase, currentLanguage);
      if (progress.phase === "downloading") {
        setUpdateMessage(`${label} ${Math.round(progress.percent)}% - ${formatBytes(progress.bytesPerSecond)}/s`);
      } else {
        setUpdateMessage(label);
      }
    });
  }, [currentLanguage]);

  useEffect(() => {
    if (!isElectronRuntime()) return;
    let canceled = false;

    async function loadConfig() {
      const config = await window.forartConfig?.load();
      if (!canceled) {
        if (config) {
          if (i18n.language !== config.language) void i18n.changeLanguage(config.language);
          setActiveForartConfig(config);
        }
        setAppConfig(config || null);
        setConfigLoaded(true);
      }
    }

    loadConfig();

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (!isKeepAliveView(activeView)) return;
    setMountedKeepAliveViews((current) => {
      if (current.has(activeView)) return current;
      return new Set([...current, activeView]);
    });
  }, [activeView]);

  useEffect(() => {
    if (previousViewRef.current === activeView) return;
    const previousView = previousViewRef.current;
    previousViewRef.current = activeView;
    setExitingView(previousView);

    const timeout = window.setTimeout(() => {
      setExitingView((current) => (current === previousView ? null : current));
    }, VIEW_TRANSITION_MS);

    return () => window.clearTimeout(timeout);
  }, [activeView]);

  function shouldRefreshLibraryQueries(nextConfig: ForartAppConfig) {
    if (!appConfig) return false;
    return (
      appConfig.mode !== nextConfig.mode ||
      appConfig.localLibraryPath !== nextConfig.localLibraryPath ||
      appConfig.serverUrl !== nextConfig.serverUrl
    );
  }

  function refreshLibraryQueries() {
    void queryClient.invalidateQueries({
      refetchType: "active",
      predicate: (query) => {
        const root = query.queryKey[0];
        return typeof root === "string" && LIBRARY_QUERY_ROOTS.has(root);
      },
    });
  }

  function updateConfig(config: ForartAppConfig) {
    const refreshLibraryCache = shouldRefreshLibraryQueries(config);
    setActiveForartConfig(config);
    setAppConfig(config);
    if (refreshLibraryCache) refreshLibraryQueries();
  }

  function toggleLanguage() {
    void i18n.changeLanguage(nextLanguage);
    if (appConfig) {
      const nextConfig: ForartAppConfig = { ...appConfig, language: nextLanguage === "en-US" ? "en-US" : "zh-CN" };
      void window.forartConfig?.save(nextConfig).then((result) => updateConfig(result.config || nextConfig));
    }
  }

  async function checkForUpdates(showCheckingState = true) {
    if (showCheckingState) {
      setUpdateStatus("checking");
      setUpdateMessage(currentLanguage === "zh-CN" ? updateText.checkingMessage : "Checking for updates...");
    }

    const result: ForartUpdateCheckResult | undefined = await window.forartConfig?.checkUpdate().catch((error): ForartUpdateCheckResult => ({
      ok: false,
      currentRevision: appInfo?.currentRevision || "",
      latestRevision: "",
      currentUpdatedAt: appInfo?.currentUpdatedAt || "",
      latestUpdatedAt: "",
      updateAvailable: false,
      repoUrl: appInfo?.repoUrl || "",
      error: String(error),
    }));
    if (!result?.ok) {
      setUpdateStatus(showCheckingState ? "error" : "idle");
      setUpdateMessage(showCheckingState ? (result?.error || (currentLanguage === "zh-CN" ? updateText.checkFailed : "Update check failed")) : "");
      if (showCheckingState) setUpdateModalOpen(true);
      return;
    }

    setUpdateCheckResult(result);
    setUpdateNotes(result.updateNotes || null);
    setLatestUpdatedAt(result.updateAvailable ? (result.latestUpdatedAt || result.currentUpdatedAt) : (result.currentUpdatedAt || result.latestUpdatedAt));
    setAppInfo((current) => current ? {
      ...current,
      repoUrl: result.repoUrl,
      currentRevision: result.currentRevision || current.currentRevision,
      currentUpdatedAt: result.currentUpdatedAt || current.currentUpdatedAt,
    } : current);
    if (result.updateAvailable) {
      setUpdateStatus("available");
      setUpdateMessage(currentLanguage === "zh-CN" ? updateText.updateAvailable : "Update available. Click again to update.");
    } else {
      setUpdateStatus("current");
      setUpdateMessage(currentLanguage === "zh-CN" ? updateText.current : "You're up to date.");
    }

    if (showCheckingState) setUpdateModalOpen(true);
  }

  async function runConnectivityCheck() {
    if (connectivityChecking) return;
    setConnectivityChecking(true);
    const result = await window.forartConfig?.updateConnectivity().catch((): ForartUpdateConnectivityResult => ({ ok: false, results: [] }));
    setConnectivity(result || { ok: false, results: [] });
    setConnectivityChecking(false);
  }

  async function confirmUpdate() {
    if (updateStatus === "checking" || updateStatus === "updating") return;
    if (updateStatus !== "available") {
      await checkForUpdates(true);
      return;
    }

    setUpdateStatus("updating");
    setUpdateProgress(null);
    setUpdateMessage(currentLanguage === "zh-CN" ? updateText.updatingMessage : "Updating...");
    const result: ForartUpdateRunResult | undefined = await window.forartConfig?.runUpdate().catch((error): ForartUpdateRunResult => ({ ok: false, error: String(error) }));

    if (result?.ok) {
      setUpdateStatus("updated");
      setUpdateMessage(currentLanguage === "zh-CN" ? updateText.updateFinished : "Update downloaded. Forart is closing to apply it.");
    } else {
      setUpdateStatus("error");
      setUpdateMessage(result?.error || (currentLanguage === "zh-CN" ? updateText.updateFailed : "Update failed"));
    }
  }

  async function handleUpdateClick() {
    if (updateStatus === "checking" || updateStatus === "updating") return;
    setUpdateModalOpen(true);
    if (!updateCheckResult || updateStatus === "idle") {
      await checkForUpdates(true);
    }
  }

  const currentUpdateDateLabel = formatUpdateDate(appInfo?.currentUpdatedAt || latestUpdatedAt || "");
  const latestUpdateDateLabel = formatUpdateDate(latestUpdatedAt || appInfo?.currentUpdatedAt || "");
  const currentVersionLabel = normalizeVersionLabel(appInfo?.currentRevision || updateCheckResult?.currentRevision || "");
  const latestVersionLabel = normalizeVersionLabel(updateCheckResult?.latestRevision || updateNotes?.version || "");
  const currentVersionDisplay = displayVersion(currentVersionLabel) || currentUpdateDateLabel;
  const latestVersionDisplay = displayVersion(latestVersionLabel) || latestUpdateDateLabel;
  const updateButtonLabel = updateStatus === "available"
    ? `${currentLanguage === "zh-CN" ? updateText.updateAvailableShort : "Update"} ${latestVersionDisplay}`
    : updateStatus === "checking"
      ? (currentLanguage === "zh-CN" ? updateText.checking : "Checking")
      : updateStatus === "updating"
        ? (currentLanguage === "zh-CN" ? updateText.updating : "Updating")
        : updateStatus === "updated"
          ? (currentLanguage === "zh-CN" ? updateText.restart : "Restart")
          : currentVersionDisplay;
  const updateButtonTitle = updateMessage || (currentLanguage === "zh-CN" ? updateText.checkingTitle : "Click to check for updates");
  const UpdateIcon = updateStatus === "available" ? Download : RefreshCw;
  const modalTitle = updateStatus === "available"
    ? (currentLanguage === "zh-CN" ? "\u53d1\u73b0\u65b0\u66f4\u65b0" : "Update available")
    : updateStatus === "updated"
      ? (currentLanguage === "zh-CN" ? "\u66f4\u65b0\u5b8c\u6210" : "Update complete")
      : currentLanguage === "zh-CN" ? "\u9879\u76ee\u66f4\u65b0" : "Project update";
  const notesItems = updateNotes?.items || [];
  const updateCanRun = updateStatus === "available";
  const updateSummaryText = updateStatus === "available"
    ? `${currentLanguage === "zh-CN" ? "\u6709\u53ef\u7528\u66f4\u65b0" : "Update available"} ${latestVersionDisplay}`
    : updateStatus === "current"
      ? `${currentLanguage === "zh-CN" ? "\u5df2\u662f\u6700\u65b0\u7248\u672c" : "Already up to date"} ${currentVersionDisplay}`
      : updateMessage || (currentLanguage === "zh-CN" ? updateText.connectivityWarn : "Check status before updating");
  const updateProgressPercent = Math.max(0, Math.min(100, updateProgress?.percent || 0));
  const updateProgressVisible = Boolean(updateProgress && (updateStatus === "updating" || updateStatus === "updated"));
  const updateProgressPhase = updateProgress ? updatePhaseLabel(updateProgress.phase, currentLanguage) : "";
  const updateProgressSpeed = updateProgress ? `${formatBytes(updateProgress.bytesPerSecond)}/s` : "";
  const updateProgressTotal = updateProgress ? formatBytes(updateProgress.downloadedBytes) : "0 B";
  const updateProgressFile = updateProgress?.currentFile || "";
  const sidebarToggleLabel = sidebarCollapsed ? t("nav:expandSidebar") : t("nav:collapseSidebar");
  const SidebarToggleIcon = sidebarCollapsed ? PanelLeftOpen : PanelLeftClose;
  const isElectron = isElectronRuntime();
  const browserDiagnosticRuntime = !isElectron && allowsBrowserDiagnosticRuntime();
  const themeToggleLabel = theme === "dark" ? t("nav:theme.switchToLight") : t("nav:theme.switchToDark");
  const languageTitle = `${t("settings:language")}: ${nextLanguageLabel}`;
  const titleBar = (
    <WindowTitleBar
      updateStatus={updateStatus}
      updateButtonTitle={updateButtonTitle}
      updateButtonLabel={updateButtonLabel}
      UpdateIcon={UpdateIcon}
      onUpdateClick={handleUpdateClick}
      ThemeIcon={ThemeIcon}
      themeToggleLabel={themeToggleLabel}
      theme={theme}
      onToggleTheme={toggleTheme}
      languageTitle={languageTitle}
      languageCode={nextLanguage === "zh-CN" ? "CN" : "EN"}
      onToggleLanguage={toggleLanguage}
    />
  );

  const keepAliveViewsToRender = isKeepAliveView(activeView)
    ? new Set([...mountedKeepAliveViews, activeView])
    : mountedKeepAliveViews;

  if (!isElectron && !browserDiagnosticRuntime) {
    return (
      <AppFrame electron={false} titleBar={titleBar}>
        <UnsupportedRuntimePage missingBridges={missingElectronBridgeNames()} />
      </AppFrame>
    );
  }

  if (!configLoaded) {
    return (
      <AppFrame electron={isElectron} titleBar={titleBar}>
        <main className="setup-shell">
          <section className="setup-panel setup-panel--loading" aria-label={t("app:loadingLabel")}>
            <div className="brand setup-brand" aria-label={appTitle}>
              <span className="brand-mark" aria-hidden="true" />
              <strong className="brand-name">{appTitle}</strong>
            </div>
            <p>{t("app:loadingConfig")}</p>
          </section>
        </main>
      </AppFrame>
    );
  }

  if (!appConfig) {
    return (
      <AppFrame electron={isElectron} titleBar={titleBar}>
        <SetupPage initialConfig={null} onConfigured={updateConfig} />
      </AppFrame>
    );
  }

  return (
    <AppFrame electron={isElectron} titleBar={titleBar}>
      <div className={`app-shell${sidebarCollapsed ? " app-shell--sidebar-collapsed" : ""}`}>
      <aside className="left-panel" aria-label={`${appTitle} navigation`}>
        <div className="side-head">
          <div className="brand" aria-label={appTitle}>
            <span className="brand-mark" aria-hidden="true" />
            <strong className="brand-name">{appTitle}</strong>
          </div>
          <button
            className="side-collapse-button"
            type="button"
            data-tooltip={sidebarToggleLabel}
            aria-label={sidebarToggleLabel}
            aria-expanded={!sidebarCollapsed}
            title={sidebarToggleLabel}
            onClick={() => setSidebarCollapsed((value) => !value)}
          >
            <SidebarToggleIcon size={20} aria-hidden="true" />
          </button>
        </div>

        <nav className="side-nav" aria-label={t("app:mainNavigation")}>
          {navRoutes.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                className={`side-nav-item${isActive ? " active" : ""}`}
                type="button"
                data-short={t(item.shortKey)}
                data-tooltip={t(item.labelKey)}
                aria-current={isActive ? "page" : undefined}
                onClick={() => setActiveView(item.id)}
              >
                <Icon className="nav-icon" aria-hidden="true" size={20} />
                <span className="nav-label">{t(item.labelKey)}</span>
              </button>
            );
          })}
        </nav>

        <div className="side-footer" aria-label={t("app:settingsNavigation")}>
          <button
            className={`side-nav-item side-footer-button${activeView === "settings" ? " active" : ""}`}
            type="button"
            data-short={t("nav:short.settings")}
            data-tooltip={t("nav:settings")}
            aria-current={activeView === "settings" ? "page" : undefined}
            onClick={() => setActiveView("settings")}
          >
            <Settings className="nav-icon" aria-hidden="true" size={20} />
            <span className="nav-label">{t("nav:settings")}</span>
          </button>

          {!isElectron ? (
            <button
              className="side-version-button"
              type="button"
              data-status={updateStatus}
              data-tooltip={updateButtonTitle}
              disabled={updateStatus === "checking" || updateStatus === "updating"}
              aria-label={updateButtonTitle}
              title={updateButtonTitle}
              onClick={handleUpdateClick}
            >
              <UpdateIcon className="side-version-icon" aria-hidden="true" size={16} />
              <span className="side-version-main">{updateButtonLabel}</span>
            </button>
          ) : null}

          {!isElectron ? <div className="side-footer-control-row">
            <button
              className="side-nav-item side-footer-button side-icon-button theme-toggle"
              type="button"
              data-short={theme === "dark" ? t("nav:short.light") : t("nav:short.dark")}
              data-tooltip={themeToggleLabel}
              aria-pressed={theme === "dark"}
              aria-label={themeToggleLabel}
              title={themeToggleLabel}
              onClick={toggleTheme}
            >
              <ThemeIcon className="nav-icon" aria-hidden="true" size={20} />
            </button>

            <button
              className="side-nav-item side-footer-button side-icon-button language-toggle"
              type="button"
              data-tooltip={languageTitle}
              aria-label={languageTitle}
              title={languageTitle}
              onClick={toggleLanguage}
            >
              <Languages className="nav-icon" aria-hidden="true" size={20} />
              <span className="language-toggle__code">{nextLanguage === "zh-CN" ? "CN" : "EN"}</span>
            </button>
          </div> : null}
        </div>
      </aside>

      <main className="workspace" id="main-workspace">
        <div className="workspace-stage">
          {exitingView && !isKeepAliveView(exitingView) ? (
            <div key={`exit-${exitingView}`} className="workspace-view workspace-view--exit" aria-hidden="true">
              {renderView(exitingView, appConfig, updateConfig)}
            </div>
          ) : null}
          {[...keepAliveViewsToRender].map((view) => (
            <KeepAliveWorkspaceView key={view} active={activeView === view}>
              {renderView(view, appConfig, updateConfig)}
            </KeepAliveWorkspaceView>
          ))}
          {!isKeepAliveView(activeView) ? (
            <div key={`active-${activeView}`} className="workspace-view workspace-view--active">
              {renderView(activeView, appConfig, updateConfig)}
            </div>
          ) : null}
        </div>
      </main>
      {updateModalOpen ? (
        <div className="update-modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && updateStatus !== "updating") setUpdateModalOpen(false);
        }}>
          <section className="update-modal" role="dialog" aria-modal="true" aria-labelledby="forart-update-title">
            <header className="update-modal-head">
              <div>
                <h2 id="forart-update-title">{modalTitle}</h2>
              </div>
              <button className="update-modal-close" type="button" aria-label={currentLanguage === "zh-CN" ? updateText.close : "Close"} disabled={updateStatus === "updating"} onClick={() => setUpdateModalOpen(false)}>
                <X size={18} aria-hidden="true" />
              </button>
            </header>

            <div className={`update-modal-summary ${updateStatus === "error" ? "fail" : updateStatus === "current" || updateStatus === "updated" ? "ok" : "warn"}`}>
              <span className="update-modal-dot" aria-hidden="true" />
              <div>
                <strong>{updateSummaryText}</strong>
              </div>
            </div>

            {updateProgressVisible ? (
              <section className="update-progress-panel" aria-label={currentLanguage === "zh-CN" ? "更新进度" : "Update progress"}>
                <div className="update-progress-head">
                  <strong>{updateProgressPhase}</strong>
                  <span>{Math.round(updateProgressPercent)}%</span>
                </div>
                <div className="update-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(updateProgressPercent)}>
                  <span style={{ width: `${updateProgressPercent}%` }} />
                </div>
                <div className="update-progress-meta">
                  <span>{updateProgressFile || (currentLanguage === "zh-CN" ? "准备中" : "Preparing")}</span>
                  <strong>{updateProgressTotal} · {updateProgressSpeed}</strong>
                </div>
                {updateProgress?.fileCount ? (
                  <div className="update-progress-meta muted">
                    <span>{currentLanguage === "zh-CN" ? "文件" : "File"} {updateProgress.fileIndex}/{updateProgress.fileCount}</span>
                    <strong>{formatBytes(updateProgress.fileBytes)}{updateProgress.fileTotalBytes ? ` / ${formatBytes(updateProgress.fileTotalBytes)}` : ""}</strong>
                  </div>
                ) : null}
              </section>
            ) : null}

            <section className="update-notes-panel">
              <div className="update-panel-head">
                <h3>{currentLanguage === "zh-CN" ? updateText.updateNotes : "Update notes"}</h3>
              </div>
              {notesItems.length ? (
                <ol className="update-notes-list">
                  {notesItems.slice(0, 8).map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
                </ol>
              ) : (
                <p className="update-empty-text">{currentLanguage === "zh-CN" ? updateText.noUpdateNotes : "No update notes found."}</p>
              )}
            </section>

            <div className="update-modal-grid">
              <section className="update-modal-panel">
                <div className="update-panel-head">
                  <h3>{currentLanguage === "zh-CN" ? updateText.connectivity : "Connectivity"}</h3>
                  <button className="update-modal-small-button" type="button" disabled={connectivityChecking || updateStatus === "updating"} onClick={runConnectivityCheck}>
                    <RefreshCw size={14} aria-hidden="true" />
                    <span>{connectivityChecking ? (currentLanguage === "zh-CN" ? updateText.connectivityChecking : "Testing") : (currentLanguage === "zh-CN" ? "\u91cd\u65b0\u68c0\u6d4b" : "Test")}</span>
                  </button>
                </div>
                <div className="update-connectivity-list">
                  {(connectivity?.results || []).length ? connectivity!.results.map((item) => (
                    <div className="update-connectivity-row" data-ok={item.ok ? "true" : "false"} key={item.name}>
                      {item.ok ? <CheckCircle2 size={16} aria-hidden="true" /> : <XCircle size={16} aria-hidden="true" />}
                      <span>{item.name}</span>
                      <strong>{item.ok ? "OK" : "Failed"} · {item.elapsedMs}ms</strong>
                    </div>
                  )) : (
                    <p className="update-empty-text">{currentLanguage === "zh-CN" ? "\u8fd8\u6ca1\u6709\u68c0\u6d4b\u7ed3\u679c\u3002" : "No connectivity results yet."}</p>
                  )}
                </div>
              </section>
            </div>

            <footer className="update-modal-actions">
              <button className="update-modal-button" type="button" disabled={updateStatus === "updating"} onClick={() => setUpdateModalOpen(false)}>
                {currentLanguage === "zh-CN" ? updateText.close : "Close"}
              </button>
              <button className="update-modal-button" type="button" disabled={updateStatus === "checking" || updateStatus === "updating"} onClick={() => checkForUpdates(true)}>
                <RefreshCw size={16} aria-hidden="true" />
                {currentLanguage === "zh-CN" ? "\u68c0\u67e5\u66f4\u65b0" : "Check"}
              </button>
              <button className="update-modal-button primary" type="button" disabled={!updateCanRun} onClick={confirmUpdate}>
                <Download size={16} aria-hidden="true" />
                {updateStatus === "updating" ? (currentLanguage === "zh-CN" ? updateText.updating : "Updating") : (currentLanguage === "zh-CN" ? updateText.startUpdate : "Start update")}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
      </div>
    </AppFrame>
  );
}
