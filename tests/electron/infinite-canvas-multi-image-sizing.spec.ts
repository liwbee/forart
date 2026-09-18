import { expect, test } from "@playwright/test";

/**
 * 多图生成结果节点的尺寸/位置规则：
 * - 展开网格后点下载（或任何 generatedImages 补丁）不再把节点平移（以前按展开尺寸回正中心）；
 * - 结果尺寸变化时只更新尺寸，位置保持不动。
 */

test.use({ viewport: { width: 1280, height: 800 } });

const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

test.beforeEach(async ({ page }) => {
  const canvasDocument = {
    canvasSchemaVersion: 5,
    id: "canvas-multi-sizing",
    title: "multi sizing",
    projectId: "project-1",
    canvasType: "forart",
    createdAt: 1,
    updatedAt: 1,
    revision: 1,
    nodes: [{
      id: "gen",
      type: "canvasNode",
      position: { x: 300, y: 300 },
      style: { width: 300, height: 200 },
      data: {
        kind: "imageGenerator",
        label: "G",
        generatedImages: [1, 2, 3].map((index) => ({
          localUrl: PIXEL,
          thumbUrl: PIXEL,
          width: 800,
          height: 600,
          fileName: `image-${index}.png`,
        })),
      },
    }],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  await page.addInitScript((documentFixture: Record<string, unknown>) => {
    window.localStorage.setItem("forart_sidebar_open_v2", "true");
    window.localStorage.setItem("forart_infinite_canvas_show_home", "false");
    window.localStorage.setItem("forart_infinite_canvas_last_canvas_id", String(documentFixture.id));
    const config = {
      mode: "local", localLibraryPath: "", serverUrl: "", serverAuthUsername: "", serverAuthToken: "",
      fileDownloadPath: "", photoshopExecutablePath: "", language: "en-US",
    };
    Object.defineProperty(window, "forartWindow", {
      configurable: true,
      value: { isMaximized: async () => ({ ok: true, maximized: false }), onMaximizedChanged: () => () => undefined },
    });
    Object.defineProperty(window, "forartConfig", {
      configurable: true,
      value: {
        load: async () => config,
        save: async (next: unknown) => ({ ok: true, config: next }),
        appInfo: async () => ({ name: "Forart", repoUrl: "", updateUrl: "", currentRevision: "test", currentUpdatedAt: "" }),
        checkUpdate: async () => ({
          ok: true, currentRevision: "test", latestRevision: "test", currentUpdatedAt: "",
          latestUpdatedAt: "", updateAvailable: false, repoUrl: "",
        }),
        onUpdateProgress: () => () => undefined,
        serverSession: async () => ({ ok: false, status: 401 }),
      },
    });
    Object.defineProperty(window, "easyTool", {
      configurable: true,
      value: {
        listCanvases: async () => ({
          projects: [{ id: "project-1", title: "P", sortOrder: 1, createdAt: 1, updatedAt: 1 }],
          canvases: [{ id: documentFixture.id, title: "multi sizing", projectId: "project-1", createdAt: 1, updatedAt: 1, revision: 1, nodeCount: 1 }],
        }),
        loadCanvas: async () => documentFixture,
        saveCanvas: async () => ({ ok: true }),
        getCanvasClipboardStatus: async () => ({ hasNodes: false, hasImage: false }),
        ensureCanvasAssetThumbnail: async () => ({ thumbUrl: "" }),
        saveResult: async () => ({ canceled: false, filePath: "C:\\tmp\\result.png" }),
      },
    });
    Object.defineProperty(window, "forartGenerationTasks", {
      configurable: true,
      value: { get: async () => null, list: async () => ({ tasks: [] }), onChanged: () => () => undefined },
    });
  }, canvasDocument);

  await page.goto("http://127.0.0.1:6981/");
  await page.getByRole("button", { name: "Infinite Canvas" }).click();
});

async function readNode(page: import("@playwright/test").Page) {
  return page.locator('.react-flow__node[data-id="gen"]').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      transform: (element as HTMLElement).style.transform,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  });
}

test("downloading a result inside the expanded grid does not move the node", async ({ page }) => {
  const node = page.locator('.react-flow__node[data-id="gen"]');
  await expect(node).toBeVisible();
  const initial = await readNode(page);

  await node.locator(".rf-native-generated-count").click();
  await expect.poll(async () => (await readNode(page)).width).toBeGreaterThan(initial.width);
  const expanded = await readNode(page);
  expect(expanded.transform).toBe(initial.transform);

  // 展开态点第一张结果的下载：数据补丁会更新 generatedImages
  const firstTile = node.locator(".rf-native-generated-tile").first();
  await firstTile.hover();
  const downloadButton = firstTile.getByRole("button", { name: "Download image" });
  await expect(downloadButton).toHaveClass(/is-pending/);
  await downloadButton.click();
  // 下载完成后 downloadState 落回节点数据（这一步就是以前会把节点平移的补丁）
  await expect(downloadButton).not.toHaveClass(/is-pending/);

  // 展开态下位置和尺寸都必须保持原样（以前会按展开尺寸把中心回正，节点被平移、网格被挤扁）
  const afterDownload = await readNode(page);
  expect(afterDownload.transform).toBe(initial.transform);
  expect(afterDownload.width).toBe(expanded.width);
  expect(afterDownload.height).toBe(expanded.height);

  // 折叠回来：尺寸回到展开前的大小，位置依然不动
  await page.mouse.click(1150, 740);
  await expect.poll(async () => (await readNode(page)).width).toBe(initial.width);
  const afterCycle = await readNode(page);
  expect(afterCycle.transform).toBe(initial.transform);
  expect(afterCycle.height).toBe(initial.height);
});
