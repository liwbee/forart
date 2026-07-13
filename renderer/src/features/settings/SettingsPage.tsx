import { HardDrive, KeyRound, Settings } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { type ForartAppConfig } from "../../app/appConfig";
import { NativeTabs, type NativeTabItem } from "../../components/NativeTabs";
import { ApiSettingsPanel } from "./ApiSettingsPanel";
import { CacheSettingsPanel } from "./CacheSettingsPanel";
import { GeneralSettingsPanel } from "./GeneralSettingsPanel";

interface SettingsPageProps {
  config: ForartAppConfig;
  onConfigChange: (config: ForartAppConfig) => void;
}

type SettingsTab = "general" | "api" | "cache";

export function SettingsPage({ config, onConfigChange }: SettingsPageProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const settingsNavTabs = useMemo<NativeTabItem<SettingsTab>[]>(() => [
    { value: "general", label: t("settings:generalSettings"), icon: Settings },
    { value: "api", label: t("settings:apiSettings"), icon: KeyRound },
    { value: "cache", label: t("settings:cacheCleanup"), icon: HardDrive },
  ], [t]);

  return (
    <section className="settings-page" aria-label={t("settings:title")}>
      <div className="settings-shell">
        <header className="settings-header">
          <div>
            <h1>{t("settings:title")}</h1>
          </div>
        </header>

        <NativeTabs
          items={settingsNavTabs}
          value={activeTab}
          onChange={setActiveTab}
          ariaLabel={t("settings:settingsNavigation")}
          className="settings-nav"
        />

        <GeneralSettingsPanel
          config={config}
          onConfigChange={onConfigChange}
          hidden={activeTab !== "general"}
        />
        {activeTab === "api" ? <ApiSettingsPanel /> : null}
        {activeTab === "cache" ? <CacheSettingsPanel /> : null}
      </div>
    </section>
  );
}
