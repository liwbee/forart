import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });

const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=";

test.beforeEach(async ({ page }) => {
  await page.addInitScript((pixel) => {
    window.localStorage.setItem("forart_sidebar_open_v2", "true");
    window.localStorage.setItem("forart_infinite_canvas_show_home", "false");
    window.localStorage.setItem("forart_infinite_canvas_last_canvas_id", "canvas-toolbar");

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
    const provider = {
      id: "provider-1",
      name: "Test provider",
      baseUrl: "https://example.invalid/v1",
      apiKey: "test-key",
      accessKey: "",
      secretKey: "",
      protocol: "openai",
      imageRequestMode: "openai",
      imageGenerationEndpoint: "",
      imageEditEndpoint: "",
      imageModels: ["test-image-model"],
      chatModels: [],
      videoModels: [],
      modelAliases: { image: {}, chat: {}, video: {} },
      modelRules: { image: {} },
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
          providers: [provider],
          defaultImageProviderId: provider.id,
          providerOrder: [provider.id],
        }),
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
    Object.defineProperty(window, "forartLocalApi", {
      configurable: true,
      value: {
        request: async ({ path }: { path: string }) => {
          if (path === "/api/action-projects") {
            return { ok: true, status: 200, body: { projects: [{ id: "project-1", name: "Actions", cover_asset_id: null, cover_url: null, sort_order: 0, created_at: "", updated_at: "" }] } };
          }
          if (path.startsWith("/api/libraries/action/tags")) {
            return { ok: true, status: 200, body: { tags: [] } };
          }
          if (path.startsWith("/api/action-projects/project-1/actions")) {
            return {
              ok: true,
              status: 200,
              body: {
                actions: [
                  { id: "action-1", project_id: "project-1", name: "Action One", asset_id: "asset-1", asset_url: pixel, thumbnail_url: pixel, prompt: "one", tags: [], created_at: "", updated_at: "" },
                  { id: "action-2", project_id: "project-1", name: "Action Two", asset_id: "asset-2", asset_url: pixel, thumbnail_url: pixel, prompt: "two", tags: [], created_at: "", updated_at: "" },
                ],
              },
            };
          }
          return { ok: false, status: 404, body: { detail: `Unhandled test path: ${path}` } };
        },
      },
    });
    Object.defineProperty(window, "forartGenerationTasks", {
      configurable: true,
      value: {
        start: async (_executorKind: string, payload: { nodeId?: string }) => {
          document.documentElement.dataset.startedNodeId = String(payload.nodeId || "");
          await new Promise((resolve) => window.setTimeout(resolve, 250));
          return { id: "task-image-1" };
        },
        get: async () => ({ id: "task-image-1", status: "completed", result: { images: [] } }),
        stop: async () => ({ ok: true }),
        list: async () => ({ tasks: [] }),
        onChanged: () => () => undefined,
      },
    });

    const actionFission = {
      rows: [{
        id: "row-1",
        categoryGroups: [{
          id: "group-1",
          actionProjectId: "project-1",
          includeActionTagIds: [],
          excludeActionTagIds: [],
        }],
        selectedCategoryGroupId: "group-1",
        selectedActionId: "action-1",
        selectedActionName: "Action One",
        selectedActionPrompt: "one",
        selectedActionTags: [],
        selectedActionAssetUrl: pixel,
        selectedActionThumbUrl: pixel,
        resultUrl: pixel,
        resultThumbUrl: pixel,
        resultFileName: "result.png",
        resultDownloadState: "pending",
      }, {
        id: "row-2",
        categoryGroups: [{
          id: "group-2",
          actionProjectId: "project-1",
          includeActionTagIds: [],
          excludeActionTagIds: [],
        }],
        selectedCategoryGroupId: "group-2",
        selectedActionId: "action-2",
        selectedActionName: "Action Two",
        selectedActionPrompt: "two",
        selectedActionTags: [],
        selectedActionAssetUrl: pixel,
        selectedActionThumbUrl: pixel,
        resultUrl: "",
        resultThumbUrl: "",
        resultFileName: "",
        resultDownloadState: "pending",
      }],
      layout: "grid",
      apiType: "third-party-api",
      resolution: "1K",
      aspectRatio: "3:4",
    };
    Object.defineProperty(window, "easyTool", {
      configurable: true,
      value: {
        saveResult: async (payload: { defaultName?: string; convertToPng?: boolean }) => {
          document.documentElement.dataset.lastSaveResult = JSON.stringify(payload);
          return { canceled: false, filePath: `C:\\Downloads\\${payload.defaultName || "image"}` };
        },
        listCanvases: async () => ({
          projects: [{ id: "project-1", title: "Test project", sortOrder: 1, createdAt: 1, updatedAt: 1 }],
          canvases: [{ id: "canvas-toolbar", title: "Toolbar", projectId: "project-1", createdAt: 1, updatedAt: 1, revision: 1, nodeCount: 4 }],
        }),
        loadCanvas: async () => ({
          id: "canvas-toolbar",
          title: "Toolbar",
          projectId: "project-1",
          createdAt: 1,
          updatedAt: 1,
          revision: 1,
          canvasSchemaVersion: 2,
          nodes: [
            { id: "image-generator", type: "canvasNode", position: { x: 80, y: 100 }, style: { width: 420, height: 360 }, data: { kind: "imageGenerator", label: "Generator", text: "Generate a test image", imageProviderId: provider.id, imageModel: provider.imageModels[0], generatedImages: [{ url: pixel, fileName: "generated.png", downloadState: "pending" }] } },
            { id: "empty-image-generator", type: "canvasNode", position: { x: 320, y: 600 }, style: { width: 420, height: 360 }, data: { kind: "imageGenerator", label: "Empty generator", text: "Generate another test image", imageProviderId: provider.id, imageModel: provider.imageModels[0], generatedImages: [] } },
            { id: "action-fission", type: "canvasNode", position: { x: 620, y: 100 }, style: { width: 700, height: 560 }, data: { kind: "actionFission", label: "Fission", actionFission } },
            { id: "reference", type: "canvasNode", position: { x: 80, y: 600 }, style: { width: 180, height: 120 }, data: { kind: "imageLoader", label: "Reference", imageUrl: pixel, imageFileName: "uploaded.jpg" } },
          ],
          edges: [{ id: "edge-reference", source: "reference", target: "action-fission", sourceHandle: "output", targetHandle: "input", data: { inputKind: "referenceImage", referenceOrder: 1 } }],
          viewport: { x: 0, y: 0, zoom: 0.8 },
        }),
        saveCanvas: async () => ({ ok: true }),
        getCanvasClipboardStatus: async () => ({ hasNodes: false, hasImage: false }),
      },
    });
  }, PIXEL);

  await page.goto("http://127.0.0.1:6981/");
  await page.getByRole("button", { name: "Infinite Canvas" }).click();
});

