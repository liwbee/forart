import { expect, test } from "@playwright/test";

/**
 * Regression test for the canvas update-depth loop.
 *
 * A batch node whose items still carry `latestGenerationTaskId` for an already finished
 * task used to re-register that task watcher on every node change. Each registration
 * re-reported the finished result, the resulting write republished the nodes, and the two
 * halves bounced until React aborted with "Maximum update depth exceeded" — so grouping
 * anything on such a canvas (even two brand new empty nodes) blanked the page.
 *
 * The visible symptom is watcher churn, so this asserts on how often the task service is
 * asked for the finished task rather than on internal counters.
 */

test.use({ viewport: { width: 1440, height: 900 } });

const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
const TASK_ID = "task-finished-1";
const FINISHED_FILE_NAME = "APImart-gpt-image-2-01011200.png";

test("a finished batch task is not re-watched on every node change", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message.split("\n")[0]));

  const document = {
    canvasSchemaVersion: 5,
    id: "canvas-batch-watch",
    title: "batch watch",
    projectId: "project_default",
    canvasType: "forart",
    createdAt: 1,
    updatedAt: 1,
    revision: 1,
    nodes: [{
      id: "batchImageGenerator_watch",
      type: "canvasNode",
      position: { x: 240, y: 160 },
      style: { width: 680, height: 816 },
      data: {
        kind: "batchImageGenerator",
        label: "",
        text: "prompt",
        imageProviderId: "apimart",
        imageModel: "gpt-image-2",
        batchImageGenerator: {
          prompt: "prompt",
          layout: "grid",
          items: [{
            id: "item-1",
            sourceUrl: PIXEL,
            sourceThumbUrl: PIXEL,
            sourceFileName: "source.png",
            sourceLoadState: "ready",
            status: "completed",
            resultUrl: PIXEL,
            resultThumbUrl: PIXEL,
            resultFileName: FINISHED_FILE_NAME,
            resultWidth: 1,
            resultHeight: 1,
            latestGenerationTaskId: TASK_ID,
          }],
        },
      },
    }],
    connections: [],
    groups: [],
    viewport: { x: 0, y: 0, scale: 0.6 },
  };

  await page.addInitScript((canvasDocument: Record<string, unknown>) => {
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
        save: async (nextConfig: unknown) => ({ ok: true, config: nextConfig }),
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
          projects: [{ id: "project_default", title: "P", sortOrder: 1, createdAt: 1, updatedAt: 1 }],
          canvases: [{ id: canvasDocument.id, title: "batch watch", projectId: "project_default", createdAt: 1, updatedAt: 1, revision: 1, nodeCount: 1 }],
        }),
        loadCanvas: async () => canvasDocument,
        saveCanvas: async () => ({
          ok: true,
          record: {
            id: canvasDocument.id, title: "batch watch", icon: "layers", canvasType: "forart", projectId: "project_default",
            color: "", pinned: false, createdAt: 1, updatedAt: Date.now(), revision: 2, nodeCount: 1,
          },
        }),
        getCanvasClipboardStatus: async () => ({ hasNodes: false, hasImage: false }),
        ensureCanvasAssetThumbnail: async () => ({ thumbUrl: "" }),
      },
    });

    const finishedTask = {
      id: "task-finished-1",
      target: { canvasId: "canvas-batch-watch", kind: "imageGenerator", nodeId: "batchImageGenerator_watch" },
      executorKind: "api",
      status: "succeeded",
      version: 5,
      startedAt: 1,
      updatedAt: 2,
      completedAt: 2,
      result: { images: [{
        assetUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
        thumbUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
        fileName: "APImart-gpt-image-2-01011200.png",
        width: 1,
        height: 1,
      }] },
    };

    const calls = { get: 0, listForCanvas: 0 };
    (window as unknown as { __forartTaskCalls: typeof calls }).__forartTaskCalls = calls;
    Object.defineProperty(window, "forartGenerationTasks", {
      configurable: true,
      value: {
        get: async () => { calls.get += 1; return finishedTask; },
        getMany: async () => [finishedTask],
        listForCanvas: async () => { calls.listForCanvas += 1; return [finishedTask]; },
        listPage: async () => ({ tasks: [finishedTask], total: 1, counts: { all: 1, active: 0, succeeded: 1, exceptional: 0 } }),
        start: async () => finishedTask,
        startMany: async () => [finishedTask],
        stop: async () => ({ ok: true }),
        onChanged: () => () => undefined,
      },
    });
  }, document);

  await page.goto("http://127.0.0.1:6981/");
  await page.getByRole("button", { name: "Infinite Canvas" }).click();
  await expect(page.locator('.react-flow__node[data-id="batchImageGenerator_watch"]')).toBeVisible();
  await page.waitForTimeout(4000);

  const calls = await page.evaluate(() => (window as unknown as { __forartTaskCalls: { get: number } }).__forartTaskCalls);
  expect(calls.get).toBeLessThanOrEqual(3);
  await expect(page.getByText("This page could not be displayed", { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("creates an asset node from a batch result card", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message.split("\n")[0]));

  const document = {
    canvasSchemaVersion: 5,
    id: "canvas-batch-watch",
    title: "batch watch",
    projectId: "project_default",
    canvasType: "forart",
    createdAt: 1,
    updatedAt: 1,
    revision: 1,
    nodes: [{
      id: "batchImageGenerator_watch",
      type: "canvasNode",
      position: { x: 240, y: 160 },
      style: { width: 680, height: 816 },
      data: {
        kind: "batchImageGenerator",
        label: "",
        text: "prompt",
        imageProviderId: "apimart",
        imageModel: "gpt-image-2",
        batchImageGenerator: {
          prompt: "prompt",
          layout: "grid",
          items: [{
            id: "item-1",
            sourceUrl: PIXEL,
            sourceThumbUrl: PIXEL,
            sourceFileName: "source.png",
            sourceLoadState: "ready",
            status: "completed",
            resultUrl: PIXEL,
            resultThumbUrl: PIXEL,
            resultFileName: FINISHED_FILE_NAME,
            resultWidth: 1,
            resultHeight: 1,
          }],
        },
      },
    }],
    connections: [],
    groups: [],
    viewport: { x: 0, y: 0, scale: 0.6 },
  };

  await page.addInitScript((canvasDocument: Record<string, unknown>) => {
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
        save: async (nextConfig: unknown) => ({ ok: true, config: nextConfig }),
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
          projects: [{ id: "project_default", title: "P", sortOrder: 1, createdAt: 1, updatedAt: 1 }],
          canvases: [{ id: canvasDocument.id, title: "batch watch", projectId: "project_default", createdAt: 1, updatedAt: 1, revision: 1, nodeCount: 1 }],
        }),
        loadCanvas: async () => canvasDocument,
        saveCanvas: async () => ({ ok: true }),
        getCanvasClipboardStatus: async () => ({ hasNodes: false, hasImage: false }),
        ensureCanvasAssetThumbnail: async () => ({ thumbUrl: "" }),
      },
    });
    Object.defineProperty(window, "forartGenerationTasks", {
      configurable: true,
      value: {
        get: async () => null,
        getMany: async () => [],
        listForCanvas: async () => [],
        listPage: async () => ({ tasks: [], total: 0, counts: { all: 0, active: 0, succeeded: 0, exceptional: 0 } }),
        start: async () => null,
        startMany: async () => [],
        stop: async () => ({ ok: true }),
        onChanged: () => () => undefined,
      },
    });
  }, document);

  await page.goto("http://127.0.0.1:6981/");
  await page.getByRole("button", { name: "Infinite Canvas" }).click();
  const node = page.locator('.react-flow__node[data-id="batchImageGenerator_watch"]');
  await expect(node).toBeVisible();

  // 记录素材落盘相关的调用：创建素材节点只应引用已有结果图，
  // 不能写出新的素材文件，也不应该重新生成缩略图。
  await page.evaluate(() => {
    const calls: string[] = [];
    (window as unknown as { __forartAssetCalls: string[] }).__forartAssetCalls = calls;
    const tool = window.easyTool as unknown as Record<string, ((payload: unknown) => Promise<unknown>) | undefined>;
    (["saveCanvasAsset", "importCanvasAssetFile", "ensureCanvasAssetThumbnail"] as const).forEach((name) => {
      const original = tool[name];
      tool[name] = (payload: unknown) => {
        calls.push(name);
        return original ? original(payload) : Promise.resolve({});
      };
    });
  });

  const card = node.locator(".rf-action-fission-grid-card").first();
  const badge = card.locator(".rf-action-fission-card-badge");
  const index = badge.locator(".rf-action-fission-card-index");
  const createButton = badge.getByRole("button", { name: "Create asset node" });
  await expect(index).toHaveText("01");
  await expect(createButton).toHaveCSS("opacity", "0");

  await card.hover();
  await expect(index).toHaveCSS("opacity", "0");
  await expect(createButton).toBeEnabled();
  await createButton.click();

  const created = page.locator('.react-flow__node[data-id^="assetLoader_"]');
  await expect(created).toHaveCount(1);
  await expect(created.locator(".rf-native-node-caption")).toContainText(FINISHED_FILE_NAME.replace(/\.png$/, ""));
  // 复用同一份结果图：既不写新素材文件，也不重新生成缩略图。
  await expect(created.locator("img").first()).toHaveAttribute("src", PIXEL);
  expect(await page.evaluate(() => (window as unknown as { __forartAssetCalls: string[] }).__forartAssetCalls)).toEqual([]);
  await expect(page.getByText("This page could not be displayed", { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
