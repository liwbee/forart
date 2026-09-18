import { expect, test } from "@playwright/test";

/**
 * 组的两条行为：
 * - 组提供输出端点，连到图片生成节点后，组内所有图片都成为它的参考图；
 * - 组里没有节点时，组本身自动消失。
 */

test.use({ viewport: { width: 1440, height: 900 } });

const PIXEL_A = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
const PIXEL_B = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=";

test.beforeEach(async ({ page }) => {
  const canvasDocument = {
    canvasSchemaVersion: 5,
    id: "canvas-group-output",
    title: "group output",
    projectId: "project-1",
    canvasType: "forart",
    createdAt: 1,
    updatedAt: 1,
    revision: 1,
    nodes: [
      { id: "group-1", type: "groupNode", position: { x: 120, y: 260 }, style: { width: 620, height: 560 }, data: { kind: "group", label: "Group" } },
      {
        id: "in-group-generator",
        type: "canvasNode",
        parentId: "group-1",
        position: { x: 40, y: 90 },
        style: { width: 220, height: 170 },
        data: { kind: "imageGenerator", label: "gen-a", generatedImages: [{ localUrl: PIXEL_A, thumbUrl: PIXEL_A, width: 4, height: 3 }] },
      },
      {
        id: "in-group-asset",
        type: "canvasNode",
        parentId: "group-1",
        position: { x: 40, y: 340 },
        style: { width: 220, height: 170 },
        data: { kind: "assetLoader", label: "asset-a", assetUrl: PIXEL_B, assetThumbUrl: PIXEL_B, assetType: "image", assetNaturalWidth: 4, assetNaturalHeight: 3 },
      },
      {
        id: "target",
        type: "canvasNode",
        position: { x: 900, y: 320 },
        style: { width: 320, height: 360 },
        data: { kind: "imageGenerator", label: "Target", imageProviderId: "provider-1", imageModel: "test-image-model" },
      },
      // 载入时就没有子节点的组：应当自动消失
      { id: "group-empty", type: "groupNode", position: { x: 120, y: 880 }, style: { width: 420, height: 320 }, data: { kind: "group", label: "Empty group" } },
    ],
    edges: [
      { id: "group-to-target", source: "group-1", sourceHandle: "output", target: "target", targetHandle: "input", data: { inputKind: "referenceImage", referenceOrder: 1 } },
    ],
    viewport: { x: 0, y: 0, zoom: 0.7 },
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
        loadApiSettings: async () => ({
          providers: [{
            id: "provider-1",
            name: "Test provider",
            baseUrl: "https://example.invalid/v1",
            apiKey: "test-key",
            imageModels: ["test-image-model"],
            chatModels: [],
            videoModels: [],
            modelAliases: { image: {}, chat: {}, video: {} },
            modelRules: { image: {} },
          }],
          defaultImageProviderId: "provider-1",
          providerOrder: ["provider-1"],
        }),
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
    Object.defineProperty(window, "easyTool", {
      configurable: true,
      value: {
        listCanvases: async () => ({
          projects: [{ id: "project-1", title: "Test project", sortOrder: 1, createdAt: 1, updatedAt: 1 }],
          canvases: [{ id: documentFixture.id, title: "group output", projectId: "project-1", createdAt: 1, updatedAt: 1, revision: 1, nodeCount: 5 }],
        }),
        loadCanvas: async () => documentFixture,
        saveCanvas: async () => ({ ok: true }),
        getCanvasClipboardStatus: async () => ({ hasNodes: false, hasImage: false }),
        ensureCanvasAssetThumbnail: async () => ({ thumbUrl: "" }),
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

test("a group connected to an image generator feeds all of its images as references", async ({ page }) => {
  // 组自带输出端点，才能拖到图片生成节点上
  await expect(page.locator('.react-flow__node[data-id="group-1"] .react-flow__handle.source')).toHaveCount(1);
  await expect(page.locator('.react-flow__edge[data-id="group-to-target"]')).toHaveCount(1);

  const target = page.locator('.react-flow__node[data-id="target"]');
  await target.locator(".rf-native-node-caption").click();

  const references = page.locator(".rf-reference-item");
  await expect(references).toHaveCount(2);
  await expect(references.nth(0)).toHaveAttribute("title", "gen-a");
  await expect(references.nth(1)).toHaveAttribute("title", "asset-a");
  // 组派生的参考在左上角有组图标，删除按钮的语义是"断开整组"
  await expect(references.locator(".rf-reference-item__group")).toHaveCount(2);
  await expect(page.locator(".rf-reference-item__group")).toHaveCount(2);
  await expect(page.locator(".rf-reference-item__remove")).toHaveCount(2);
  await expect(references.first().getByRole("button", { name: "Remove group references (disconnect the group)" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Remove reference image" })).toHaveCount(0);

  // 但可以拖动排序：把第二张（asset-a）拖到最前
  const [firstBox, secondBox] = await Promise.all([references.nth(0).boundingBox(), references.nth(1).boundingBox()]);
  if (!firstBox || !secondBox) throw new Error("Reference bounds unavailable before drag");
  await page.mouse.move(secondBox.x + secondBox.width / 2, secondBox.y + secondBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => references.evaluateAll((elements) => elements.map((element) => element.getAttribute("title"))))
    .toEqual(["asset-a", "gen-a"]);

  // 顺序写在这条连线上：切走再选回来仍然是新顺序（不是只存在界面上的临时顺序）
  await page.locator('.react-flow__node[data-id="in-group-asset"] .rf-native-node-caption').click();
  await target.locator(".rf-native-node-caption").click();
  await expect.poll(async () => references.evaluateAll((elements) => elements.map((element) => element.getAttribute("title"))))
    .toEqual(["asset-a", "gen-a"]);

  // 删除任意一条 = 断开整个组：两条组参考一起消失，连线也没了
  await references.nth(1).locator(".rf-reference-item__remove").click();
  await expect(page.locator(".rf-reference-item")).toHaveCount(0);
  await expect(page.locator('.react-flow__edge[data-id="group-to-target"]')).toHaveCount(0);
  await expect(page.locator('.react-flow__node[data-id="group-1"]')).toHaveCount(1);
});

test("drops a group as soon as it has no nodes left", async ({ page }) => {
  // 载入时就没有成员的组直接消失
  await expect(page.locator('.react-flow__node[data-id="group-empty"]')).toHaveCount(0);

  const group = page.locator('.react-flow__node[data-id="group-1"]');
  await expect(group).toBeVisible();

  // 删掉组里最后一个节点，组跟着消失
  await page.locator('.react-flow__node[data-id="in-group-asset"] .rf-native-node-caption').click();
  const toolbar = page.locator(".rf-native-node-toolbar");
  await toolbar.getByRole("button", { name: "Delete" }).click();
  await expect(page.locator('.react-flow__node[data-id="in-group-asset"]')).toHaveCount(0);

  await page.locator('.react-flow__node[data-id="in-group-generator"] .rf-native-node-caption').click();
  await page.locator(".rf-native-node-toolbar").getByRole("button", { name: "Delete" }).click();
  await expect(page.locator('.react-flow__node[data-id="in-group-generator"]')).toHaveCount(0);
  await expect(group).toHaveCount(0);
  // 连到组的边也一起清掉
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);

  // 空组清理不额外记历史：撤销时组跟着最后一个子节点一起回来
  await page.keyboard.press("Control+z");
  await expect(page.locator('.react-flow__node[data-id="in-group-generator"]')).toHaveCount(1);
  await expect(group).toHaveCount(1);
});
