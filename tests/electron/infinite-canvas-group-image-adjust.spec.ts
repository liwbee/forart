import { expect, test } from "@playwright/test";

/**
 * 组的图像调节：组工具栏打开面板后，预览下方列出组内所有图片；
 * 组模式固定覆盖原图（没有"新建节点"），并提供"保存整组"把当前参数套用到组内每一张。
 */

test.use({ viewport: { width: 1440, height: 900 } });

const PIXEL_A = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
const PIXEL_B = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=";
// 与两张源图的缩略图都不同的红色像素：用来断言"只有这一张被覆盖"。
const ADJUSTED_PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

const GENERATOR_A = "forart-asset://canvas/output/generated-a.png";
const GENERATOR_B = "forart-asset://canvas/output/generated-b.png";
const ASSET_SOURCE = "forart-asset://canvas/input/asset-a.png";

test.beforeEach(async ({ page }) => {
  const canvasDocument = {
    canvasSchemaVersion: 5,
    id: "canvas-group-adjust",
    title: "group adjust",
    projectId: "project-1",
    canvasType: "forart",
    createdAt: 1,
    updatedAt: 1,
    revision: 1,
    nodes: [
      { id: "group-1", type: "groupNode", position: { x: 120, y: 240 }, style: { width: 760, height: 620 }, data: { kind: "group", label: "Group" } },
      {
        id: "generator",
        type: "canvasNode",
        parentId: "group-1",
        position: { x: 40, y: 90 },
        style: { width: 260, height: 200 },
        data: {
          kind: "imageGenerator",
          label: "Generator",
          generatedImages: [
            { localUrl: GENERATOR_A, thumbUrl: PIXEL_A, fileName: "generated-a.png", width: 800, height: 600 },
            { localUrl: GENERATOR_B, thumbUrl: PIXEL_B, fileName: "generated-b.png", width: 1200, height: 1200 },
          ],
        },
      },
      {
        id: "asset",
        type: "canvasNode",
        parentId: "group-1",
        position: { x: 400, y: 90 },
        style: { width: 260, height: 200 },
        data: {
          kind: "assetLoader",
          label: "Asset",
          assetUrl: ASSET_SOURCE,
          assetThumbUrl: PIXEL_A,
          assetType: "image",
          assetNaturalWidth: 1600,
          assetNaturalHeight: 900,
        },
      },
      { id: "prompt", type: "canvasNode", parentId: "group-1", position: { x: 40, y: 360 }, style: { width: 220, height: 140 }, data: { kind: "prompt", label: "Prompt", text: "hello" } },
      // 组里没有图片时入口应当禁用
      { id: "group-empty", type: "groupNode", position: { x: 1060, y: 240 }, style: { width: 420, height: 320 }, data: { kind: "group", label: "Empty group" } },
      { id: "empty-prompt", type: "canvasNode", parentId: "group-empty", position: { x: 40, y: 100 }, style: { width: 220, height: 140 }, data: { kind: "prompt", label: "Prompt", text: "empty" } },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 0.7 },
  };

  await page.addInitScript((fixture: { canvasDocument: Record<string, unknown>; adjustedPixel: string }) => {
    const { canvasDocument, adjustedPixel } = fixture;
    window.localStorage.setItem("forart_sidebar_open_v2", "true");
    window.localStorage.setItem("forart_infinite_canvas_show_home", "false");
    window.localStorage.setItem("forart_infinite_canvas_last_canvas_id", String(canvasDocument.id));
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
        loadInfiniteCanvasSettings: async () => ({
          connectionsVisible: true,
          minimapOpen: false,
          snapToGrid: false,
          promptEditorsExpanded: false,
          referenceComparisonViewer: { referenceComparisonEnabled: false, referencePanelPercent: 50 },
        }),
        saveInfiniteCanvasSettings: async () => ({ ok: true }),
        appInfo: async () => ({ name: "Forart", repoUrl: "", updateUrl: "", currentRevision: "test", currentUpdatedAt: "" }),
        checkUpdate: async () => ({
          ok: true, currentRevision: "test", latestRevision: "test", currentUpdatedAt: "",
          latestUpdatedAt: "", updateAvailable: false, repoUrl: "",
        }),
        onUpdateProgress: () => () => undefined,
        serverSession: async () => ({ ok: false, status: 401 }),
      },
    });
    let imagePresets = { version: 1, order: [] as string[], items: {} as Record<string, unknown> };
    Object.defineProperty(window, "forartImagePresets", {
      configurable: true,
      value: {
        load: async () => imagePresets,
        save: async (payload: typeof imagePresets) => {
          imagePresets = payload;
          return payload;
        },
      },
    });
    Object.defineProperty(window, "forartGenerationTasks", {
      configurable: true,
      value: { get: async () => null, list: async () => ({ tasks: [] }), onChanged: () => () => undefined },
    });
    Object.defineProperty(window, "easyTool", {
      configurable: true,
      value: {
        listCanvases: async () => ({
          projects: [{ id: "project-1", title: "Test project", sortOrder: 1, createdAt: 1, updatedAt: 1 }],
          canvases: [{ id: canvasDocument.id, title: "group adjust", projectId: "project-1", createdAt: 1, updatedAt: 1, revision: 1, nodeCount: 6 }],
        }),
        loadCanvas: async () => canvasDocument,
        saveCanvas: async () => ({ ok: true }),
        getCanvasClipboardStatus: async () => ({ hasNodes: false, hasImage: false }),
        ensureCanvasAssetThumbnail: async () => ({ thumbUrl: "" }),
        adjustCanvasAsset: async (payload: { url?: string }) => {
          const calls = JSON.parse(document.documentElement.dataset.adjustCalls || "[]");
          calls.push(payload);
          document.documentElement.dataset.adjustCalls = JSON.stringify(calls);
          return { url: payload.url || "", thumbUrl: adjustedPixel, fileName: "adjusted.png", width: 800, height: 600 };
        },
      },
    });
  }, { canvasDocument, adjustedPixel: ADJUSTED_PIXEL });

  await page.goto("http://127.0.0.1:6981/");
  await page.getByRole("button", { name: "Infinite Canvas" }).click();
});

