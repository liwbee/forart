import { Images, PersonStanding, Search, Users, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionLibraryPage } from "../action-library/ActionLibraryPage";
import { ModelLibraryPage } from "../model-library/ModelLibraryPage";
import { OutfitLibraryPage } from "../outfit-library/OutfitLibraryPage";

type ResourceLibraryTab = "models" | "actions" | "outfits";

const libraryTabs: Array<{
  id: ResourceLibraryTab;
  labelKey: string;
  icon: typeof Users;
}> = [
  { id: "models", labelKey: "resourceLibrary:models", icon: Users },
  { id: "actions", labelKey: "resourceLibrary:actions", icon: PersonStanding },
  { id: "outfits", labelKey: "resourceLibrary:outfits", icon: Images },
];

function renderLibrary(tab: ResourceLibraryTab, searchQuery: string) {
  if (tab === "models") return <ModelLibraryPage searchQuery={searchQuery} />;
  if (tab === "actions") return <ActionLibraryPage searchQuery={searchQuery} />;
  return <OutfitLibraryPage searchQuery={searchQuery} />;
}

export function ResourceLibraryPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<ResourceLibraryTab>("models");
  const [searchQuery, setSearchQuery] = useState("");
  const activeTabLabel = libraryTabs.find((tab) => tab.id === activeTab)?.labelKey || "resourceLibrary:models";

  return (
    <section className="resource-library-page" aria-label={t("resourceLibrary:title")}>
      <div className="resource-library-shell">
        <header className="resource-library-header">
          <h1>{t("resourceLibrary:title")}</h1>
        </header>

        <nav className="resource-library-nav" aria-label={t("resourceLibrary:navigation")}>
          <div className="resource-library-tabs" role="tablist">
            {libraryTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={isActive ? "active" : ""}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <Icon size={16} aria-hidden="true" />
                  <span>{t(tab.labelKey)}</span>
                </button>
              );
            })}
          </div>

          <label className="model-library-search resource-library-search">
            <Search size={18} aria-hidden="true" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t("resourceLibrary:searchPlaceholder")}
              aria-label={t("resourceLibrary:searchPlaceholder")}
            />
            {searchQuery ? (
              <button type="button" aria-label={t("resourceLibrary:clearSearch")} onClick={() => setSearchQuery("")}>
                <X size={16} aria-hidden="true" />
              </button>
            ) : null}
          </label>
        </nav>

        <div className="resource-library-content" role="tabpanel" aria-label={t(activeTabLabel)}>
          {renderLibrary(activeTab, searchQuery)}
        </div>
      </div>
    </section>
  );
}
