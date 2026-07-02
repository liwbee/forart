import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, Languages, Layers3, LayoutTemplate, LibraryBig, Moon, PanelLeftClose, PanelLeftOpen, RefreshCw, ScanSearch, Settings, Sun, Users, X, XCircle } from "lucide-react";
import { setActiveForartConfig } from "../data-source/runtime";
import { ImageReviewPage } from "../features/image-review/ImageReviewPage";
import { ResourceLibraryPage } from "../features/resource-library/ResourceLibraryPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { AppView, useAppStore } from "./appStore";
import type { ForartAppConfig, ForartAppInfo, ForartUpdateCheckResult, ForartUpdateConnectivityResult, ForartUpdateNotes, ForartUpdateRunResult } from "./appConfig";
import { getAppTitle } from "./runtimeConfig";
import { SetupPage } from "./SetupPage";

const navItems: Array<{
  id: AppView;
  labelKey: string;
  shortKey: string;
  icon: typeof Users;
}> = [
  { id: "library", labelKey: "nav:library", shortKey: "nav:short.library", icon: LibraryBig },
  { id: "free-canvas", labelKey: "nav:freeCanvas", shortKey: "nav:short.freeCanvas", icon: LayoutTemplate },
  { id: "image-review", labelKey: "nav:imageReview", shortKey: "nav:short.imageReview", icon: ScanSearch },
  { id: "canvas", labelKey: "nav:canvas", shortKey: "nav:short.canvas", icon: Layers3 },
];

const VIEW_TRANSITION_MS = 500;
const FreeCanvasPage = lazy(() => import("../features/free-canvas/FreeCanvasPage").then((module) => ({ default: module.FreeCanvasPage })));
const CanvasPage = lazy(() => import("../features/infinite-canvas/CanvasPage"));
const KEEP_ALIVE_VIEWS = new Set<AppView>(["free-canvas", "canvas"]);
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
  updateFinished: "\u66f4\u65b0\u5b8c\u6210\uff0c\u91cd\u542f\u540e\u751f\u6548",
  updateAvailable: "\u53d1\u73b0\u65b0\u66f4\u65b0\uff0c\u518d\u70b9\u4e00\u6b21\u66f4\u65b0",
  openProjectAvailable: "\u53d1\u73b0\u65b0\u66f4\u65b0\uff0c\u518d\u70b9\u4e00\u6b21\u6253\u5f00\u9879\u76ee\u9875",
  projectOpened: "\u5df2\u6253\u5f00\u9879\u76ee\u9875\u9762",
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

function isKeepAliveView(view: AppView) {
  return KEEP_ALIVE_VIEWS.has(view);
}

function KeepAliveWorkspaceView({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <div className={`workspace-view workspace-view--keepalive${active ? " workspace-view--active" : " workspace-view--hidden"}`} aria-hidden={!active}>
      {children}
    </div>
  );
}