async function selectNode(page: Page, nodeId: string) {
  const node = page.locator(`.react-flow__node[data-id="${nodeId}"]`);
  await expect(node).toBeVisible();
  await node.locator(".rf-native-node-caption").click();
  const toolbar = page.locator(".rf-native-node-toolbar");
  await expect(toolbar).toBeVisible();
  return toolbar;
}

test("exposes generation actions in the image generator top toolbar", async ({ page }) => {
  const toolbar = await selectNode(page, "image-generator");
  await expect(toolbar.getByRole("button", { name: "Run" })).toBeEnabled();
  await expect(toolbar.getByRole("button", { name: "Download image" })).toBeEnabled();

  await toolbar.getByRole("button", { name: "Run" }).click();
  await expect.poll(() => page.locator("html").getAttribute("data-started-node-id")).toBe("image-generator");
});

test("preserves uploaded image format while generated images still download as PNG", async ({ page }) => {
  let toolbar = await selectNode(page, "reference");
  await toolbar.getByRole("button", { name: "Download image" }).click();
  await expect.poll(async () => page.locator("html").getAttribute("data-last-save-result")).not.toBeNull();
  let payload = JSON.parse(String(await page.locator("html").getAttribute("data-last-save-result")));
  expect(payload.convertToPng).toBe(false);
  expect(payload.defaultName).toMatch(/\.jpg$/);

  toolbar = await selectNode(page, "image-generator");
  await toolbar.getByRole("button", { name: "Download image" }).click();
  await expect.poll(async () => {
    const saved = await page.locator("html").getAttribute("data-last-save-result");
    return saved ? JSON.parse(saved).convertToPng : null;
  }).toBe(true);
});

test("hides the empty generator icon as soon as generation starts", async ({ page }) => {
  const node = page.locator('.react-flow__node[data-id="empty-image-generator"]');
  const emptyIcon = node.locator(".rf-native-image-generator-empty-icon");
  await expect(emptyIcon).toBeVisible();

  const toolbar = await selectNode(page, "empty-image-generator");
  await toolbar.getByRole("button", { name: "Run" }).click();

  await expect(node.getByRole("status")).toBeVisible();
  await expect(emptyIcon).toHaveCount(0);
});

test("hides the empty action fission grid icon as soon as row generation starts", async ({ page }) => {
  const node = page.locator('.react-flow__node[data-id="action-fission"]');
  const emptyRow = node.locator(".rf-action-fission-grid-card").nth(1);
  const emptyIcon = emptyRow.locator(".rf-action-fission-result-preview > .lucide-images");
  await expect(emptyIcon).toBeVisible();

  await emptyRow.getByRole("button", { name: "Rerun" }).click();

  await expect(emptyRow.locator(".rf-action-fission-generation-status")).toBeVisible();
  await expect(emptyIcon).toHaveCount(0);
});

test("exposes run, group download, and random action controls in the action fission top toolbar", async ({ page }) => {
  const toolbar = await selectNode(page, "action-fission");
  await expect(toolbar.getByRole("button", { name: "Run" })).toBeEnabled();
  await expect(toolbar.getByRole("button", { name: "Download group" })).toBeEnabled();
  const randomize = toolbar.getByRole("button", { name: "Switch group actions" });
  await expect(randomize).toBeEnabled();

  await randomize.click();
  await expect(page.locator('.react-flow__node[data-id="action-fission"] .rf-action-fission-row-summary small').first()).toHaveText("Action Two");
});
