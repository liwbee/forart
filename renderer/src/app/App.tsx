import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Languages, Layers3, LayoutTemplate, LibraryBig, Moon, ScanSearch, Settings, Sun, Users } from "lucide-react";
import { setActiveForartConfig } from "../data-source/runtime";
import { ImageReviewPage } from "../features/image-review/ImageReviewPage";
import { ResourceLibraryPage } from "../features/resource-library/ResourceLibraryPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { AppView, useAppStore } from "./appStore";
import { ForartAppConfig } from "./appConfig";
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

  useEffect(() => {
    document.title = appTitle;
  }, [appTitle]);

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
  }

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
