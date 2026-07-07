import { Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { LibrarySearchInput } from "../library-layout/LibrarySearchInput";
import { resourceLibraryTabById, resourceLibraryTabs, type ResourceLibraryTab } from "./resourceLibraryTabs";

export function ResourceLibraryPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<ResourceLibraryTab>("models");
  const [searchQuery, setSearchQuery] = useState("");
  const activeTabConfig = resourceLibraryTabById[activeTab] || resourceLibraryTabById.models;
  const ActivePage = activeTabConfig.Page;

  return (
    <section className="resource-library-page" aria-label={t("resourceLibrary:title")}>
      <div className="resource-library-shell">
        <header className="resource-library-header">
          <h1>{t("resourceLibrary:title")}</h1>
        </header>

        <nav className="resource-library-nav" aria-label={t("resourceLibrary:navigation")}>
          <div className="resource-library-tabs" role="tablist">
            {resourceLibraryTabs.map((tab) => {
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

          <LibrarySearchInput
            className="resource-library-search"
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder={t("resourceLibrary:searchPlaceholder")}
            clearLabel={t("resourceLibrary:clearSearch")}
          />
        </nav>

        <div className="resource-library-content" role="tabpanel" aria-label={t(activeTabConfig.labelKey)}>
          <Suspense fallback={<div className="view-loading">{t(activeTabConfig.labelKey)}</div>}>
            <ActivePage searchQuery={searchQuery} />
          </Suspense>
        </div>
      </div>
    </section>
  );
}
