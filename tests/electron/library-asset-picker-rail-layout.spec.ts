import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });

const LIBRARY_TEST_CANVAS = {
  id: "canvas-1",
  title: "Test canvas",
  projectId: "project-1",
  createdAt: 1,
  updatedAt: 1,
  revision: 1,
  canvasSchemaVersion: 2,
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
};

async function installLibraryTestEnvironment(page: import("@playwright/test").Page, outfits: number) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/outfit-projects/project-1/outfits") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          outfits: Array.from({ length: outfits }, (_, index) => ({
            id: `outfit-${index}`,
            name: `Outfit ${index}`,
            asset_id: `asset-${index}`,
            asset_url: `http://127.0.0.1:6981/test-assets/outfit-${index}.svg`,
            thumbnail_url: `http://127.0.0.1:6981/test-assets/outfit-${index}.svg`,
            tags: [],
            updated_at: "1",
          })),
        }),
      });
      return;
    }

    const projects = url.pathname.endsWith("-projects")
      ? [{ id: "project-1", name: "Project 1", sort_order: 1 }]
      : [];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ configured: true, projects, tags: [], models: [], actions: [], outfits: [] }),
    });
  });
  await page.route("**/test-assets/*.svg*", (route) => route.fulfill({
    status: 200,
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#ddd"/></svg>',
  }));
  await page.addInitScript((canvasDocument: Record<string, unknown>) => {
    window.localStorage.setItem("forart_sidebar_open_v2", "true");
    window.localStorage.setItem("forart_infinite_canvas_show_home", "false");
    window.localStorage.setItem("forart_infinite_canvas_last_canvas_id", String(canvasDocument.id));
    const config = {
      mode: "remote",
      localLibraryPath: "",
      serverUrl: "http://127.0.0.1:6981",
      serverAuthUsername: "",
      serverAuthToken: "",
      fileDownloadPath: "",
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
        appInfo: async () => ({ name: "Forart", repoUrl: "", updateUrl: "", currentRevision: "test", currentUpdatedAt: "" }),
        checkUpdate: async () => ({ ok: true, currentRevision: "test", latestRevision: "test", currentUpdatedAt: "", latestUpdatedAt: "", updateAvailable: false, repoUrl: "" }),
        onUpdateProgress: () => () => undefined,
        serverSession: async () => ({ ok: true, authenticated: true }),
      },
    });
    Object.defineProperty(window, "easyTool", {
      configurable: true,
      value: {
        listCanvases: async () => ({
          projects: [{ id: "project-1", title: "Test project", sortOrder: 1, createdAt: 1, updatedAt: 1 }],
          canvases: [{ id: canvasDocument.id, title: "Test canvas", projectId: "project-1", createdAt: 1, updatedAt: 1, revision: 1, nodeCount: 0 }],
        }),
        loadCanvas: async () => canvasDocument,
        saveCanvas: async () => ({ ok: true }),
        getCanvasClipboardStatus: async () => ({ hasNodes: false, hasImage: false }),
      },
    });
  }, LIBRARY_TEST_CANVAS);
}

test("keeps a newly imported library node above nodes that were dragged to the front", async ({ page }) => {
  await installLibraryTestEnvironment(page, 2);
  await page.goto("http://127.0.0.1:6981/");
  await page.getByRole("button", { name: "Infinite Canvas" }).click();

  const picker = page.locator(".rf-native-library");
  const imported = page.locator('.react-flow__node[data-id^="assetLoader_"]');

  await page.getByRole("button", { name: "Import from library" }).click();
  await picker.locator(".library-asset-picker__grid button").first().click();
  await expect(imported).toHaveCount(1);
  expect(await imported.first().evaluate((element) => getComputedStyle(element).zIndex)).toBe("1");

  // 拖动一次刚导入的节点：画布会把它顶到最前，zIndex 变成 2。
  const firstBox = await imported.first().boundingBox();
  expect(firstBox).not.toBeNull();
  await page.mouse.move(firstBox!.x + firstBox!.width / 2, firstBox!.y + firstBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(firstBox!.x + firstBox!.width / 2 + 60, firstBox!.y + firstBox!.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => imported.first().evaluate((element) => getComputedStyle(element).zIndex)).toBe("2");

  // 再导入一次：面板选完素材后保持打开，直接选下一个即可。
  // 新节点要落在刚才被拖到最前的那个节点之上。
  await picker.locator(".library-asset-picker__grid button").nth(1).click();
  await expect(imported).toHaveCount(2);

  const latest = imported.nth(1);
  expect(await latest.evaluate((element) => getComputedStyle(element).zIndex)).toBe("3");
  const latestBox = await latest.boundingBox();
  expect(latestBox).not.toBeNull();
  const topmostNodeId = await page.evaluate(({ x, y }) => (
    document.elementFromPoint(x, y)?.closest<HTMLElement>(".react-flow__node")?.dataset.id || ""
  ), { x: latestBox!.x + latestBox!.width / 2, y: latestBox!.y + latestBox!.height / 2 });
  expect(topmostNodeId).toBe(await latest.getAttribute("data-id"));
});

test("keeps the third asset column and vertical scrollbar inside the visible rail", async ({ page }) => {
  await installLibraryTestEnvironment(page, 30);

  await page.goto("http://127.0.0.1:6981/");
  await page.getByRole("button", { name: "Infinite Canvas" }).click();
  await page.getByRole("button", { name: "Import from library" }).click();

  const content = page.locator(".rf-native-library .library-asset-picker-content");
  const body = content.locator(".library-asset-picker__body");
  await expect(body.locator(".library-asset-picker__grid button")).toHaveCount(30);
  await body.hover();
  await expect(content.locator(".library-asset-picker__body-scrollbar")).toHaveCount(1);
  await page.waitForTimeout(200);

  const metrics = await content.evaluate((contentElement) => {
    const railElement = contentElement.closest(".library-asset-picker--rail");
    const gridElement = contentElement.querySelector(".library-asset-picker__grid");
    const viewportElement = contentElement.querySelector(".library-asset-picker__body-viewport");
    const scrollbarElement = contentElement.querySelector(".library-asset-picker__body-scrollbar");
    if (!(railElement instanceof HTMLElement)
      || !(gridElement instanceof HTMLElement)
      || !(viewportElement instanceof HTMLElement)
      || !(scrollbarElement instanceof HTMLElement)) return null;

    const contentBounds = contentElement.getBoundingClientRect();
    const railBounds = railElement.getBoundingClientRect();
    const gridBounds = gridElement.getBoundingClientRect();
    const scrollbarBounds = scrollbarElement.getBoundingClientRect();
    const contentOverflow = getComputedStyle(contentElement).overflowX;
    const visibleRight = contentOverflow === "visible" ? railBounds.right : contentBounds.right;
    return {
      contentOverflow,
      gridRight: gridBounds.right,
      scrollbarRight: scrollbarBounds.right,
      scrollbarWidth: scrollbarBounds.width,
      visibleRight,
      viewportClientHeight: viewportElement.clientHeight,
      viewportScrollHeight: viewportElement.scrollHeight,
    };
  });

  expect(metrics).not.toBeNull();
  expect(metrics!.viewportScrollHeight).toBeGreaterThan(metrics!.viewportClientHeight);
  expect(metrics!.scrollbarWidth).toBeGreaterThan(0);
  expect(metrics!.gridRight).toBeLessThanOrEqual(metrics!.visibleRight + 0.5);
  expect(metrics!.scrollbarRight).toBeLessThanOrEqual(metrics!.visibleRight + 0.5);
});
