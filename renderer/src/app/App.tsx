import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Download, Languages, Layers3, LayoutTemplate, LibraryBig, Moon, RefreshCw, ScanSearch, Settings, Sun, Users } from "lucide-react";
import { setActiveForartConfig } from "../data-source/runtime";
import { ImageReviewPage } from "../features/image-review/ImageReviewPage";
import { ResourceLibraryPage } from "../features/resource-library/ResourceLibraryPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { AppView, useAppStore } from "./appStore";
import type { ForartAppConfig, ForartAppInfo, ForartUpdateCheckResult, ForartUpdateRunResult } from "./appConfig";
import { getAppTitle } from "./runtimeConfig";
import { SetupPage } from "./SetupPage";

const navItems: Array<{
  id: AppView;
  labelKey: string;
  shortKey: string;
  icon: typeof Users;
}> = [
  { id: "library", labelKey: "nav.library", shortKey: "nav.short.library", icon: LibraryBig },
  { id: "free-canvas", labelKey: "nav.freeCanvas", shortKey: "nav.short.freeCanvas", icon: LayoutTemplate },
  { id: "image-review", labelKey: "nav.imageReview", shortKey: "nav.short.imageReview", icon: ScanSearch },
  { id: "canvas", labelKey: "nav.canvas", shortKey: "nav.short.canvas", icon: Layers3 },
];

const VIEW_TRANSITION_MS = 500;
const FreeCanvasPage = lazy(() => import("../features/free-canvas/FreeCanvasPage").then((module) => ({ default: module.FreeCanvasPage })));
const CanvasPage = lazy(() => import("../features/infinite-canvas/CanvasPage"));
const KEEP_ALIVE_VIEWS = new Set<AppView>(["free-canvas", "canvas"]);
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
};

function formatUpdateDate(value: string) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
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
  const appTitle = getAppTitle();
  const activeView = useAppStore((state) => state.activeView);
  const setActiveView = useAppStore((state) => state.setActiveView);
  const theme = useAppStore((state) => state.theme);
  const toggleTheme = useAppStore((state) => state.toggleTheme);
  const ThemeIcon = theme === "dark" ? Sun : Moon;
  const currentLanguage = i18n.language === "en-US" ? "en-US" : "zh-CN";
  const nextLanguage = currentLanguage === "zh-CN" ? "en-US" : "zh-CN";
  const nextLanguageLabel = nextLanguage === "zh-CN" ? t("settings.chinese") : t("settings.english");
  const previousViewRef = useRef(activeView);
  const [exitingView, setExitingView] = useState<AppView | null>(null);
  const [mountedKeepAliveViews, setMountedKeepAliveViews] = useState<Set<AppView>>(() => (isKeepAliveView(activeView) ? new Set([activeView]) : new Set()));
  const [appConfig, setAppConfig] = useState<ForartAppConfig | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [appInfo, setAppInfo] = useState<ForartAppInfo | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const [latestUpdatedAt, setLatestUpdatedAt] = useState("");
  const [updateMessage, setUpdateMessage] = useState("");

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
        if (config) setActiveForartConfig(config);
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

  function updateConfig(config: ForartAppConfig) {
    setActiveForartConfig(config);
    setAppConfig(config);
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
      return;
    }

    setLatestUpdatedAt(result.latestUpdatedAt || result.currentUpdatedAt);
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
  }

  async function handleUpdateClick() {
    if (updateStatus === "checking" || updateStatus === "updating") return;

    if (updateStatus === "available") {
      setUpdateStatus("updating");
      setUpdateMessage(currentLanguage === "zh-CN" ? updateText.updatingMessage : "Updating...");
      const canGitUpdate = appInfo?.canGitUpdate ?? false;
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
      return;
    }

    await checkForUpdates(true);
  }

  const updateDateLabel = formatUpdateDate(latestUpdatedAt || appInfo?.currentUpdatedAt || "");
  const updateButtonLabel = updateStatus === "available"
    ? `${currentLanguage === "zh-CN" ? updateText.updateAvailableShort : "Update"}v${updateDateLabel}`
    : updateStatus === "checking"
      ? (currentLanguage === "zh-CN" ? updateText.checking : "Checking")
      : updateStatus === "updating"
        ? (currentLanguage === "zh-CN" ? updateText.updating : "Updating")
        : updateStatus === "updated"
          ? (currentLanguage === "zh-CN" ? updateText.restart : "Restart")
          : `v${updateDateLabel}`;
  const updateButtonTitle = updateMessage || (currentLanguage === "zh-CN" ? updateText.checkingTitle : "Click to check for updates");
  const UpdateIcon = updateStatus === "available" ? Download : RefreshCw;

  const keepAliveViewsToRender = isKeepAliveView(activeView)
    ? new Set([...mountedKeepAliveViews, activeView])
    : mountedKeepAliveViews;

  if (!configLoaded) {
    return (
      <main className="setup-shell">
        <section className="setup-panel setup-panel--loading" aria-label={t("app.loadingLabel")}>
          <div className="brand setup-brand" aria-label={appTitle}>
            <span className="brand-mark" aria-hidden="true" />
            <strong className="brand-name">{appTitle}</strong>
          </div>
          <p>{t("app.loadingConfig")}</p>
        </section>
      </main>
    );
  }

  if (!appConfig) {
    return <SetupPage initialConfig={null} onConfigured={updateConfig} />;
  }

  return (
    <div className="app-shell">
      <aside className="left-panel" aria-label={`${appTitle} navigation`}>
        <div className="side-head">
          <div className="brand" aria-label={appTitle}>
            <span className="brand-mark" aria-hidden="true" />
            <strong className="brand-name">{appTitle}</strong>
          </div>
        </div>

        <nav className="side-nav" aria-label={t("app.mainNavigation")}>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                className={`side-nav-item${isActive ? " active" : ""}`}
                type="button"
                data-short={t(item.shortKey)}
                aria-current={isActive ? "page" : undefined}
                onClick={() => setActiveView(item.id)}
              >
                <Icon className="nav-icon" aria-hidden="true" size={20} />
                <span className="nav-label">{t(item.labelKey)}</span>
              </button>
            );
          })}
        </nav>

        <div className="side-footer" aria-label={t("app.settingsNavigation")}>
          <button
            className={`side-nav-item side-footer-button${activeView === "settings" ? " active" : ""}`}
            type="button"
            data-short={t("nav.short.settings")}
            aria-current={activeView === "settings" ? "page" : undefined}
            onClick={() => setActiveView("settings")}
          >
            <Settings className="nav-icon" aria-hidden="true" size={20} />
            <span className="nav-label">{t("nav.settings")}</span>
          </button>

          <button
            className="side-version-button"
            type="button"
            data-status={updateStatus}
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
              data-short={theme === "dark" ? t("nav.short.light") : t("nav.short.dark")}
              aria-pressed={theme === "dark"}
              aria-label={theme === "dark" ? t("nav.theme.switchToLight") : t("nav.theme.switchToDark")}
              title={theme === "dark" ? t("nav.theme.switchToLight") : t("nav.theme.switchToDark")}
              onClick={toggleTheme}
            >
              <ThemeIcon className="nav-icon" aria-hidden="true" size={20} />
            </button>

            <button
              className="side-nav-item side-footer-button side-icon-button language-toggle"
              type="button"
              aria-label={`${t("settings.language")}: ${nextLanguageLabel}`}
              title={`${t("settings.language")}: ${nextLanguageLabel}`}
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
    </div>
  );
}
