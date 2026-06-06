import { ForartAppConfig } from "../app/appConfig";
import { ForartDataSource } from "./types";

export class LocalDataSource implements ForartDataSource {
  constructor(private readonly config: ForartAppConfig) {}

  status() {
    return {
      mode: this.config.mode,
      apiBaseUrl: "http://127.0.0.1:5175",
      configured: Boolean(this.config.localLibraryPath),
    };
  }
}

