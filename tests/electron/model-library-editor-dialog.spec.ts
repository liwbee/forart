import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({ page }) => {
  await page.route("**/test-assets/*.svg*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="3000"><rect width="2400" height="3000" fill="#ddd"/></svg>',
    });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("forart_sidebar_open_v2", "true");
    const config = {
      mode: "local",
      localLibraryPath: "",
      serverUrl: "",
      serverAuthUsername: "",
      serverAuthToken: "",
      imageDownloadPath: "",
      photoshopExecutablePath: "",
      language: "en-US",
    };
    const models = Array.from({ length: 8 }, (_, index) => ({
      id: `model-${index}`,
      name: `Model ${index}`,
      gender: index % 2 ? "male" : "female",
      tags: [],
      cover_image_id: `cover-image-${index}`,
      cover_asset_id: `cover-asset-${index}`,
      cover_url: `http://127.0.0.1:6981/test-assets/cover-${index}.svg`,
      cover_thumbnail_url: `http://127.0.0.1:6981/test-assets/cover-${index}.svg`,
      created_at: "1",
      updated_at: "1",
    }));
    const images = Array.from({ length: 4 }, (_, index) => ({
      id: `image-${index}`,
      model_id: "model-0",
      asset_id: `asset-${index}`,
      asset_url: `http://127.0.0.1:6981/test-assets/editor-${index}.svg`,
      thumbnail_url: `http://127.0.0.1:6981/test-assets/editor-${index}.svg`,
      filename: `editor-${index}.svg`,
      caption: `Very long model image description ${index} `.repeat(20),
      created_at: "1",
    }));

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
      },
    });
    Object.defineProperty(window, "forartLocalApi", {
      configurable: true,
      value: {
        request: async ({ path }: { path: string }) => {
          const pathname = new URL(path, "http://local").pathname;
          if (pathname === "/api/settings/storage") return { ok: true, status: 200, body: { configured: true } };
          if (pathname === "/api/model-projects") return { ok: true, status: 200, body: { projects: [{ id: "project-1", name: "Project 1", sort_order: 1 }] } };
          if (pathname === "/api/libraries/model/tags") return { ok: true, status: 200, body: { tags: [] } };
          if (pathname === "/api/model-projects/project-1/models") return { ok: true, status: 200, body: { models } };
          if (pathname === "/api/models/model-0/images") return { ok: true, status: 200, body: { images } };
          return { ok: true, status: 200, body: {} };
        },
      },
    });
  });

  await page.goto("http://127.0.0.1:6981/");
  await expect(page.locator(".model-card")).toHaveCount(8);
  const libraryToolbarRight = await page.locator(".library-card-toolbar").evaluate((element) => parseFloat(getComputedStyle(element).right));
  expect(libraryToolbarRight).toBeGreaterThanOrEqual(34);
});

test("opens model editing in a stable modal without reflowing the model grid", async ({ page }) => {
  const cards = page.locator(".model-card");
  const lastCardTopBefore = await cards.last().evaluate((element) => element.getBoundingClientRect().top);

  await cards.first().click();

  const dialog = page.locator('[data-slot="dialog-content"].model-editor-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.locator(".model-inline-editor")).toHaveCount(0);
  const lastCardTopAfter = await cards.last().evaluate((element) => element.getBoundingClientRect().top);
  expect(Math.abs(lastCardTopAfter - lastCardTopBefore)).toBeLessThanOrEqual(1);

  const editorImages = dialog.locator(".model-image-preview img");
  await expect(editorImages).toHaveCount(4);
  const pendingWidths = await editorImages.evaluateAll((images) => images.map((image) => image.getBoundingClientRect().width));
  expect(Math.max(...pendingWidths)).toBeLessThanOrEqual(320);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("uses the same subtle border for the editor dialog and its popup menu", async ({ page }) => {
  await page.locator(".model-card").first().click();
  const dialog = page.locator('[data-slot="dialog-content"].model-editor-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".model-image-preview img")).toHaveCount(4);
  await dialog.locator(".model-image-menu-button").first().click();

  const menu = page.locator('[data-slot="dropdown-menu-content"]');
  await expect(menu).toBeVisible();
  const [dialogBorder, menuBorder] = await Promise.all([
    dialog.evaluate((element) => getComputedStyle(element).borderColor),
    menu.evaluate((element) => getComputedStyle(element).borderColor),
  ]);
  expect(menuBorder).toBe(dialogBorder);
});
