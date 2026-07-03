import { lazy, Suspense, type ReactNode } from "react";
import { Layers3, LayoutTemplate, LibraryBig, ScanSearch, Settings, type LucideIcon } from "lucide-react";
import type { ForartAppConfig } from "./appConfig";
import type { AppView } from "./appStore";

interface WorkspaceRouteRenderProps {
  appConfig: ForartAppConfig;
  onConfigChange: (config: ForartAppConfig) => void;
}

interface WorkspaceRoute {
  id: AppView;
  labelKey: string;
  shortKey: string;
  icon: LucideIcon;
  keepAlive?: boolean;
  render: (props: WorkspaceRouteRenderProps) => ReactNode;
}

const ResourceLibraryPage = lazy(() => import("../features/resource-library/ResourceLibraryPage").then((module) => ({ default: module.ResourceLibraryPage })));
const FreeCanvasPage = lazy(() => import("../features/free-canvas/FreeCanvasPage").then((module) => ({ default: module.FreeCanvasPage })));
const ImageReviewPage = lazy(() => import("../features/image-review/ImageReviewPage").then((module) => ({ default: module.ImageReviewPage })));
const SettingsPage = lazy(() => import("../features/settings/SettingsPage").then((module) => ({ default: module.SettingsPage })));
const CanvasPage = lazy(() => import("../features/infinite-canvas/CanvasPage"));

function LazyWorkspacePage({ children, fallback }: { children: ReactNode; fallback: string }) {
  return <Suspense fallback={<div className="view-loading">{fallback}</div>}>{children}</Suspense>;
}

export const workspaceRoutes: WorkspaceRoute[] = [
  {
    id: "library",
    labelKey: "nav:library",
    shortKey: "nav:short.library",
    icon: LibraryBig,
    render: () => (
      <LazyWorkspacePage fallback="Loading library...">
        <ResourceLibraryPage />
      </LazyWorkspacePage>
    ),
  },
  {
    id: "free-canvas",
    labelKey: "nav:freeCanvas",
    shortKey: "nav:short.freeCanvas",
    icon: LayoutTemplate,
    keepAlive: true,
    render: () => (
      <LazyWorkspacePage fallback="Loading free canvas...">
        <FreeCanvasPage />
      </LazyWorkspacePage>
    ),
  },
  {
    id: "image-review",
    labelKey: "nav:imageReview",
    shortKey: "nav:short.imageReview",
    icon: ScanSearch,
    render: () => (
      <LazyWorkspacePage fallback="Loading image review...">
        <ImageReviewPage />
      </LazyWorkspacePage>
    ),
  },
  {
    id: "canvas",
    labelKey: "nav:canvas",
    shortKey: "nav:short.canvas",
    icon: Layers3,
    keepAlive: true,
    render: ({ appConfig }) => (
      <LazyWorkspacePage fallback="Loading canvas...">
        <CanvasPage imageDownloadPath={appConfig.imageDownloadPath} />
      </LazyWorkspacePage>
    ),
  },
  {
    id: "settings",
    labelKey: "nav:settings",
    shortKey: "nav:short.settings",
    icon: Settings,
    render: ({ appConfig, onConfigChange }) => (
      <LazyWorkspacePage fallback="Loading settings...">
        <SettingsPage config={appConfig} onConfigChange={onConfigChange} />
      </LazyWorkspacePage>
    ),
  },
];

export const navRoutes = workspaceRoutes.filter((route) => route.id !== "settings");

export const workspaceRouteById = workspaceRoutes.reduce<Record<AppView, WorkspaceRoute>>((routes, route) => {
  routes[route.id] = route;
  return routes;
}, {} as Record<AppView, WorkspaceRoute>);

export function isKeepAliveView(view: AppView) {
  return Boolean(workspaceRouteById[view]?.keepAlive);
}
