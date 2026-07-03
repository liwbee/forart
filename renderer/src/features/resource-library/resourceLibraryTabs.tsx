import { lazy, type ComponentType } from "react";
import { Images, PersonStanding, Users, type LucideIcon } from "lucide-react";

export type ResourceLibraryTab = "models" | "actions" | "outfits";

export interface ResourceLibraryTabPageProps {
  searchQuery: string;
}

interface ResourceLibraryTabConfig {
  id: ResourceLibraryTab;
  labelKey: string;
  icon: LucideIcon;
  Page: ComponentType<ResourceLibraryTabPageProps>;
}

const ModelLibraryPage = lazy(() => import("../model-library/ModelLibraryPage").then((module) => ({ default: module.ModelLibraryPage })));
const ActionLibraryPage = lazy(() => import("../action-library/ActionLibraryPage").then((module) => ({ default: module.ActionLibraryPage })));
const OutfitLibraryPage = lazy(() => import("../outfit-library/OutfitLibraryPage").then((module) => ({ default: module.OutfitLibraryPage })));

export const resourceLibraryTabs: ResourceLibraryTabConfig[] = [
  { id: "models", labelKey: "resourceLibrary:models", icon: Users, Page: ModelLibraryPage },
  { id: "actions", labelKey: "resourceLibrary:actions", icon: PersonStanding, Page: ActionLibraryPage },
  { id: "outfits", labelKey: "resourceLibrary:outfits", icon: Images, Page: OutfitLibraryPage },
];

export const resourceLibraryTabById = resourceLibraryTabs.reduce<Record<ResourceLibraryTab, ResourceLibraryTabConfig>>((tabs, tab) => {
  tabs[tab.id] = tab;
  return tabs;
}, {} as Record<ResourceLibraryTab, ResourceLibraryTabConfig>);
