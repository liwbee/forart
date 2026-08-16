import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });

test("keeps resource pages rendered when the configured server is unreachable", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.addInitScript(() => {
    const stateWindow = window as typeof window & { __resourceLibraryStates?: string[] };
    stateWindow.__resourceLibraryStates = [];
    window.addEventListener("DOMContentLoaded", () => {
      let previousState = "";
      const captureState = () => {
        const library = document.querySelector(".resource-library-page");
        if (!library) return;
        const state = library.querySelector("[role='alert']")
          ? "error"
          : library.querySelector(".library-project-list-empty")
            ? "empty"
            : library.querySelector("[aria-label='Loading projects']")
              ? "loading"
              : "other";
        if (state === previousState) return;
        stateWindow.__resourceLibraryStates?.push(state);
        previousState = state;
      };
      new MutationObserver(captureState).observe(document.body, { childList: true, subtree: true });
      captureState();
    });
    window.localStorage.setItem("forart_sidebar_open_v2", "true");
    window.localStorage.setItem("forart_infinite_canvas_show_home", "false");
    window.localStorage.setItem("forart_infinite_canvas_last_canvas_id", "canvas-1");
    const config = {
      mode: "remote",
      localLibraryPath: "",
      serverUrl: "http://127.0.0.1:9",
      serverAuthUsername: "",
      serverAuthToken: "",
      imageDownloadPath: "",
      photoshopExecutablePath: "",
      language: "en-US",
    };
    Object.defineProperty(window, "forartWindow", {
      configurable: true,
      value: {
        isMaximized: async () => ({ ok: true, maximized: false }),
        onMaximizedChanged: () => () => undefined,
      },
    });
    Object.defineProperty(window, "forartConfig", {
      configurable: true,
      value: {
        load: async () => config,
        save: async (nextConfig: typeof config) => ({ ok: true, config: nextConfig }),
        appInfo: async () => ({
          name: "Forart",
          repoUrl: "",
          updateUrl: "",
          currentRevision: "test",
          currentUpdatedAt: "",
        }),
        checkUpdate: async () => ({
          ok: true,
          currentRevision: "test",
          latestRevision: "test",
          currentUpdatedAt: "",
          latestUpdatedAt: "",
          updateAvailable: false,
          repoUrl: "",
        }),
        onUpdateProgress: () => () => undefined,
        serverSession: async () => ({ ok: false, status: 401 }),
      },
    });
    Object.defineProperty(window, "easyTool", {
      configurable: true,
      value: {
        listCanvases: async () => ({
          projects: [{ id: "project-1", title: "Test project", sortOrder: 1, createdAt: 1, updatedAt: 1 }],
          canvases: [{ id: "canvas-1", title: "Failure canvas", projectId: "project-1", createdAt: 1, updatedAt: 1, revision: 1, nodeCount: 1 }],
        }),
        loadCanvas: async () => ({
          id: "canvas-1",
          title: "Failure canvas",
          projectId: "project-1",
          createdAt: 1,
          updatedAt: 1,
          revision: 1,
          canvasSchemaVersion: 2,
          nodes: [{
            id: "action-fission-1",
            type: "canvasNode",
            position: { x: 40, y: 40 },
            data: { kind: "actionFission", label: "Failure action fission" },
          }],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        }),
        saveCanvas: async () => ({ ok: true }),
      },
    });
  });

  await page.goto("http://127.0.0.1:6981/");
  await expect(page.locator(".resource-library-page")).toBeVisible();
  await expect(page.locator(".resource-library-page").getByText("Unable to reach the server").first()).toBeVisible();
  const resourceLibraryStates = await page.evaluate(() => (
    (window as typeof window & { __resourceLibraryStates?: string[] }).__resourceLibraryStates || []
  ));
  expect(resourceLibraryStates).not.toContain("empty");

  await page.getByRole("tab", { name: "Action Library" }).click();
  await expect(page.locator(".action-library-page")).toBeVisible();
  await expect(page.getByText("Unable to reach the server").first()).toBeVisible();

  await page.getByRole("tab", { name: "Outfit Library" }).click();
  await expect(page.locator(".outfit-library-page")).toBeVisible();
  await expect(page.getByText("Unable to reach the server").first()).toBeVisible();

  await page.getByRole("button", { name: "Free Canvas" }).click();
  await expect(page.locator(".free-canvas-page")).toBeVisible();
  const freeCanvasLibrary = page.locator(".free-canvas-page .library-asset-picker-content");
  await expect(freeCanvasLibrary.getByText("Unable to reach the server")).toBeVisible();
  await expect(freeCanvasLibrary.locator(".library-asset-picker__filters")).toHaveCount(0);
  await expect(freeCanvasLibrary.locator(".library-asset-picker__grid")).toHaveCount(0);

  await page.getByRole("button", { name: "Infinite Canvas" }).click();
  await expect(page.getByRole("region", { name: "Infinite Canvas" })).toBeVisible();
  await page.getByRole("button", { name: "Import from library" }).click();
  const infiniteCanvasLibrary = page.locator(".infinite-canvas-page .library-asset-picker-content");
  await expect(infiniteCanvasLibrary.getByText("Unable to reach the server")).toBeVisible();
  await expect(infiniteCanvasLibrary.locator(".library-asset-picker__filters")).toHaveCount(0);
  await expect(infiniteCanvasLibrary.locator(".library-asset-picker__grid")).toHaveCount(0);
  const actionFission = page.locator(".rf-action-fission--unavailable");
  await expect(actionFission.getByText("Unable to reach the server")).toBeVisible();
  await expect(actionFission.locator(".rf-action-fission-list-card, .rf-action-fission-grid-card")).toHaveCount(0);

  await page.getByRole("button", { name: "Image Review" }).click();
  await expect(page.locator(".image-review-page")).toBeVisible();

  for (let index = 0; index < 5; index += 1) {
    await page.getByRole("button", { name: "Asset Library" }).click();
    await expect(page.locator(".resource-library-page")).toBeVisible();
    await page.getByRole("button", { name: "Free Canvas" }).click();
    await expect(page.locator(".free-canvas-page")).toBeVisible();
    await page.getByRole("button", { name: "Infinite Canvas" }).click();
    await expect(page.getByRole("region", { name: "Infinite Canvas" })).toBeVisible();
  }
  expect(pageErrors).toEqual([]);
});

