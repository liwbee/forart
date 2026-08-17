import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("forart_sidebar_open_v2", "true");
    window.localStorage.setItem("forart_infinite_canvas_show_home", "false");
    window.localStorage.setItem("forart_infinite_canvas_last_canvas_id", "canvas-1");
    (window as typeof window & { __canvasSaves: unknown[] }).__canvasSaves = [];

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
          canvases: [{
            id: "canvas-1",
            title: "Test canvas",
            projectId: "project-1",
            createdAt: 1,
            updatedAt: 1,
            revision: 1,
            nodeCount: 1,
          }],
        }),
        loadCanvas: async () => ({
          id: "canvas-1",
          title: "Test canvas",
          projectId: "project-1",
          createdAt: 1,
          updatedAt: 1,
          revision: 1,
          canvasSchemaVersion: 2,
          nodes: [{
            id: "node-a",
            type: "canvasNode",
            position: { x: 180, y: 160 },
            style: { width: 260, height: 160 },
            data: { kind: "prompt", label: "A" },
          }],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        }),
        saveCanvas: async (_canvasId: string, payload: unknown) => {
          (window as typeof window & { __canvasSaves: unknown[] }).__canvasSaves.push(payload);
          return { ok: true };
        },
        getCanvasClipboardStatus: async () => ({ hasNodes: false, hasImage: false }),
      },
    });
  });

  await page.goto("http://127.0.0.1:6981/");
  await page.getByRole("button", { name: "Infinite Canvas" }).click();
  await expect(page.locator('.react-flow__node[data-id="node-a"]')).toBeVisible();
});

test("does not autosave while dragging and saves once after the interaction settles", async ({ page }) => {
  await page.waitForTimeout(2_200);
  await page.evaluate(() => {
    (window as typeof window & { __canvasSaves: unknown[] }).__canvasSaves.length = 0;
  });

  const node = page.locator('.react-flow__node[data-id="node-a"]');
  const box = await node.boundingBox();
  expect(box).not.toBeNull();
  const start = { x: box!.x + 30, y: box!.y + 70 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(start.x + step * 12, start.y + step * 4);
    await page.waitForTimeout(300);
  }

  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { __canvasSaves: unknown[] }
  ).__canvasSaves.length)).toBe(0);

  await page.mouse.up();
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => (
    window as typeof window & { __canvasSaves: unknown[] }
  ).__canvasSaves.length)).toBe(0);
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { __canvasSaves: unknown[] }
  ).__canvasSaves.length), { timeout: 1_500 }).toBe(1);
});
