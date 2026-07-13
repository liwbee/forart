import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/electron",
  outputDir: "./test-results/playwright",
  snapshotPathTemplate: "{testDir}/baselines/{arg}{ext}",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.01,
    },
  },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    actionTimeout: 10_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev:web",
    url: "http://127.0.0.1:6981",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
