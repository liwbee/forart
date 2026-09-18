import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });

const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const APP_URL = process.env.FORART_TEST_URL || "http://127.0.0.1:6981/";

async function bootBatchAndFissionCanvas(page: Page) {
  await page.addInitScript((pixel) => {
    window.localStorage.setItem("forart_sidebar_open_v2", "true");
    window.localStorage.setItem("forart_infinite_canvas_show_home", "false");
    window.localStorage.setItem("forart_infinite_canvas_last_canvas_id", "canvas-1");

    const config = {
      mode: "local",
      localLibraryPath: "",
      serverUrl: "",
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
        loadApiSettings: async () => ({
          providers: [{
            id: "provider-1",
            name: "Test provider",
            baseUrl: "https://example.invalid/v1",
            apiKey: "test-key",
            accessKey: "",
            secretKey: "",
            protocol: "openai",
            imageGenerationEndpoint: "",
            imageEditEndpoint: "",
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
    Object.defineProperty(window, "forartGenerationTasks", {
      configurable: true,
      value: {
        start: async () => ({ id: "task-handle" }),
        startMany: async () => [],
        get: async () => null,
        getMany: async () => [],
        list: async () => ({ tasks: [] }),
        listForCanvas: async () => [],
        stop: async () => ({ ok: true }),
        onChanged: () => () => undefined,
      },
    });
    Object.defineProperty(window, "forartCanvasTasks", {
      configurable: true,
      value: {
        listPage: async () => ({ tasks: [], total: 0, counts: { all: 0, active: 0, succeeded: 0, exceptional: 0 } }),
      },
    });
    Object.defineProperty(window, "forartLocalApi", {
      configurable: true,
      value: {
        request: async () => ({ ok: true, status: 200, body: { projects: [], actions: [], tags: [] } }),
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
            nodeCount: 2,
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
          nodes: [
            {
              id: "batch-node",
              type: "canvasNode",
              position: { x: 120, y: 120 },
              style: { width: 680, height: 520 },
              data: {
                kind: "batchImageGenerator",
                label: "Batch",
                text: "prompt",
                imageProviderId: "provider-1",
                imageModel: "test-image-model",
                batchImageGenerator: {
                  prompt: "prompt",
                  items: [{
                    id: "item-1",
                    sourceUrl: pixel,
                    sourceThumbUrl: pixel,
                    sourceFileName: "source.png",
                    sourceLoadState: "ready",
                    status: "idle",
                  }],
                },
              },
            },
            {
              id: "fission-node",
              type: "canvasNode",
              position: { x: 900, y: 120 },
              style: { width: 700, height: 520 },
              data: {
                kind: "actionFission",
                label: "Fission",
                actionFission: {
                  rows: [{
                    id: "row-1",
                    categoryGroups: [{
                      id: "group-1",
                      actionProjectId: "project-1",
                      includeActionTagIds: [],
                      excludeActionTagIds: [],
                    }],
                    selectedCategoryGroupId: "group-1",
                  }],
                  apiType: "third-party-api",
                  resolution: "1K",
                  aspectRatio: "3:4",
                },
              },
            },
          ],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        }),
        saveCanvas: async () => ({ ok: true }),
        getCanvasClipboardStatus: async () => ({ hasNodes: false, hasImage: false }),
      },
    });
  }, PIXEL);

  await page.goto(APP_URL);
  await page.getByRole("button", { name: "Infinite Canvas" }).click();
  await page.locator('.react-flow__node[data-id="batch-node"]').waitFor({ state: "visible", timeout: 30_000 });
  await page.locator('.react-flow__node[data-id="fission-node"]').waitFor({ state: "visible", timeout: 30_000 });
}

test("reference handles show their hint while the whole node is hovered", async ({ page }) => {
  await bootBatchAndFissionCanvas(page);

  for (const nodeId of ["batch-node", "fission-node"]) {
    const node = page.locator(`.react-flow__node[data-id="${nodeId}"]`);
    const mainHandle = page.locator(`.react-flow__node[data-id="${nodeId}"] .react-flow__handle[data-handleid="input"]`);
    const additionalHandle = page.locator(`.react-flow__node[data-id="${nodeId}"] .react-flow__handle[data-handleid="additional-reference"]`);
    // 「传入目标」只有批量洗图有
    const importHandle = page.locator(`.react-flow__node[data-id="${nodeId}"] .react-flow__handle[data-handleid="batch-import-target"]`);
    const isBatchNode = nodeId === "batch-node";
    await expect(mainHandle).toHaveCount(1);
    await expect(additionalHandle).toHaveCount(1);
    await expect(importHandle).toHaveCount(isBatchNode ? 1 : 0);
    // The native title tooltip would stack on top of the styled one.
    await expect(mainHandle).not.toHaveAttribute("title", /.+/);
    await expect(additionalHandle).not.toHaveAttribute("title", /.+/);

    const tooltips = page.locator('[data-slot="tooltip-content"]');
    await expect(tooltips).toHaveCount(0);

    // Hovering the node body, not the dot, is what reveals both hints.
    await node.locator(".rf-native-node-caption").hover();
    await expect(tooltips).toHaveCount(isBatchNode ? 3 : 2);
    await expect(tooltips.filter({ hasText: "Primary references" })).toHaveCount(1);
    await expect(tooltips.filter({ hasText: "Additional references" })).toHaveCount(1);
    await expect(tooltips.filter({ hasText: "Import targets" })).toHaveCount(isBatchNode ? 1 : 0);
    await expect(mainHandle).toHaveAttribute("aria-describedby", /.+/);
    await expect(additionalHandle).toHaveAttribute("aria-describedby", /.+/);

    await page.mouse.move(1180, 780, { steps: 6 });
    await expect(tooltips).toHaveCount(0);
  }
});

test("batch and fission nodes expose their reference handles plus one output", async ({ page }) => {
  await bootBatchAndFissionCanvas(page);
  const fissionHandles = await page.locator('.react-flow__node[data-id="fission-node"] .react-flow__handle').count();
  expect(fissionHandles).toBe(3);
  const batchHandles = await page.locator('.react-flow__node[data-id="batch-node"] .react-flow__handle').count();
  // 批量洗图多一个「传入目标」端口
  expect(batchHandles).toBe(4);
});
