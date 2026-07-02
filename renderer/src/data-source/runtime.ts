import { ForartAppConfig } from "../app/appConfig";
import { LocalDataSource } from "./localDataSource";
import { RemoteDataSource } from "./remoteDataSource";
import { ForartDataSource } from "./types";

let activeConfig: ForartAppConfig | null = null;
let activeDataSource: ForartDataSource | null = null;

export function setActiveForartConfig(config: ForartAppConfig) {
  activeConfig = config;
  activeDataSource = createDataSource(config);
}

export function getActiveForartConfig() {
  return activeConfig;
}

export function getActiveDataSource() {
  return activeDataSource;
}

export function getApiBaseUrl() {
  if (!activeConfig) return "";
  if (activeConfig.mode === "remote") return activeConfig.serverUrl;
  return "http://127.0.0.1:6980";
}

function createDataSource(config: ForartAppConfig): ForartDataSource {
  return config.mode === "remote" ? new RemoteDataSource(config) : new LocalDataSource(config);
}