async function adjustCalls(page: import("@playwright/test").Page) {
  return JSON.parse(String(await page.locator("html").getAttribute("data-adjust-calls") || "[]")) as Array<{
    url?: string;
    adjustments?: { contrast?: number };
  }>;
}

/** 打开组图像调节面板：点击组标题选中组，再点工具栏入口。 */
async function openGroupAdjust(page: import("@playwright/test").Page) {
  const group = page.locator('.react-flow__node[data-id="group-1"]');
  await expect(group).toBeVisible();
  await group.locator(".rf-native-node-caption").click();
  const groupToolbar = page.locator(".rf-native-group-toolbar");
  await expect(groupToolbar).toBeVisible();
  await groupToolbar.getByRole("button", { name: "Adjust images" }).click();
  const dialog = page.getByRole("dialog", { name: "Image adjustments" });
  await expect(dialog).toBeVisible();
  return { group, groupToolbar, dialog };
}

/** 把对比度推到 110%：10 步 × 0.01。 */
async function bumpContrast(page: import("@playwright/test").Page, dialog: ReturnType<import("@playwright/test").Page["getByRole"]>) {
  await dialog.getByRole("tab", { name: "Adjust" }).click();
  const slider = dialog.getByRole("slider", { name: "Contrast" });
  await slider.focus();
  for (let index = 0; index < 10; index += 1) await page.keyboard.press("ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuenow", "1.1");
  return slider;
}

