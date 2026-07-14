import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Languages, Moon, Sun, type LucideIcon } from "lucide-react";
import { setActiveForartConfig } from "../data-source/runtime";
import { isKeepAliveView, workspaceRouteById } from "./appRoutes";
import { AppView, useAppStore } from "./appStore";
import type { ForartAppConfig } from "./appConfig";
import { SetupPage } from "./SetupPage";
import { allowsBrowserDiagnosticRuntime, isElectronRuntime, missingElectronBridgeNames } from "./electronRuntime";
import { UnsupportedRuntimePage } from "./UnsupportedRuntimePage";
import { Toaster } from "../components/ui/sonner";
import { Separator } from "../components/ui/separator";
import { SidebarInset, SidebarProvider } from "../components/ui/sidebar";
import { AppSidebar, AppSidebarTrigger } from "./AppSidebar";
import { useDesktopUpdater, type DesktopUpdateStatus } from "./update/DesktopUpdater";

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
const SIDEBAR_OPEN_KEY = "forart_sidebar_open_v2";
const APP_TITLE = "Forart";
function KeepAliveWorkspaceView({ active, view, children }: { active: boolean; view: AppView; children: ReactNode }) {
  return (
    <div
      className={`workspace-view workspace-view--keepalive${active ? " workspace-view--active" : " workspace-view--hidden"}`}
      data-view={view}
      aria-hidden={!active}
    >
      {children}
    </div>
  );
}

function renderView(view: AppView, appConfig: ForartAppConfig, onConfigChange: (config: ForartAppConfig) => void) {
  const route = workspaceRouteById[view] || workspaceRouteById.library;
  return route.render({ appConfig, onConfigChange });
}

interface WindowTitleBarProps {
  leading?: ReactNode;
  updateStatus: DesktopUpdateStatus;
  updateButtonTitle: string;
  updateButtonLabel: string;
  UpdateIcon: LucideIcon;
  onUpdateClick: () => void;
  ThemeIcon: typeof Moon;
  themeToggleLabel: string;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  languageTitle: string;
  languageCode: string;
  onToggleLanguage: () => void;
  windowMaximized: boolean;
  onToggleWindowMaximized: () => void;
}

function WindowTitleBar({
  leading,
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
  windowMaximized,
  onToggleWindowMaximized,
}: WindowTitleBarProps) {
  const { t } = useTranslation();
  return (
    <header className="window-titlebar" aria-label={t("app:windowControls")} onDoubleClick={onToggleWindowMaximized}>
      {leading ? <div className="window-titlebar-leading" onDoubleClick={(event) => event.stopPropagation()}>{leading}</div> : null}
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
          <UpdateIcon className="window-titlebar-update-icon" aria-hidden="true" size={12} />
          <span className="window-titlebar-update-label">{updateButtonLabel}</span>
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
        <Separator className="window-titlebar-separator" orientation="vertical" />
        <button className="window-titlebar-button" type="button" aria-label={t("app:minimizeWindow")} title={t("app:minimizeWindow")} onClick={() => void window.forartWindow?.minimize()}>
          <span className="window-caption-glyph" aria-hidden="true">&#xE921;</span>
        </button>
        <button className="window-titlebar-button" type="button" aria-label={t(windowMaximized ? "app:restoreWindow" : "app:maximizeWindow")} title={t(windowMaximized ? "app:restoreWindow" : "app:maximizeWindow")} onClick={onToggleWindowMaximized}>
          <span className="window-caption-glyph" aria-hidden="true">{windowMaximized ? "\uE923" : "\uE922"}</span>
        </button>
        <button className="window-titlebar-button window-titlebar-button--close" type="button" aria-label={t("common:actions.close")} title={t("common:actions.close")} onClick={() => void window.forartWindow?.close()}>
          <span className="window-caption-glyph" aria-hidden="true">&#xE8BB;</span>
        </button>
      </div>
    </header>
  );
}

function AppFrame({ electron, titleBar, children }: { electron: boolean; titleBar: ReactNode; children: ReactNode }) {
  const hasFrameTitleBar = electron && Boolean(titleBar);
  return (
    <div className={`app-frame${hasFrameTitleBar ? " app-frame--electron" : ""}`}>
      {hasFrameTitleBar ? titleBar : null}
      {children}
    </div>
  );
}

