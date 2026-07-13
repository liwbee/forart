import type { ComponentType } from "react";
import { Images, PersonStanding, Users, type LucideIcon } from "lucide-react";
import { ActionLibraryPage } from "../action-library/ActionLibraryPage";
import { ModelLibraryPage } from "../model-library/ModelLibraryPage";
import { OutfitLibraryPage } from "../outfit-library/OutfitLibraryPage";

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

export const resourceLibraryTabs: ResourceLibraryTabConfig[] = [
  { id: "models", labelKey: "resourceLibrary:models", icon: Users, Page: ModelLibraryPage },
  { id: "actions", labelKey: "resourceLibrary:actions", icon: PersonStanding, Page: ActionLibraryPage },
  { id: "outfits", labelKey: "resourceLibrary:outfits", icon: Images, Page: OutfitLibraryPage },
];

export const resourceLibraryTabById = resourceLibraryTabs.reduce<Record<ResourceLibraryTab, ResourceLibraryTabConfig>>((tabs, tab) => {
  tabs[tab.id] = tab;
  return tabs;
}, {} as Record<ResourceLibraryTab, ResourceLibraryTabConfig>);