test("saves only the active image and closes the panel", async ({ page }) => {
  const { group, groupToolbar, dialog } = await openGroupAdjust(page);

  // 轨道按画布上的顺序列出三张图：生成节点两张 + 素材节点一张（没有图的提示词节点不算）。
  const rail = dialog.getByRole("list", { name: "Images in group" });
  await expect(rail.getByRole("listitem")).toHaveCount(3);
  await expect(rail.getByRole("listitem").nth(0)).toContainText("Generator · 1");
  await expect(rail.getByRole("listitem").nth(1)).toContainText("Generator · 2");
  await expect(rail.getByRole("listitem").nth(2)).toContainText("Asset");
  await expect(dialog.locator(".rf-image-adjust__target.is-active")).toHaveCount(1);

  // 默认停在第一张：分辨率文案跟着切换变化。
  await expect(dialog).toContainText("800 × 600");
  await rail.getByRole("listitem").nth(1).getByRole("button").click();
  await expect(dialog).toContainText("1200 × 1200");

  const slider = await bumpContrast(page, dialog);
  // 每张图各自的参数：切到别的图是默认值，切回来保留刚调过的 110%。
  await rail.getByRole("listitem").nth(2).getByRole("button").click();
  await expect(slider).toHaveAttribute("aria-valuenow", "1");
  await rail.getByRole("listitem").nth(1).getByRole("button").click();
  await expect(slider).toHaveAttribute("aria-valuenow", "1.1");

  // 保存只覆盖当前这张，组模式下没有"新建节点"分支，保存后关窗。
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(async () => (await adjustCalls(page)).length).toBe(1);
  expect((await adjustCalls(page)).map((call) => call.url)).toEqual([GENERATOR_B]);
  await expect(page.getByRole("menuitem", { name: "Create new node" })).toHaveCount(0);
  await expect(dialog).toHaveCount(0);

  // 重新打开：只有被调的那一张换了缩略图，另外两张不变（覆盖按序号精确写回）。
  await group.locator(".rf-native-node-caption").click();
  await groupToolbar.getByRole("button", { name: "Adjust images" }).click();
  const reopened = page.getByRole("dialog", { name: "Image adjustments" });
  const thumbs = reopened.getByRole("list", { name: "Images in group" }).getByRole("listitem").locator("img");
  await expect.poll(async () => thumbs.nth(1).getAttribute("src")).toBe(ADJUSTED_PIXEL);
  await expect(thumbs.nth(0)).toHaveAttribute("src", PIXEL_A);
  await expect(thumbs.nth(2)).toHaveAttribute("src", PIXEL_A);
});

test("applies the current settings to the rest of the group and saves them", async ({ page }) => {
  const { dialog } = await openGroupAdjust(page);
  const rail = dialog.getByRole("list", { name: "Images in group" });
  const slider = await bumpContrast(page, dialog);

  // 应用整组：把当前参数复制给其它图片，此时不写盘。
  await dialog.getByRole("button", { name: "Apply to whole group", exact: true }).click();
  await expect(page.getByText("Settings applied to the rest of the group")).toBeVisible();
  expect(await adjustCalls(page)).toEqual([]);
  await rail.getByRole("listitem").nth(2).getByRole("button").click();
  await expect(slider).toHaveAttribute("aria-valuenow", "1.1");

  // 保存整组：每张按各自的参数覆盖原图，完成后关窗。
  await dialog.getByRole("button", { name: "Save whole group", exact: true }).click();
  await expect.poll(async () => (await adjustCalls(page)).length).toBe(3);
  expect((await adjustCalls(page)).map((call) => call.url)).toEqual([GENERATOR_A, GENERATOR_B, ASSET_SOURCE]);
  expect((await adjustCalls(page)).every((call) => call.adjustments?.contrast === 1.1)).toBe(true);
  await expect(page.getByText("Saved 3 images in the group")).toBeVisible();
  await expect(dialog).toHaveCount(0);
});

test("disables the group image adjust entry when the group has no images", async ({ page }) => {
  const emptyGroup = page.locator('.react-flow__node[data-id="group-empty"]');
  await expect(emptyGroup).toBeVisible();
  await emptyGroup.locator(".rf-native-node-caption").click();

  const groupToolbar = page.locator(".rf-native-group-toolbar");
  await expect(groupToolbar).toBeVisible();
  const button = groupToolbar.getByRole("button", { name: "Adjust images" });
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute("title", "No adjustable images in this group");
});
