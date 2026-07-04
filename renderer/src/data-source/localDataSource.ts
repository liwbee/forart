import { ForartAppConfig } from "../app/appConfig";
import { ForartDataSource } from "./types";

export class LocalDataSource implements ForartDataSource {
  constructor(private readonly config: ForartAppConfig) {}

  status() {
    return {
      mode: this.config.mode,
      apiBaseUrl: "",
      configured: Boolean(this.config.localLibraryPath),
    };
  }
}
