import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("forart_sidebar_open_v2", "true");
    window.localStorage.setItem("forart_infinite_canvas_show_home", "false");
    window.localStorage.setItem("forart_infinite_canvas_last_canvas_id", "canvas-group-detach");

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
        appInfo: async () => ({ name: "Forart", repoUrl: "", updateUrl: "", currentRevision: "test", currentUpdatedAt: "" }),
        checkUpdate: async () => ({ ok: true, currentRevision: "test", latestRevision: "test", currentUpdatedAt: "", latestUpdatedAt: "", updateAvailable: false, repoUrl: "" }),
        onUpdateProgress: () => () => undefined,
        serverSession: async () => ({ ok: false, status: 401 }),
      },
    });
    Object.defineProperty(window, "easyTool", {
      configurable: true,
      value: {
        listCanvases: async () => ({
          projects: [{ id: "project-1", title: "Test project", sortOrder: 1, createdAt: 1, updatedAt: 1 }],
          canvases: [{ id: "canvas-group-detach", title: "Group detach", projectId: "project-1", createdAt: 1, updatedAt: 1, revision: 1, nodeCount: 3 }],
        }),
        loadCanvas: async () => ({
          id: "canvas-group-detach",
          title: "Group detach",
          projectId: "project-1",
          createdAt: 1,
          updatedAt: 1,
          revision: 1,
          canvasSchemaVersion: 2,
          nodes: [
            { id: "group-1", type: "groupNode", position: { x: 180, y: 120 }, style: { width: 520, height: 380 }, data: { kind: "group", label: "Group" } },
            { id: "child-stays", type: "canvasNode", parentId: "group-1", position: { x: 50, y: 70 }, style: { width: 160, height: 110 }, data: { kind: "prompt", label: "Stays" } },
            { id: "child-detaches", type: "canvasNode", parentId: "group-1", position: { x: 280, y: 190 }, style: { width: 160, height: 110 }, data: { kind: "prompt", label: "Detaches" } },
          ],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        }),
        saveCanvas: async () => ({ ok: true }),
        getCanvasClipboardStatus: async () => ({ hasNodes: false, hasImage: false }),
      },
    });
  });

  await page.goto("http://127.0.0.1:6981/");
  await page.getByRole("button", { name: "Infinite Canvas" }).click();
});

test("marquee selecting a group excludes a node dragged out of that group", async ({ page }) => {
  const group = page.locator('.react-flow__node[data-id="group-1"]');
  const detached = page.locator('.react-flow__node[data-id="child-detaches"]');
  await expect(group).toBeVisible();
  await expect(detached).toBeVisible();

  const detachedBox = await detached.boundingBox();
  const groupBox = await group.boundingBox();
  expect(detachedBox).not.toBeNull();
  expect(groupBox).not.toBeNull();
  await page.mouse.move(detachedBox!.x + detachedBox!.width / 2, detachedBox!.y + 16);
  await page.mouse.down();
  await page.mouse.move(groupBox!.x + groupBox!.width + 280, groupBox!.y + groupBox!.height / 2, { steps: 12 });
  await page.mouse.up();

  const movedBox = await detached.boundingBox();
  expect(movedBox).not.toBeNull();
  expect(movedBox!.x).toBeGreaterThan(groupBox!.x + groupBox!.width + 100);

  await page.mouse.move(groupBox!.x - 20, groupBox!.y - 35);
  await page.mouse.down();
  await page.mouse.move(groupBox!.x + groupBox!.width + 20, groupBox!.y + groupBox!.height + 20, { steps: 12 });
  await page.mouse.up();

  await expect(page.locator('.react-flow__node[data-id="child-stays"]')).toHaveClass(/selected/);
  await expect(detached).not.toHaveClass(/selected/);
});
