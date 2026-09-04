import base from "./playwright.config";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  ...base,
  webServer: base.webServer && !Array.isArray(base.webServer)
    ? { ...base.webServer, reuseExistingServer: true }
    : base.webServer,
});
