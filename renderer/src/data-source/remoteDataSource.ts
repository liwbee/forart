import { ForartAppConfig } from "../app/appConfig";
import { ForartDataSource } from "./types";

export class RemoteDataSource implements ForartDataSource {
  constructor(private readonly config: ForartAppConfig) {}

  status() {
    return {
      mode: this.config.mode,
      apiBaseUrl: this.config.serverUrl,
      configured: Boolean(this.config.serverUrl),
    };
  }
}

