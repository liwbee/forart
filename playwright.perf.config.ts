import { defineConfig } from "@playwright/test";

// Temporary harness for the infinite-canvas lag investigation. Delete with tests/perf.
export default defineConfig({
  testDir: "./tests/perf",
  outputDir: "./.tmp/perf/results",
  timeout: 600_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    actionTimeout: 15_000,
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: "npm run dev:web",
    url: "http://127.0.0.1:6981",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
