import { ForartAppConfig } from "../app/appConfig";

export interface DataSourceStatus {
  mode: ForartAppConfig["mode"];
  apiBaseUrl: string;
  configured: boolean;
}

export interface ForartDataSource {
  status(): DataSourceStatus;
}

