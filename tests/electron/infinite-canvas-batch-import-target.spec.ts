import { expect, test } from "@playwright/test";

/**
 * 批量洗图的「传入目标」端口：只接受图片，连进来的图可以一键传成卡片。
 * - 有点击入口时按钮出现在标题栏最左，没有入边时按钮不出现；
 * - 一次传入全部目标图；已在卡片里的（同一个素材地址）跳过；超过上限自动截断。
 */

test.use({ viewport: { width: 1440, height: 900 } });

const PIXEL_A = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
const PIXEL_B = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=";

test.beforeEach(async ({ page }) => {
  const canvasDocument = {
    canvasSchemaVersion: 5,
    id: "canvas-batch-import",
    title: "batch import",
    projectId: "project-1",
    canvasType: "forart",
    createdAt: 1,
    updatedAt: 1,
    revision: 1,
    nodes: [
      {
        id: "source-asset",
        type: "canvasNode",
        position: { x: 120, y: 300 },
        style: { width: 180, height: 140 },
        data: { kind: "assetLoader", label: "source-a", assetUrl: PIXEL_A, assetThumbUrl: PIXEL_A, assetType: "image", assetNaturalWidth: 4, assetNaturalHeight: 3 },
      },
      { id: "source-group", type: "groupNode", position: { x: 120, y: 520 }, style: { width: 520, height: 420 }, data: { kind: "group", label: "Source group" } },
      {
        id: "source-extra",
        type: "canvasNode",
        position: { x: 120, y: 60 },
        style: { width: 220, height: 170 },
        data: { kind: "imageGenerator", label: "extra", generatedImages: [{ localUrl: PIXEL_B, thumbUrl: PIXEL_B, fileName: "extra.png", width: 4, height: 3 }] },
      },
      { id: "source-text", type: "canvasNode", position: { x: 620, y: 60 }, style: { width: 220, height: 140 }, data: { kind: "prompt", label: "text", text: "describe this" } },
      {
        id: "group-image-a",
        type: "canvasNode",
        parentId: "source-group",
        position: { x: 30, y: 90 },
        style: { width: 180, height: 140 },
        data: { kind: "assetLoader", label: "group-a", assetUrl: PIXEL_B, assetThumbUrl: PIXEL_B, assetType: "image", assetNaturalWidth: 4, assetNaturalHeight: 3 },
      },
      {
        id: "group-image-b",
        type: "canvasNode",
        parentId: "source-group",
        position: { x: 30, y: 260 },
        style: { width: 180, height: 140 },
        data: { kind: "assetLoader", label: "group-b", assetUrl: PIXEL_A, assetThumbUrl: PIXEL_A, assetType: "image", assetNaturalWidth: 4, assetNaturalHeight: 3 },
      },
      {
        id: "batch",
        type: "canvasNode",
        position: { x: 900, y: 300 },
        style: { width: 900, height: 600 },
        data: {
          kind: "batchImageGenerator",
          label: "Batch",
          text: "prompt",
          imageProviderId: "provider-1",
          imageModel: "test-image-model",
          batchImageGenerator: { prompt: "prompt", items: [] },
        },
      },
      // 没有连接目标的批量节点：按钮不出现
      {
        id: "batch-plain",
        type: "canvasNode",
        position: { x: 900, y: 950 },
        style: { width: 900, height: 600 },
        data: { kind: "batchImageGenerator", label: "Plain batch", text: "prompt", batchImageGenerator: { prompt: "prompt", items: [] } },
      },
    ],
    edges: [
      { id: "import-from-asset", source: "source-asset", sourceHandle: "output", target: "batch", targetHandle: "batch-import-target", data: { inputKind: "batchTargetImage", referenceOrder: 1 } },
      { id: "import-from-group", source: "source-group", sourceHandle: "output", target: "batch", targetHandle: "batch-import-target", data: { inputKind: "batchTargetImage", referenceOrder: 2 } },
    ],
    viewport: { x: 0, y: 0, zoom: 0.55 },
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
          canvases: [{ id: documentFixture.id, title: "batch import", projectId: "project-1", createdAt: 1, updatedAt: 1, revision: 1, nodeCount: 6 }],
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

test("imports every image connected to the import-target port", async ({ page }) => {
  const batch = page.locator('.react-flow__node[data-id="batch"]');
  await expect(batch).toBeVisible();

  // 端口本身存在，且只有批量洗图有
  await expect(batch.locator('.react-flow__handle[data-handleid="batch-import-target"]')).toHaveCount(1);
  await expect(page.locator('.react-flow__node[data-id="batch-plain"] .react-flow__handle[data-handleid="batch-import-target"]')).toHaveCount(1);

  // 没有入边的批量节点不显示按钮
  const plain = page.locator('.react-flow__node[data-id="batch-plain"]');
  await expect(plain.getByRole("button", { name: "Import targets" })).toHaveCount(0);

  // 有入边：标题栏最左出现按钮，一次把三条（素材 1 张 + 组内 2 张）传成卡片
  const importButton = batch.getByRole("button", { name: "Import targets" });
  await expect(importButton).toBeVisible();
  await importButton.click();

  const cards = batch.locator(".rf-action-fission-grid-card");
  await expect(cards).toHaveCount(3);
  await expect(batch).toContainText("source-a");
  await expect(batch).toContainText("group-a");
  await expect(batch).toContainText("group-b");

  // 再点一次：同一批图已经在卡片里，全部跳过，不会翻倍
  await importButton.click();
  await expect(cards).toHaveCount(3);
});

test("one image can feed several handles of the same batch node, but not the same handle twice", async ({ page }) => {
  const batch = page.locator('.react-flow__node[data-id="batch"]');
  const sourceHandle = page.locator('.react-flow__node[data-id="source-extra"] .react-flow__handle.source');
  // 画布加载后会做一次适应视图：等端口坐标稳定后再拖，否则拿到的坐标已经过期。
  await expect.poll(async () => {
    const first = await sourceHandle.boundingBox();
    await page.waitForTimeout(60);
    const second = await sourceHandle.boundingBox();
    return Boolean(first && second)
      && Math.abs(first.x - second.x) < 0.5
      && Math.abs(first.y - second.y) < 0.5;
  }, { timeout: 10_000 }).toBe(true);

  const dragToHandle = async (handleId: string) => {
    const from = await sourceHandle.boundingBox();
    const to = await batch.locator(`.react-flow__handle[data-handleid="${handleId}"]`).boundingBox();
    if (!from || !to) throw new Error("Handle bounds unavailable");
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 20 });
    // 最后再抖一下，确保 React Flow 已经把落点认成这个端口
    await page.mouse.move(to.x + to.width / 2 + 1, to.y + to.height / 2 + 1, { steps: 2 });
    await page.mouse.up();
  };

  // 先连主参考
  await dragToHandle("input");
  await expect(page.locator(".react-flow__edge")).toHaveCount(3);
  // 同一个来源再连「传入目标」：允许（不同端口）
  await dragToHandle("batch-import-target");
  await expect(page.locator(".react-flow__edge")).toHaveCount(4);

  // 先把目标图传进来（此时 3 张：素材 1 + 组内 2）
  await batch.getByRole("button", { name: "Import targets" }).click();
  await expect(batch.locator(".rf-action-fission-grid-card")).toHaveCount(4);
  await expect(batch).toContainText("extra");

  // 再连一次主参考：同一个端口重复，拒绝
  await dragToHandle("input");
  await expect(page.locator(".react-flow__edge")).toHaveCount(4);
});
