import { ForartAppConfig } from "../app/appConfig";

let activeConfig: ForartAppConfig | null = null;

export function setActiveForartConfig(config: ForartAppConfig) {
  activeConfig = config;
}

export function getActiveForartConfig() {
  return activeConfig;
}

export function getApiBaseUrl() {
  if (!activeConfig) return "";
  if (activeConfig.mode === "remote") return activeConfig.serverUrl;
  return "";
}