test("does not throw while resolving a stored relative asset against a malformed server address", async ({ page }) => {
  await page.goto("http://127.0.0.1:6981/");
  const result = await page.evaluate(async () => {
    const runtime = await import("/renderer/src/data-source/runtime.ts");
    const imageActions = await import("/renderer/src/lib/libraryImageActions.ts");
    runtime.setActiveForartConfig({
      mode: "remote",
      localLibraryPath: "",
      serverUrl: "http://127.0.0.1:69809",
      serverAuthUsername: "",
      serverAuthToken: "",
      imageDownloadPath: "",
      photoshopExecutablePath: "",
      language: "en-US",
    });
    return imageActions.resolveLibraryImageUrl("/api/assets/stored-action/file");
  });

  expect(result).toBe("/api/assets/stored-action/file");
});

test("keeps mounted pages rendered after switching from a healthy server to an unreachable address", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/**", async (route) => {
    if (route.request().url().startsWith("http://127.0.0.1:6981/")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ configured: true, projects: [], tags: [], models: [], actions: [], outfits: [] }),
      });
      return;
    }
    await route.continue();
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("forart_sidebar_open_v2", "true");
    let config = {
      mode: "remote",
      localLibraryPath: "",
      serverUrl: "http://127.0.0.1:6981",
      serverAuthUsername: "",
      serverAuthToken: "",
      imageDownloadPath: "",
      photoshopExecutablePath: "",
      language: "en-US",
    };
    Object.defineProperty(window, "forartWindow", {
      configurable: true,
      value: {
        isMaximized: async () => ({ ok: true, maximized: false }),
        onMaximizedChanged: () => () => undefined,
      },
    });
    Object.defineProperty(window, "forartConfig", {
      configurable: true,
      value: {
        load: async () => config,
        save: async (nextConfig: typeof config) => {
          config = nextConfig;
          return { ok: true, config };
        },
        defaultPaths: async () => ({ imageDownloadPath: "" }),
        testServer: async (serverUrl: string) => ({ ok: serverUrl === "http://127.0.0.1:6981" }),
        appInfo: async () => ({
          name: "Forart",
          repoUrl: "",
          updateUrl: "",
          currentRevision: "test",
          currentUpdatedAt: "",
        }),
        checkUpdate: async () => ({
          ok: true,
          currentRevision: "test",
          latestRevision: "test",
          currentUpdatedAt: "",
          latestUpdatedAt: "",
          updateAvailable: false,
          repoUrl: "",
        }),
        onUpdateProgress: () => () => undefined,
        serverSession: async () => ({ ok: false, status: 401 }),
      },
    });
  });

  await page.goto("http://127.0.0.1:6981/");
  await expect(page.locator(".resource-library-page")).toBeVisible();
  await page.getByRole("button", { name: "Free Canvas" }).click();
  await expect(page.locator(".free-canvas-page")).toBeVisible();
  await page.getByRole("button", { name: "Infinite Canvas" }).click();
  await expect(page.locator(".infinite-canvas-page")).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Expand run mode configuration" }).click();
  await page.getByLabel("Server URL").fill("http://127.0.0.1:9");
  await expect(page.getByText("Connection failed").first()).toBeVisible();

  await page.getByRole("button", { name: "Asset Library" }).click();
  await expect(page.locator(".resource-library-page")).toBeVisible();
  await expect(page.locator(".resource-library-page").getByText("Unable to reach the server").first()).toBeVisible();
  await page.getByRole("button", { name: "Free Canvas" }).click();
  await expect(page.locator(".free-canvas-page")).toBeVisible();
  await page.getByRole("button", { name: "Infinite Canvas" }).click();
  await expect(page.locator(".infinite-canvas-page")).toBeVisible();
  expect(pageErrors).toEqual([]);
});
