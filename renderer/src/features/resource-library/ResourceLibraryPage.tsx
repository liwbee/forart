import { useState } from "react";
import { useTranslation } from "react-i18next";
import { NativeTabs } from "../../components/NativeTabs";
import { SearchInput } from "../../components/SearchInput";
import { resourceLibraryTabById, resourceLibraryTabs, type ResourceLibraryTab } from "./resourceLibraryTabs";

export function ResourceLibraryPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<ResourceLibraryTab>("models");
  const [searchQuery, setSearchQuery] = useState("");
  const activeTabConfig = resourceLibraryTabById[activeTab] || resourceLibraryTabById.models;
  const ActivePage = activeTabConfig.Page;

  return (
    <section className="resource-library-page" aria-label={t("resourceLibrary:title")}>
      <nav className="resource-library-nav" aria-label={t("resourceLibrary:navigation")}>
        <NativeTabs
          items={resourceLibraryTabs.map((tab) => ({ value: tab.id, label: t(tab.labelKey), icon: tab.icon }))}
          value={activeTab}
          onChange={setActiveTab}
          ariaLabel={t("resourceLibrary:navigation")}
          className="resource-library-tabs"
        />

        <SearchInput
          className="library-search resource-library-search"
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder={t("resourceLibrary:searchPlaceholder")}
          clearLabel={t("resourceLibrary:clearSearch")}
        />
      </nav>

      <div className="resource-library-content" role="tabpanel" aria-label={t(activeTabConfig.labelKey)}>
        <ActivePage searchQuery={searchQuery} />
      </div>
    </section>
  );
}