function renderView(view: AppView, appConfig: ForartAppConfig, onConfigChange: (config: ForartAppConfig) => void) {
  if (view === "library") return <ResourceLibraryPage />;
  if (view === "free-canvas") {
    return (
      <Suspense fallback={<div className="view-loading">{appConfig ? "Loading free canvas..." : ""}</div>}>
        <FreeCanvasPage />
      </Suspense>
    );
  }
  if (view === "image-review") return <ImageReviewPage />;
  if (view === "canvas") {
    return (
      <Suspense fallback={<div className="view-loading">{appConfig ? "Loading canvas..." : ""}</div>}>
        <CanvasPage imageDownloadPath={appConfig.imageDownloadPath} />
      </Suspense>
    );
  }
  if (view === "settings") return <SettingsPage config={appConfig} onConfigChange={onConfigChange} />;
  return <ResourceLibraryPage />;
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
  const [connectivity, setConnectivity] = useState<ForartUpdateConnectivityResult | null>(null);
  const [connectivityChecking, setConnectivityChecking] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    document.title = appTitle;
  }, [appTitle]);

  useEffect(() => {
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
      canGitUpdate: appInfo?.canGitUpdate ?? false,
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
      canGitUpdate: result.canGitUpdate,
      repoUrl: result.repoUrl,
      currentRevision: result.currentRevision || current.currentRevision,
      currentUpdatedAt: result.currentUpdatedAt || current.currentUpdatedAt,
    } : current);
    if (result.updateAvailable) {
      setUpdateStatus("available");
      setUpdateMessage(result.canGitUpdate
        ? (currentLanguage === "zh-CN" ? updateText.updateAvailable : "Update available. Click again to update.")
        : (currentLanguage === "zh-CN" ? updateText.openProjectAvailable : "Update available. Click again to open project page."));
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
    setUpdateMessage(currentLanguage === "zh-CN" ? updateText.updatingMessage : "Updating...");
    const canGitUpdate = updateCheckResult?.canGitUpdate ?? appInfo?.canGitUpdate ?? false;
    const result: ForartUpdateRunResult | undefined = canGitUpdate
      ? await window.forartConfig?.runUpdate().catch((error): ForartUpdateRunResult => ({ ok: false, error: String(error) }))
      : await window.forartConfig?.openUpdatePage().then((): ForartUpdateRunResult => ({ ok: true, restartRequired: false })).catch((error): ForartUpdateRunResult => ({ ok: false, error: String(error) }));

    if (result?.ok) {
      setUpdateStatus(canGitUpdate ? "updated" : "current");
      setUpdateMessage(canGitUpdate
        ? (currentLanguage === "zh-CN" ? updateText.updateFinished : "Updated. Restart to apply.")
        : (currentLanguage === "zh-CN" ? updateText.projectOpened : "Project page opened."));
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
  const updateButtonLabel = updateStatus === "available"
    ? `${currentLanguage === "zh-CN" ? updateText.updateAvailableShort : "Update"}v${latestUpdateDateLabel}`
    : updateStatus === "checking"
      ? (currentLanguage === "zh-CN" ? updateText.checking : "Checking")
      : updateStatus === "updating"
        ? (currentLanguage === "zh-CN" ? updateText.updating : "Updating")
        : updateStatus === "updated"
          ? (currentLanguage === "zh-CN" ? updateText.restart : "Restart")
          : `v${currentUpdateDateLabel}`;
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
    ? `${currentLanguage === "zh-CN" ? "\u6709\u53ef\u7528\u66f4\u65b0" : "Update available"} ${latestUpdateDateLabel}`
    : updateStatus === "current"
      ? `${currentLanguage === "zh-CN" ? "\u5df2\u662f\u6700\u65b0\u7248\u672c" : "Already up to date"} ${currentUpdateDateLabel}`
      : updateMessage || (currentLanguage === "zh-CN" ? updateText.connectivityWarn : "Check status before updating");
  const sidebarToggleLabel = sidebarCollapsed ? t("nav:expandSidebar") : t("nav:collapseSidebar");
  const SidebarToggleIcon = sidebarCollapsed ? PanelLeftOpen : PanelLeftClose;

  const keepAliveViewsToRender = isKeepAliveView(activeView)
    ? new Set([...mountedKeepAliveViews, activeView])
    : mountedKeepAliveViews;

  if (!configLoaded) {
    return (
      <main className="setup-shell">
        <section className="setup-panel setup-panel--loading" aria-label={t("app:loadingLabel")}>
          <div className="brand setup-brand" aria-label={appTitle}>
            <span className="brand-mark" aria-hidden="true" />
            <strong className="brand-name">{appTitle}</strong>
          </div>
          <p>{t("app:loadingConfig")}</p>
        </section>
      </main>
    );
  }

  if (!appConfig) {
    return <SetupPage initialConfig={null} onConfigured={updateConfig} />;
  }

  return (
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
          {navItems.map((item) => {
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

          <div className="side-footer-control-row">
            <button
              className="side-nav-item side-footer-button side-icon-button theme-toggle"
              type="button"
              data-short={theme === "dark" ? t("nav:short.light") : t("nav:short.dark")}
              data-tooltip={theme === "dark" ? t("nav:theme.switchToLight") : t("nav:theme.switchToDark")}
              aria-pressed={theme === "dark"}
              aria-label={theme === "dark" ? t("nav:theme.switchToLight") : t("nav:theme.switchToDark")}
              title={theme === "dark" ? t("nav:theme.switchToLight") : t("nav:theme.switchToDark")}
              onClick={toggleTheme}
            >
              <ThemeIcon className="nav-icon" aria-hidden="true" size={20} />
            </button>

            <button
              className="side-nav-item side-footer-button side-icon-button language-toggle"
              type="button"
              data-tooltip={`${t("settings:language")}: ${nextLanguageLabel}`}
              aria-label={`${t("settings:language")}: ${nextLanguageLabel}`}
              title={`${t("settings:language")}: ${nextLanguageLabel}`}
              onClick={toggleLanguage}
            >
              <Languages className="nav-icon" aria-hidden="true" size={20} />
              <span className="language-toggle__code">{nextLanguage === "zh-CN" ? "CN" : "EN"}</span>
            </button>
          </div>
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
  );
}