export function App() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const appTitle = APP_TITLE;
  const activeView = useAppStore((state) => state.activeView);
  const setActiveView = useAppStore((state) => state.setActiveView);
  const theme = useAppStore((state) => state.theme);
  const toggleTheme = useAppStore((state) => state.toggleTheme);
  const ThemeIcon = theme === "dark" ? Sun : Moon;
  const currentLanguage = i18n.language === "en-US" ? "en-US" : "zh-CN";
  const nextLanguage = currentLanguage === "zh-CN" ? "en-US" : "zh-CN";
  const nextLanguageLabel = nextLanguage === "zh-CN" ? t("settings:chinese") : t("settings:english");
  const isElectron = isElectronRuntime();
  const { control: updateControl, dialog: updateDialog } = useDesktopUpdater({ enabled: isElectron, language: currentLanguage });
  const [mountedKeepAliveViews, setMountedKeepAliveViews] = useState<Set<AppView>>(() => (isKeepAliveView(activeView) ? new Set([activeView]) : new Set()));
  const [appConfig, setAppConfig] = useState<ForartAppConfig | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.localStorage.getItem(SIDEBAR_OPEN_KEY) === "true");
  const [windowMaximized, setWindowMaximized] = useState(false);

  useEffect(() => {
    document.title = appTitle;
  }, [appTitle]);

  useEffect(() => {
    if (!isElectron) return;
    let canceled = false;
    void window.forartWindow?.isMaximized().then((result) => {
      if (!canceled && result.ok) setWindowMaximized(result.maximized);
    });
    const unsubscribe = window.forartWindow?.onMaximizedChanged(setWindowMaximized);
    return () => {
      canceled = true;
      unsubscribe?.();
    };
  }, [isElectron]);

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

  async function toggleWindowMaximized() {
    const result = await window.forartWindow?.toggleMaximize();
    if (result?.ok && typeof result.maximized === "boolean") setWindowMaximized(result.maximized);
  }

  const browserDiagnosticRuntime = !isElectron && allowsBrowserDiagnosticRuntime();
  const themeToggleLabel = theme === "dark" ? t("nav:theme.switchToLight") : t("nav:theme.switchToDark");
  const languageTitle = `${t("settings:language")}: ${nextLanguageLabel}`;
  const titleBar = (
    <WindowTitleBar
      updateStatus={updateControl.status}
      updateButtonTitle={updateControl.buttonTitle}
      updateButtonLabel={updateControl.buttonLabel}
      UpdateIcon={updateControl.icon}
      onUpdateClick={updateControl.open}
      ThemeIcon={ThemeIcon}
      themeToggleLabel={themeToggleLabel}
      theme={theme}
      onToggleTheme={toggleTheme}
      languageTitle={languageTitle}
      languageCode={nextLanguage === "zh-CN" ? "CN" : "EN"}
      onToggleLanguage={toggleLanguage}
      windowMaximized={windowMaximized}
      onToggleWindowMaximized={() => void toggleWindowMaximized()}
    />
  );
  const workspaceTitleBar = (
    <WindowTitleBar
      leading={<AppSidebarTrigger />}
      updateStatus={updateControl.status}
      updateButtonTitle={updateControl.buttonTitle}
      updateButtonLabel={updateControl.buttonLabel}
      UpdateIcon={updateControl.icon}
      onUpdateClick={updateControl.open}
      ThemeIcon={ThemeIcon}
      themeToggleLabel={themeToggleLabel}
      theme={theme}
      onToggleTheme={toggleTheme}
      languageTitle={languageTitle}
      languageCode={nextLanguage === "zh-CN" ? "CN" : "EN"}
      onToggleLanguage={toggleLanguage}
      windowMaximized={windowMaximized}
      onToggleWindowMaximized={() => void toggleWindowMaximized()}
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
    <>
      <AppFrame electron={isElectron} titleBar={null}>
        <SidebarProvider
          open={sidebarOpen}
          onOpenChange={(open) => {
            setSidebarOpen(open);
            window.localStorage.setItem(SIDEBAR_OPEN_KEY, String(open));
          }}
          className="app-shell h-full min-h-0"
        >
          <AppSidebar
            appTitle={appTitle}
            activeView={activeView}
            onNavigate={setActiveView}
            isElectron={isElectron}
            updateStatus={updateControl.status}
            updateButtonTitle={updateControl.buttonTitle}
            updateButtonLabel={updateControl.buttonLabel}
            UpdateIcon={updateControl.icon}
            onUpdateClick={updateControl.open}
            theme={theme}
            themeToggleLabel={themeToggleLabel}
            onToggleTheme={toggleTheme}
            languageTitle={languageTitle}
            languageCode={nextLanguage === "zh-CN" ? "CN" : "EN"}
            onToggleLanguage={toggleLanguage}
          />
          <SidebarInset className={`app-main-shell${isElectron ? " app-main-shell--electron" : ""}`}>
            {isElectron ? workspaceTitleBar : null}
            <div className="workspace" id="main-workspace">
              {[...keepAliveViewsToRender].map((view) => (
                <KeepAliveWorkspaceView key={view} active={activeView === view} view={view}>
                  {renderView(view, appConfig, updateConfig)}
                </KeepAliveWorkspaceView>
              ))}
              {!isKeepAliveView(activeView) ? (
                <div key={`active-${activeView}`} className="workspace-view workspace-view--active" data-view={activeView}>
                  {renderView(activeView, appConfig, updateConfig)}
                </div>
              ) : null}
            </div>
            {updateDialog}
          </SidebarInset>
        </SidebarProvider>
      </AppFrame>
      <Toaster theme={theme} position="bottom-right" />
    </>
  );
}
