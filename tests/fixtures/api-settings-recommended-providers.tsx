import React from "react";
import ReactDOM from "react-dom/client";
import "../../renderer/src/i18n";
import "../../renderer/src/styles/global.css";
import { ApiSettingsPanel } from "../../renderer/src/features/settings/ApiSettingsPanel";
import type { ApiSettings } from "../../renderer/src/features/settings/apiProviders";

let settings: ApiSettings = {
  providers: [],
  defaultImageProviderId: "",
  providerOrder: [],
  libtvMachineId: "",
  libtvActionFissionConcurrency: 1,
};

(window as unknown as { forartConfig: unknown }).forartConfig = {
  async loadApiSettings() {
    return settings;
  },
  async saveApiSettings(nextSettings: ApiSettings) {
    settings = nextSettings;
    document.documentElement.dataset.providerOrder = (settings.providerOrder || []).join(",");
    return { ok: true, apiSettings: settings };
  },
};

(window as unknown as { libtv: unknown }).libtv = {
  async status() {
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    return { available: false, version: "", error: "" };
  },
  async account() { return { loggedIn: false, account: null }; },
  async accounts() { return { accounts: [] }; },
  async power() { return { total: null, remaining: null }; },
};

(window as unknown as { forartWindow: unknown }).forartWindow = {
  async openOfficialWebsite(providerId: string) {
    document.documentElement.dataset.openedProviderWebsite = providerId;
    return { ok: true };
  },
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <main className="settings-content" style={{ maxWidth: 1180, margin: "0 auto", padding: 12 }}>
    <ApiSettingsPanel />
  </main>,
);
