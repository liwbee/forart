import { lazy, Suspense, type ReactNode } from "react";
import { Layers3, LayoutTemplate, LibraryBig, ScanSearch, Settings, type LucideIcon } from "lucide-react";
import { FreeCanvasPage } from "../features/free-canvas/FreeCanvasPage";
import { ImageReviewPage } from "../features/image-review/ImageReviewPage";
import { ResourceLibraryPage } from "../features/resource-library/ResourceLibraryPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import type { ForartAppConfig } from "./appConfig";
import type { AppView } from "./appStore";
import { CanvasPageSkeleton } from "./WorkspacePageSkeletons";

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

const CanvasPage = lazy(() => import("../features/infinite-canvas/CanvasPageEntry"));

function LazyWorkspacePage({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  return <Suspense fallback={fallback}>{children}</Suspense>;
}

export const workspaceRoutes: WorkspaceRoute[] = [
  {
    id: "library",
    labelKey: "nav:library",
    shortKey: "nav:short.library",
    icon: LibraryBig,
    render: () => <ResourceLibraryPage />,
  },
  {
    id: "free-canvas",
    labelKey: "nav:freeCanvas",
    shortKey: "nav:short.freeCanvas",
    icon: LayoutTemplate,
    keepAlive: true,
    render: () => <FreeCanvasPage />,
  },
  {
    id: "image-review",
    labelKey: "nav:imageReview",
    shortKey: "nav:short.imageReview",
    icon: ScanSearch,
    render: () => <ImageReviewPage />,
  },
  {
    id: "canvas",
    labelKey: "nav:canvas",
    shortKey: "nav:short.canvas",
    icon: Layers3,
    keepAlive: true,
    render: ({ appConfig }) => (
      <LazyWorkspacePage fallback={<CanvasPageSkeleton />}>
        <CanvasPage
          imageDownloadPath={appConfig.imageDownloadPath}
          serverUrl={appConfig.mode === "remote" ? appConfig.serverUrl : ""}
          sharedCanvasesEnabled={appConfig.mode === "remote"}
        />
      </LazyWorkspacePage>
    ),
  },
  {
    id: "settings",
    labelKey: "nav:settings",
    shortKey: "nav:short.settings",
    icon: Settings,
    render: ({ appConfig, onConfigChange }) => <SettingsPage config={appConfig} onConfigChange={onConfigChange} />,
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
