import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });

const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=";
const APP_URL = process.env.FORART_TEST_URL || "http://127.0.0.1:6981/";

test.beforeEach(async ({ page }) => {
  await page.addInitScript((pixel) => {
    window.localStorage.setItem("forart_sidebar_open_v2", "true");
    window.localStorage.setItem("forart_infinite_canvas_show_home", "false");
    window.localStorage.setItem("forart_infinite_canvas_last_canvas_id", "canvas-toolbar");
    window.localStorage.setItem("forart_infinite_canvas_open_tabs", JSON.stringify([
      { id: "canvas-toolbar", title: "Toolbar", projectId: "project-1", createdAt: 1, updatedAt: 1, revision: 1, nodeCount: 5 },
      { id: "canvas-secondary", title: "Secondary", projectId: "project-1", createdAt: 1, updatedAt: 1, revision: 1, nodeCount: 0 },
    ]));

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
    const longParameterLabels = window.localStorage.getItem("forart_test_long_parameter_labels") === "true";
    const cropThumbnailFixture = window.localStorage.getItem("forart_test_crop_thumbnail") === "true";
    const cropThumbnail = cropThumbnailFixture
      ? `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="red"/></svg>')}`
      : pixel;
    const initialImagePrompt = window.localStorage.getItem("forart_test_long_prompt") === "true"
      ? Array.from({ length: 12 }, (_, index) => `Detailed prompt line ${index + 1} with subject, lighting, composition, materials, and camera direction.`).join("\n")
      : "Generate a test image";
    const provider = {
      id: "provider-1",
      name: longParameterLabels ? "OpenAI Enterprise Image Generation Platform" : "Test provider",
      baseUrl: "https://example.invalid/v1",
      apiKey: "test-key",
      accessKey: "",
      secretKey: "",
      protocol: "openai",
      imageRequestMode: "openai",
      imageGenerationEndpoint: "",
      imageEditEndpoint: "",
      imageModels: [longParameterLabels
        ? "forart-ultra-photorealistic-image-generation-model-v2026-08-preview"
        : "test-image-model"],
      chatModels: ["test-chat-model"],
      videoModels: [],
      modelAliases: { image: {}, chat: {}, video: {} },
      modelRules: { image: {} },
    };
    const providers = longParameterLabels ? [
      provider,
      {
        ...provider,
        id: "provider-short",
        name: "Test provider",
        imageModels: ["test-image-model"],
        chatModels: [],
      },
    ] : [provider];
    let infiniteCanvasSettings = {
      connectionsVisible: true,
      minimapOpen: false,
      snapToGrid: false,
      promptEditorsExpanded: false,
      referenceComparisonViewer: {
        referenceComparisonEnabled: false,
        referencePanelPercent: 50,
      },
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
        loadApiSettings: async () => {
          if (window.localStorage.getItem("forart_test_delay_api_settings") === "true") {
            await new Promise((resolve) => window.setTimeout(resolve, 350));
          }
          return {
            providers,
            defaultImageProviderId: provider.id,
            providerOrder: providers.map((item) => item.id),
          };
        },
        loadInfiniteCanvasSettings: async () => infiniteCanvasSettings,
        saveInfiniteCanvasSettings: async (next: typeof infiniteCanvasSettings) => {
          infiniteCanvasSettings = next;
          document.documentElement.dataset.promptEditorsExpandedSaved = String(next.promptEditorsExpanded);
          return { ok: true, infiniteCanvas: next };
        },
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
    const activeAgentRuns = new Map<string, Record<string, unknown>>();
    const agentListeners = new Set<(run: Record<string, unknown>) => void>();
    const publishAgentRun = (run: Record<string, unknown>) => agentListeners.forEach((listener) => listener(run));
    Object.defineProperty(window, "forartCanvasAgent", {
      configurable: true,
      value: {
        run: async (request: { runId?: string; task?: string; canvasId?: string; nodeId?: string; context?: { prompt?: string }; modelRoute?: { providerId?: string; model?: string }; reasoning?: string }) => {
          const runtimeRun = {
            runId: String(request.runId || ""),
            task: String(request.task || ""),
            canvasId: String(request.canvasId || ""),
            nodeId: String(request.nodeId || ""),
            sourcePrompt: String(request.context?.prompt || ""),
            stage: "requesting-model",
            status: "running",
            startedAt: Date.now(),
          };
          activeAgentRuns.set(runtimeRun.runId, runtimeRun);
          publishAgentRun(runtimeRun);
          if (request.task === "smart-reverse") {
            document.documentElement.dataset.reverseRoute = JSON.stringify(request.modelRoute || {});
            document.documentElement.dataset.reverseReasoning = String(request.reasoning || "");
            if (document.documentElement.dataset.delayReverse === "true") {
              await new Promise((resolve) => window.setTimeout(resolve, 1800));
              if (document.documentElement.dataset.failReverse === "true") {
                const error = new Error("Mock smart reverse failure");
                publishAgentRun({ ...runtimeRun, status: "failed", error: error.message });
                activeAgentRuns.delete(runtimeRun.runId);
                throw error;
              }
              document.documentElement.dataset.reverseCompleted = "true";
            }
            const result = {
              mode: "separate",
              relationshipSummary: "独立参考图",
              assetUses: [{ nodeId: "reference", use: "主体参考" }],
              outputs: [{ id: "output-1", sourceNodeIds: ["reference"], summary: "主体", detailedPrompt: "反推出的主体与服装 Prompt", compactPrompt: "主体 Prompt", negativePrompt: "", preserved: [], avoid: [], uncertainties: [] }],
              warnings: [],
            };
            publishAgentRun({ ...runtimeRun, stage: "completed", status: "completed", result });
            activeAgentRuns.delete(runtimeRun.runId);
            return result;
          }
          await new Promise((resolve) => window.setTimeout(resolve, document.documentElement.dataset.delayOptimization === "true" ? 1800 : 350));
          document.documentElement.dataset.optimizationCompleted = "true";
          const result = {
            optimizedPrompt: "A cinematic portrait using @图一 for the hat and glasses\nNatural interaction with the referenced accessories\nWarm rim light and detailed fabric texture",
            preserved: [],
            changes: [],
            warnings: [],
          };
          publishAgentRun({ ...runtimeRun, stage: "completed", status: "completed", result });
          activeAgentRuns.delete(runtimeRun.runId);
          return result;
        },
        cancel: async (runId: string) => {
          document.documentElement.dataset.agentCancelCount = String(Number(document.documentElement.dataset.agentCancelCount || "0") + 1);
          const runtimeRun = activeAgentRuns.get(runId);
          if (runtimeRun) publishAgentRun({ ...runtimeRun, status: "canceled" });
          activeAgentRuns.delete(runId);
          return { ok: true };
        },
        listActive: async (canvasId?: string) => [...activeAgentRuns.values()].filter((run) => !canvasId || run.canvasId === canvasId),
        onProgress: (listener: (run: Record<string, unknown>) => void) => {
          agentListeners.add(listener);
          return () => agentListeners.delete(listener);
        },
      },
    });
    Object.defineProperty(window, "forartCanvasTasks", {
      configurable: true,
      value: {
        listPage: async () => ({
          tasks: [],
          total: 0,
          counts: { all: 0, active: 0, succeeded: 0, exceptional: 0 },
        }),
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
    const wrappedReferenceFixture = window.localStorage.getItem("forart_test_wrapped_references") === "true";
    const wrappedReferenceNodes = wrappedReferenceFixture
      ? Array.from({ length: 10 }, (_, index) => ({
        id: `wrapped-reference-${index + 2}`,
        type: "canvasNode",
        position: { x: -2000, y: -2000 - index * 140 },
        style: { width: 180, height: 120 },
        data: {
          kind: "imageLoader",
          label: `Wrapped reference ${index + 2}`,
          imageUrl: pixel,
          imageFileName: `wrapped-${index + 2}.png`,
        },
      }))
      : [];
    const wrappedPromptNodes = wrappedReferenceFixture ? [{
      id: "wrapped-prompt",
      type: "canvasNode",
      position: { x: -2200, y: -2000 },
      style: { width: 240, height: 160 },
      data: { kind: "prompt", label: "Wrapped prompt", text: "Wrapped prompt reference" },
    }] : [];
    const wrappedGeneratorEdges = wrappedReferenceNodes.map((node, index) => ({
      id: `edge-generator-${node.id}`,
      source: node.id,
      target: "image-generator",
      sourceHandle: "output",
      targetHandle: "input",
      data: { inputKind: "referenceImage", referenceOrder: index + 2 },
    }));
    const wrappedAdditionalEdges = wrappedReferenceFixture ? [{
      id: "edge-action-fission-additional",
      source: wrappedReferenceNodes[0].id,
      target: "action-fission",
      sourceHandle: "output",
      targetHandle: "additional-reference",
      data: { inputKind: "additionalReferenceImage", referenceOrder: 1 },
    }] : [];
    const wrappedPromptEdges = wrappedReferenceFixture ? [{
      id: "edge-generator-wrapped-prompt",
      source: "wrapped-prompt",
      target: "image-generator",
      sourceHandle: "output",
      targetHandle: "input",
      data: { inputKind: "prompt" },
    }] : [];
    Object.defineProperty(window, "easyTool", {
      configurable: true,
      value: {
        saveResult: async (payload: { defaultName?: string; convertToPng?: boolean }) => {
          document.documentElement.dataset.lastSaveResult = JSON.stringify(payload);
          return { canceled: false, filePath: `C:\\Downloads\\${payload.defaultName || "image"}` };
        },
        listCanvases: async () => ({
          projects: [{ id: "project-1", title: "Test project", sortOrder: 1, createdAt: 1, updatedAt: 1 }],
          canvases: [
            { id: "canvas-toolbar", title: "Toolbar", projectId: "project-1", createdAt: 1, updatedAt: 1, revision: 1, nodeCount: 5 },
            { id: "canvas-secondary", title: "Secondary", projectId: "project-1", createdAt: 1, updatedAt: 1, revision: 1, nodeCount: 0 },
          ],
        }),
        loadCanvas: async (canvasId: string) => canvasId === "canvas-secondary" ? ({
          id: "canvas-secondary",
          title: "Secondary",
          projectId: "project-1",
          createdAt: 1,
          updatedAt: 1,
          revision: 1,
          canvasSchemaVersion: 2,
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        }) : ({
          id: "canvas-toolbar",
          title: "Toolbar",
          projectId: "project-1",
          createdAt: 1,
          updatedAt: 1,
          revision: 1,
          canvasSchemaVersion: 2,
          nodes: [
            { id: "image-generator", type: "canvasNode", position: { x: 80, y: 100 }, style: { width: 420, height: 360 }, data: { kind: "imageGenerator", label: "Generator", text: document.documentElement.dataset.optimizationCompleted === "true" ? "A cinematic portrait using @图一 for the hat and glasses\nNatural interaction with the referenced accessories\nWarm rim light and detailed fabric texture" : initialImagePrompt, imagePromptDocument: document.documentElement.dataset.optimizationCompleted === "true" ? { root: { type: "root", version: 1, children: [{ type: "paragraph", version: 1, children: [{ type: "text", version: 1, text: "A cinematic portrait using " }, { type: "image-reference", version: 1, edgeId: "edge-generator-reference" }, { type: "text", version: 1, text: " for the hat and glasses" }] }, { type: "paragraph", version: 1, children: [{ type: "text", version: 1, text: "Natural interaction with the referenced accessories" }] }, { type: "paragraph", version: 1, children: [{ type: "text", version: 1, text: "Warm rim light and detailed fabric texture" }] }] } } : undefined, imageProviderId: provider.id, imageModel: provider.imageModels[0], generatedImages: [{ url: pixel, fileName: "generated.png", downloadState: "pending" }] } },
            { id: "empty-image-generator", type: "canvasNode", position: { x: 320, y: 600 }, style: { width: 420, height: 360 }, data: { kind: "imageGenerator", label: "Empty generator", text: "Generate another test image", imageProviderId: provider.id, imageModel: provider.imageModels[0], generatedImages: [] } },
            { id: "action-fission", type: "canvasNode", position: { x: 620, y: 100 }, style: { width: 700, height: 560 }, data: { kind: "actionFission", label: "Fission", actionFission } },
            { id: "reference", type: "canvasNode", position: { x: 80, y: 600 }, style: { width: 180, height: 120 }, data: cropThumbnailFixture
              ? { kind: "imageLoader", label: "Reference", imageUrl: "forart-asset://canvas/input/original.png", thumbUrl: cropThumbnail, imageFileName: "uploaded.png", imageNaturalWidth: 4000, imageNaturalHeight: 3000 }
              : { kind: "imageLoader", label: "Reference", imageUrl: pixel, imageFileName: "uploaded.jpg" } },
            { id: "image-reverse", type: "canvasNode", position: { x: 760, y: 400 }, style: { width: 340, height: 300 }, data: { kind: "smartReverse", label: "Reverse", text: document.documentElement.dataset.reverseCompleted === "true" ? "反推出的主体与服装 Prompt" : "", smartReverseProviderId: provider.id, smartReverseModel: "test-chat-model", smartReverseReasoning: "none" } },
            ...wrappedReferenceNodes,
            ...wrappedPromptNodes,
          ],
          edges: [
            { id: "edge-reference", source: "reference", target: "action-fission", sourceHandle: "output", targetHandle: "input", data: { inputKind: "referenceImage", referenceOrder: 1 } },
            { id: "edge-generator-reference", source: "reference", target: "image-generator", sourceHandle: "output", targetHandle: "input", data: { inputKind: "referenceImage", referenceOrder: 1 } },
            { id: "edge-reverse-reference", source: "reference", target: "image-reverse", sourceHandle: "output", targetHandle: "input", data: { inputKind: "referenceImage", referenceOrder: 1 } },
            ...wrappedGeneratorEdges,
            ...wrappedAdditionalEdges,
            ...wrappedPromptEdges,
          ],
          viewport: { x: 0, y: 0, zoom: 0.8 },
        }),
        saveCanvas: async () => ({ ok: true }),
        cropCanvasAsset: async (payload: Record<string, unknown>) => {
          document.documentElement.dataset.lastCropPayload = JSON.stringify(payload);
          return {
            url: pixel,
            thumbUrl: pixel,
            fileName: "cropped.png",
            width: Number(payload.width || 1),
            height: Number(payload.height || 1),
          };
        },
        getCanvasClipboardStatus: async () => ({ hasNodes: false, hasImage: false }),
      },
    });
  }, PIXEL);

  await page.goto(APP_URL);
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

  const parameterSelectors = [
    {
      control: page.getByRole("combobox", { name: "Platform", exact: true }),
      text: page.getByRole("combobox", { name: "Platform", exact: true }).locator('[data-slot="select-value"]'),
    },
    {
      control: page.getByRole("combobox", { name: "Model", exact: true }),
      text: page.getByRole("combobox", { name: "Model", exact: true }).locator('[data-slot="select-value"]'),
    },
    {
      control: page.getByRole("button", { name: "Resolution / Ratio", exact: true }),
      text: page.getByRole("button", { name: "Resolution / Ratio", exact: true }).locator("span").first(),
    },
  ];
  const promptFontSize = await page.getByRole("textbox", { name: "Prompt", exact: true })
    .evaluate((element) => window.getComputedStyle(element).fontSize);
  expect(promptFontSize).toBe("14px");
  for (const selector of parameterSelectors) {
    await expect(selector.text).toHaveCSS("font-size", promptFontSize);
    await expect(selector.control).toHaveCSS("height", "32px");
  }

  await toolbar.getByRole("button", { name: "Run" }).click();
  await expect.poll(() => page.locator("html").getAttribute("data-started-node-id")).toBe("image-generator");
});

test("does not flash an unconfigured-model warning while API settings are loading", async ({ page }) => {
  await page.evaluate(() => window.localStorage.setItem("forart_test_delay_api_settings", "true"));
  await page.reload();
  await page.getByRole("button", { name: "Infinite Canvas" }).click();
  await page.evaluate(() => {
    document.documentElement.dataset.sawUnconfiguredModelWarning = "false";
    const warning = "Configure at least one image model in Settings first.";
    const observer = new MutationObserver(() => {
      if (document.body.textContent?.includes(warning)) {
        document.documentElement.dataset.sawUnconfiguredModelWarning = "true";
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.setTimeout(() => observer.disconnect(), 1000);
  });
  await selectNode(page, "image-generator");
  await expect(page.getByRole("combobox", { name: "Platform", exact: true })).toBeVisible();
  expect(await page.locator("html").getAttribute("data-saw-unconfigured-model-warning")).toBe("false");
});

test("sizes the parameter panel from its selector labels without stretching short labels", async ({ page }) => {
  await selectNode(page, "image-generator");
  const platform = page.getByRole("combobox", { name: "Platform", exact: true });
  const model = page.getByRole("combobox", { name: "Model", exact: true });
  const size = page.getByRole("button", { name: "Resolution / Ratio", exact: true });
  const panel = platform.locator("xpath=ancestor::*[@data-slot='card'][1]");
  const parameterRun = panel.getByRole("button", { name: "Run", exact: true });

  const [shortPanelBox, shortSizeBox, shortRunBox] = await Promise.all([
    panel.boundingBox(),
    size.boundingBox(),
    parameterRun.boundingBox(),
  ]);
  expect(shortPanelBox?.width).toBeCloseTo(668, 0);
  expect(Number(shortRunBox?.x) - Number(shortSizeBox?.x) - Number(shortSizeBox?.width)).toBeGreaterThan(24);
  const referenceSlotWidth = await panel.getByRole("list", { name: "Connected inputs", exact: true }).evaluate((element) => {
    const style = window.getComputedStyle(element);
    return element.clientWidth
      - (Number.parseFloat(style.paddingLeft) || 0)
      - (Number.parseFloat(style.paddingRight) || 0);
  });
  // 1 个工具槽 + 分隔线 + 9 个参考图槽刚好完整显示；第 10 张进入下一行。
  expect(referenceSlotWidth).toBeGreaterThanOrEqual(56 + 1 + 9 * 56 + 10 * 8);
  expect(referenceSlotWidth).toBeLessThan(56 + 1 + 10 * 56 + 11 * 8);

  const generatorNode = page.locator('.react-flow__node[data-id="image-generator"]');
  const pane = page.locator(".react-flow__pane");
  const [nodeBeforePan, panelBeforePan, paneBox] = await Promise.all([
    generatorNode.boundingBox(),
    panel.boundingBox(),
    pane.boundingBox(),
  ]);
  if (!nodeBeforePan || !panelBeforePan || !paneBox) throw new Error("Canvas bounds unavailable before pan");
  const panStart = { x: paneBox.x + paneBox.width - 280, y: paneBox.y + paneBox.height - 40 };
  await page.mouse.move(panStart.x, panStart.y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(panStart.x + 120, panStart.y, { steps: 8 });
  await page.mouse.up({ button: "middle" });
  await expect.poll(async () => Number((await generatorNode.boundingBox())?.x)).toBeGreaterThan(nodeBeforePan.x + 100);
  const [nodeAfterPan, panelAfterPan] = await Promise.all([generatorNode.boundingBox(), panel.boundingBox()]);
  expect(Number(panelAfterPan?.x) - Number(nodeAfterPan?.x)).toBeCloseTo(panelBeforePan.x - nodeBeforePan.x, 0);
  expect(Number(panelAfterPan?.y) - Number(nodeAfterPan?.y)).toBeCloseTo(panelBeforePan.y - nodeBeforePan.y, 0);

  await page.evaluate(() => window.localStorage.setItem("forart_test_long_parameter_labels", "true"));
  await page.reload();
  await page.getByRole("button", { name: "Infinite Canvas" }).click();
  await selectNode(page, "image-generator");

  const longPlatform = page.getByRole("combobox", { name: "Platform", exact: true });
  const longModel = page.getByRole("combobox", { name: "Model", exact: true });
  const longSize = page.getByRole("button", { name: "Resolution / Ratio", exact: true });
  const longPanel = longPlatform.locator("xpath=ancestor::*[@data-slot='card'][1]");
  const longPanelBox = await longPanel.boundingBox();

  expect(Number(longPanelBox?.width)).toBeGreaterThan(Number(shortPanelBox?.width) + 100);
  expect(Number(longPanelBox?.width)).toBeLessThanOrEqual(1440 - 32 + 1);
  for (const label of [
    longPlatform.locator('[data-slot="select-value"]'),
    longModel.locator('[data-slot="select-value"]'),
    longSize.locator("span").first(),
  ]) {
    const dimensions = await label.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return {
        contentWidth: range.getBoundingClientRect().width,
        availableWidth: element.getBoundingClientRect().width,
      };
    });
    expect(dimensions.contentWidth).toBeLessThanOrEqual(dimensions.availableWidth + 1);
  }

  await page.setViewportSize({ width: 800, height: 900 });
  await expect.poll(async () => Number((await longPanel.boundingBox())?.width)).toBeLessThanOrEqual(800 - 32 + 1);
  const longPanelViewport = longPanel.locator('[data-slot="scroll-area-viewport"]');
  expect(await longPanelViewport.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(async () => Number((await longPanel.boundingBox())?.width)).toBeGreaterThan(Number(shortPanelBox?.width) + 100);
  await longPlatform.focus();
  await page.keyboard.press("Enter");
  const shortPlatformOption = page.getByRole("option", { name: "Test provider", exact: true });
  await expect(shortPlatformOption).toBeVisible();
  await shortPlatformOption.focus();
  await page.keyboard.press("Enter");
  await expect.poll(async () => Number((await longPanel.boundingBox())?.width)).toBeCloseTo(668, 0);
  const [resizedSizeBox, resizedRunBox] = await Promise.all([longSize.boundingBox(), longPanel.getByRole("button", { name: "Run", exact: true }).boundingBox()]);
  expect(Number(resizedRunBox?.x) - Number(resizedSizeBox?.x) - Number(resizedSizeBox?.width)).toBeGreaterThan(24);
});

test("wraps reference images without scrolling and preserves cross-row drag sorting", async ({ page }) => {
  await page.evaluate(() => window.localStorage.setItem("forart_test_wrapped_references", "true"));
  await page.reload();
  await page.getByRole("button", { name: "Infinite Canvas" }).click();
  await selectNode(page, "image-generator");

  const referenceList = page.getByRole("list", { name: "Connected inputs", exact: true });
  const referenceItems = referenceList.locator(".rf-reference-item");
  const promptReference = referenceList.locator(".rf-prompt-reference-item");
  const actionTile = referenceList.locator(".rf-reference-actions-tile");
  await expect(referenceItems).toHaveCount(11);
  await expect(promptReference).toHaveCount(1);
  await expect(referenceList.locator(".rf-reference-strip__separator")).toHaveCount(1);
  await expect(referenceList).toHaveCSS("overflow-x", "visible");
  const itemRows = await referenceItems.evaluateAll((elements) => (
    [...new Set(elements.map((element) => Math.round(element.getBoundingClientRect().top)))]
  ));
  expect(itemRows.length).toBeGreaterThan(1);
  expect(await referenceList.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  const [listBox, promptReferenceBox, firstReferenceBox] = await Promise.all([
    referenceList.boundingBox(),
    promptReference.boundingBox(),
    referenceItems.first().boundingBox(),
  ]);
  const actionTileBox = await actionTile.boundingBox();
  expect(Number(actionTileBox?.width)).toBeCloseTo(Number(firstReferenceBox?.width), 0);
  expect(Number(actionTileBox?.height)).toBeCloseTo(Number(firstReferenceBox?.height), 0);
  expect(Number(actionTileBox?.y)).toBeCloseTo(Number(firstReferenceBox?.y), 0);
  expect(Number(firstReferenceBox?.x) - Number(promptReferenceBox?.x) - Number(promptReferenceBox?.width)).toBeCloseTo(8, 0);
  const wrappedTileLayout = await referenceList.locator(".rf-prompt-reference-item, .rf-reference-item").evaluateAll((elements) => (
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: Math.round(rect.top) };
    })
  ));
  const wrappedRowTops = [...new Set(wrappedTileLayout.map((item) => item.top))].sort((left, right) => left - right);
  const firstTileOnSecondRow = wrappedTileLayout.find((item) => item.top === wrappedRowTops[1]);
  expect(Number(firstTileOnSecondRow?.left) - Number(listBox?.x)).toBeCloseTo(8, 0);

  const titlesBefore = await referenceItems.evaluateAll((elements) => elements.map((element) => element.getAttribute("title")));
  expect(titlesBefore[0]).toBe("Reference");
  expect(titlesBefore.at(-1)).toBe("Wrapped reference 11");
  const [firstBox, lastBox] = await Promise.all([referenceItems.first().boundingBox(), referenceItems.last().boundingBox()]);
  if (!firstBox || !lastBox) throw new Error("Reference bounds unavailable before drag");
  await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(lastBox.x + lastBox.width / 2, lastBox.y + lastBox.height / 2, { steps: 12 });
  await page.evaluate(() => {
    const samples: Array<{ x: number; y: number }> = [];
    let frames = 0;
    const sampleVisiblePosition = () => {
      const item = document.querySelector<HTMLElement>('.rf-reference-item[title="Reference"]');
      if (item && Number.parseFloat(window.getComputedStyle(item).opacity) > 0.5) {
        const rect = item.getBoundingClientRect();
        samples.push({ x: rect.x, y: rect.y });
      }
      document.documentElement.dataset.referenceDropSamples = JSON.stringify(samples);
      frames += 1;
      if (frames < 24) window.requestAnimationFrame(sampleVisiblePosition);
    };
    window.requestAnimationFrame(sampleVisiblePosition);
  });
  await page.mouse.up();
  await expect.poll(async () => (
    (await referenceItems.evaluateAll((elements) => elements.map((element) => element.getAttribute("title")))).at(-1)
  )).toBe("Reference");
  await page.waitForTimeout(400);
  const dropSamples = JSON.parse(await page.locator("html").getAttribute("data-reference-drop-samples") || "[]") as Array<{ x: number; y: number }>;
  expect(dropSamples.length).toBeGreaterThan(0);
  expect(dropSamples[0].x).toBeCloseTo(lastBox.x, 0);
  expect(dropSamples[0].y).toBeCloseTo(lastBox.y, 0);

  await selectNode(page, "action-fission");
  const groups = page.locator(".rf-action-fission-reference-groups");
  const primaryGroup = groups.locator(".rf-action-fission-reference-group--primary");
  const additionalGroup = groups.locator(".rf-action-fission-reference-group--additional");
  const divider = groups.locator(".rf-action-fission-reference-divider");
  const primaryTitle = primaryGroup.locator(".rf-action-fission-reference-title");
  const additionalTitle = additionalGroup.locator(".rf-action-fission-reference-title");
  const [groupsBox, primaryBox, additionalBox, dividerBox, primaryTitleLeft, additionalTitleLeft] = await Promise.all([
    groups.boundingBox(),
    primaryGroup.boundingBox(),
    additionalGroup.boundingBox(),
    divider.boundingBox(),
    primaryTitle.evaluate((element) => {
      const textNode = element.firstChild;
      if (!textNode?.textContent) return Number.NaN;
      const range = document.createRange();
      range.selectNodeContents(textNode);
      return range.getBoundingClientRect().left;
    }),
    additionalTitle.evaluate((element) => {
      const textNode = element.firstChild;
      if (!textNode?.textContent) return Number.NaN;
      const range = document.createRange();
      range.selectNodeContents(textNode);
      return range.getBoundingClientRect().left;
    }),
  ]);
  expect(Number(additionalBox?.y)).toBeGreaterThanOrEqual(Number(primaryBox?.y) + Number(primaryBox?.height));
  expect(Number(additionalBox?.x)).toBeCloseTo(Number(primaryBox?.x), 0);
  expect(Number(additionalBox?.width)).toBeCloseTo(Number(primaryBox?.width), 0);
  expect(Number(dividerBox?.width)).toBeCloseTo(Number(groupsBox?.width), 0);
  expect(Number(dividerBox?.y)).toBeGreaterThan(Number(primaryBox?.y));
  expect(Number(dividerBox?.y)).toBeLessThan(Number(additionalBox?.y));
  expect(primaryTitleLeft - Number(primaryBox?.x)).toBeCloseTo(8, 0);
  expect(additionalTitleLeft - Number(additionalBox?.x)).toBeCloseTo(8, 0);
});

test("places prompt optimization beside Run and expands from the panel corner", async ({ page }) => {
  await page.evaluate(() => window.localStorage.setItem("forart_test_long_prompt", "true"));
  await page.reload();
  await page.getByRole("button", { name: "Infinite Canvas" }).click();
  await selectNode(page, "image-generator");

  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  const promptShell = page.locator(".rf-image-generator-prompt-shell");
  const optimize = page.getByRole("button", { name: "Optimize", exact: true });
  const expand = page.getByRole("button", { name: "Expand prompt", exact: true });
  const panel = prompt.locator("xpath=ancestor::*[@data-slot='card'][1]");
  const referenceList = panel.getByRole("list", { name: "Connected inputs", exact: true });
  const referenceActionsTile = referenceList.locator(".rf-reference-actions-tile");
  const panelContent = panel.locator('[data-slot="card-content"]');
  const run = panel.getByRole("button", { name: "Run", exact: true });
  const optimizeIcon = optimize.locator("svg");
  const expandIcon = expand.locator("svg");

  await expect(optimize).toHaveText("");
  await expect(optimize).toHaveCSS("height", "32px");
  await expect(optimize).toHaveAttribute("data-variant", "ghost");
  await expect(optimize).toHaveCSS("border-left-width", "0px");
  await expect(optimizeIcon).toHaveCSS("width", "16px");
  await expect(optimizeIcon).toHaveCSS("height", "16px");
  await expect(expand).toHaveCSS("height", "24px");
  await expect(expand).toHaveCSS("width", "24px");
  await expect(expand).toHaveAttribute("data-variant", "outline");
  await expect(expand).toHaveCSS("border-left-width", "1px");
  expect(await expand.evaluate((element) => Number.parseFloat(window.getComputedStyle(element).borderRadius))).toBeGreaterThanOrEqual(12);
  const [expandAppearance, panelAppearance] = await Promise.all([
    expand.evaluate((element) => {
      const style = window.getComputedStyle(element);
      return { backgroundColor: style.backgroundColor, borderColor: style.borderColor, opacity: style.opacity };
    }),
    panel.evaluate((element) => {
      const style = window.getComputedStyle(element);
      return { backgroundColor: style.backgroundColor, borderColor: style.borderColor, opacity: style.opacity };
    }),
  ]);
  expect(expandAppearance).toEqual(panelAppearance);
  await expect(expandIcon).toHaveClass(/lucide-maximize2/);
  await expect(expandIcon).toHaveCSS("width", "14px");
  await expect(expandIcon).toHaveCSS("height", "14px");
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  const [promptBox, optimizeBox, runBox, expandBox, collapsedPanelBox] = await Promise.all([
    prompt.boundingBox(),
    optimize.boundingBox(),
    run.boundingBox(),
    expand.boundingBox(),
    panel.boundingBox(),
  ]);
  expect(Math.abs(Number(optimizeBox?.y) - Number(runBox?.y))).toBeLessThanOrEqual(1);
  expect(Number(runBox?.x) - Number(optimizeBox?.x) - Number(optimizeBox?.width)).toBeCloseTo(8, 0);
  expect(Number(optimizeBox?.y)).toBeGreaterThan(Number(promptBox?.y) + Number(promptBox?.height));
  const expandCenterX = Number(expandBox?.x) + Number(expandBox?.width) / 2;
  const expandCenterY = Number(expandBox?.y) + Number(expandBox?.height) / 2;
  expect(expandCenterX).toBeCloseTo(Number(collapsedPanelBox?.x) + Number(collapsedPanelBox?.width), 0);
  expect(expandCenterY).toBeCloseTo(Number(collapsedPanelBox?.y), 0);
  await expect(panelContent).toHaveCSS("padding-top", "8px");
  await expect(promptShell).toHaveCSS("height", "120px");
  const [referenceListBox, promptShellBox] = await Promise.all([referenceList.boundingBox(), promptShell.boundingBox()]);
  expect(Number(promptShellBox?.y) - Number(referenceListBox?.y) - Number(referenceListBox?.height)).toBeCloseTo(8, 0);
  const [referenceActionsTileBox, promptTextLeft] = await Promise.all([
    referenceActionsTile.boundingBox(),
    prompt.evaluate((element) => {
      const textNode = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode();
      if (!textNode?.textContent) return Number.NaN;
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, 1);
      return range.getBoundingClientRect().left;
    }),
  ]);
  expect(Number(referenceActionsTileBox?.x) - Number(referenceListBox?.x)).toBeCloseTo(8, 0);
  expect(promptTextLeft).toBeCloseTo(Number(referenceActionsTileBox?.x), 0);

  await expand.click();
  const generatorCollapse = page.getByRole("button", { name: "Collapse prompt", exact: true });
  await expect(generatorCollapse).toHaveAttribute("aria-expanded", "true");
  await expect(generatorCollapse.locator("svg")).toHaveClass(/lucide-minimize2/);
  await expect.poll(async () => Number((await promptShell.boundingBox())?.height)).toBeGreaterThan(200);
  await expect.poll(async () => Number((await panel.boundingBox())?.height)).toBeGreaterThan(Number(collapsedPanelBox?.height) + 80);
  await expect.poll(() => page.locator("html").getAttribute("data-prompt-editors-expanded-saved")).toBe("true");

  await selectNode(page, "image-reverse");
  const reverseCollapse = page.getByRole("button", { name: "Collapse prompt", exact: true });
  await expect(reverseCollapse).toHaveAttribute("aria-expanded", "true");
  const reversePromptShell = page.locator("#smart-reverse-instruction-image-reverse").locator("xpath=parent::*");
  await expect(reversePromptShell).toHaveClass(/is-expanded/);
  await reverseCollapse.click();
  await expect.poll(() => page.locator("html").getAttribute("data-prompt-editors-expanded-saved")).toBe("false");

  await selectNode(page, "image-generator");
  await expect(page.getByRole("button", { name: "Expand prompt", exact: true })).toHaveAttribute("aria-expanded", "false");
  await expect(promptShell).toHaveCSS("height", "120px");
});

test("smart reverse reads connected references and uses node-selected chat model", async ({ page }) => {
  const node = page.locator('.react-flow__node[data-id="image-reverse"]');
  await node.locator(".rf-native-node-caption").click();
  const toolbar = page.locator(".rf-native-node-toolbar");
  await expect(toolbar.getByRole("button", { name: "Run" })).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Delete" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Connected inputs" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Reference 1/ })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Platform" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Model" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Reasoning effort" })).toHaveText("Off");
  await page.getByRole("combobox", { name: "Reasoning effort" }).click();
  await page.getByRole("option", { name: "Extra high" }).click();
  const emptyOutput = page.getByRole("textbox", { name: "Smart reverse Prompt" });
  await expect(emptyOutput).toHaveClass(/is-placeholder/);
  await expect(emptyOutput.locator('[data-slot="skeleton"].animate-none')).toHaveCount(3);
  await toolbar.getByRole("button", { name: "Run" }).click();
  const output = page.getByRole("textbox", { name: "Smart reverse Prompt" });
  await expect(output).toHaveAttribute("aria-readonly", "true");
  await expect(output).toHaveText("反推出的主体与服装 Prompt");
  await output.dblclick();
  await expect(output).toHaveClass(/is-selectable/);
  await expect(output).not.toHaveAttribute("contenteditable");
  await expect(node.locator("textarea")).toHaveCount(0);
  await expect.poll(async () => page.locator("html").getAttribute("data-reverse-route")).toBe('{"providerId":"provider-1","model":"test-chat-model"}');
  await expect.poll(async () => page.locator("html").getAttribute("data-reverse-reasoning")).toBe("xhigh");
});

test("smart reverse keeps its running state while switching away and back", async ({ page }) => {
  await page.locator("html").evaluate((element) => {
    element.dataset.delayReverse = "true";
    element.dataset.agentCancelCount = "0";
  });
  const toolbar = await selectNode(page, "image-reverse");
  await toolbar.getByRole("button", { name: "Run" }).click();

  await page.getByRole("tab", { name: "Secondary" }).click();
  await expect(page.locator('.react-flow__node[data-id="image-reverse"]')).toHaveCount(0);
  await page.getByRole("tab", { name: "Toolbar" }).click();
  const restoredToolbar = await selectNode(page, "image-reverse");
  await expect(restoredToolbar.getByRole("button", { name: "Stop" })).toBeVisible();
  await expect(page.getByRole("status", { name: "Smart reversing…" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-agent-cancel-count", "0");
  await expect.poll(() => page.locator("html").getAttribute("data-reverse-completed")).toBe("true");
  await expect(page.getByRole("textbox", { name: "Smart reverse Prompt" })).toHaveText("反推出的主体与服装 Prompt");
  await expect(page.getByText("Smart reverse completed")).toBeVisible();
});

test("smart reverse shows failures that happen while another canvas is active", async ({ page }) => {
  await page.locator("html").evaluate((element) => {
    element.dataset.delayReverse = "true";
    element.dataset.failReverse = "true";
  });
  const toolbar = await selectNode(page, "image-reverse");
  await toolbar.getByRole("button", { name: "Run" }).click();

  await page.getByRole("tab", { name: "Secondary" }).click();
  await expect(page.getByText("Smart reverse failed")).toBeVisible();
  await expect(page.getByText("Mock smart reverse failure")).toBeVisible();

  await page.getByRole("tab", { name: "Toolbar" }).click();
  await selectNode(page, "image-reverse");
  await expect(page.getByRole("alert")).toContainText("Mock smart reverse failure");
});

test("task center only shows image task history", async ({ page }) => {
  await page.getByRole("button", { name: "Task center" }).click();
  await expect(page.getByRole("tab", { name: "Image tasks" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Agent tasks" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "All" })).toBeVisible();
  await expect(page.getByText("Smart reverse")).toHaveCount(0);
});

test("prompt optimization starts immediately and replaces the prompt after the parameter toolbar closes", async ({ page }) => {
  await selectNode(page, "image-generator");
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await expect(prompt).toHaveCSS("padding-left", "8px");
  const optimize = page.getByRole("button", { name: "Optimize" });
  const panel = optimize.locator("xpath=ancestor::*[@data-slot='card'][1]");
  const run = panel.getByRole("button", { name: "Run", exact: true });
  const [optimizeBox, runBox] = await Promise.all([optimize.boundingBox(), run.boundingBox()]);
  expect(Math.abs(Number(optimizeBox?.y) - Number(runBox?.y))).toBeLessThanOrEqual(1);
  expect(Number(optimizeBox?.x)).toBeLessThan(Number(runBox?.x));

  // 唯一可用模型时点击启动按钮左侧的图标直接执行优化，不弹菜单。
  await optimize.click();
  await expect(page.getByRole("textbox", { name: "Optimization request" })).toHaveCount(0);

  await page.locator(".react-flow__pane").click({ position: { x: 20, y: 20 } });
  await page.waitForTimeout(450);

  await selectNode(page, "image-generator");
  await expect(prompt).toContainText("Natural interaction with the referenced accessories");
  await expect(prompt).toHaveCSS("padding-left", "8px");
  await expect(prompt).not.toHaveAttribute("dir", "undefined");
  await expect(page.getByText("Optimization preview")).toHaveCount(0);
  await expect(page.locator('.rf-image-prompt-reference-token')).toHaveCount(1);

  await page.keyboard.press("Control+z");
  await selectNode(page, "image-generator");
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveText("Generate a test image");

  await page.keyboard.press("Control+Shift+z");
  await selectNode(page, "image-generator");
  await expect(prompt).toContainText("Natural interaction with the referenced accessories");
  await expect(prompt).toHaveCSS("padding-left", "8px");
  await expect(prompt).not.toHaveAttribute("dir", "undefined");
});

test("prompt optimization keeps its running state while switching away and back", async ({ page }) => {
  await page.locator("html").evaluate((element) => { element.dataset.delayOptimization = "true"; });
  await selectNode(page, "image-generator");
  const optimize = page.getByRole("button", { name: "Optimize" });
  const run = optimize.locator("xpath=ancestor::*[@data-slot='card'][1]").getByRole("button", { name: "Run", exact: true });
  await optimize.click();

  // 优化进行中：开始按钮禁用，提示词区显示骨架占位。
  await expect(run).toBeDisabled();
  await expect(page.getByRole("status", { name: "Optimizing..." })).toBeVisible();

  await page.waitForTimeout(50);
  await page.getByRole("tab", { name: "Secondary" }).click();
  await page.getByRole("tab", { name: "Toolbar" }).click();
  await selectNode(page, "image-generator");
  await expect(optimize).toBeDisabled();
  await expect(page.getByRole("status", { name: "Optimizing..." })).toBeVisible();
  await expect.poll(() => page.locator("html").getAttribute("data-optimization-completed")).toBe("true");
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toContainText("Natural interaction with the referenced accessories");
  await expect(page.locator('.rf-image-prompt-reference-token')).toHaveCount(1);
});

test("prompt optimization offers a provider menu when multiple chat models are available", async ({ page }) => {
  await page.addInitScript(() => {
    const base = (window as { forartConfig?: Record<string, unknown> }).forartConfig as {
      loadApiSettings: () => Promise<Record<string, unknown>>;
    } & Record<string, unknown>;
    Object.defineProperty(window, "forartConfig", {
      configurable: true,
      value: {
        ...base,
        loadApiSettings: async () => {
          const loaded = await base.loadApiSettings() as { providers: Array<Record<string, unknown>> };
          const secondProvider = {
            ...loaded.providers[0],
            id: "provider-2",
            name: "Second provider",
            imageModels: [],
            chatModels: ["second-chat-model"],
          };
          return { ...loaded, providers: [...loaded.providers, secondProvider] };
        },
      },
    });
  });
  await page.reload();

  await selectNode(page, "image-generator");
  const optimize = page.getByRole("button", { name: "Optimize" });
  await optimize.click();
  await expect(page.getByRole("menuitem", { name: /Test provider/ })).toBeVisible();
  await page.getByRole("menuitem", { name: /Test provider/ }).click();
  await page.getByRole("menuitem", { name: "test-chat-model" }).click();

  await expect.poll(() => page.locator("html").getAttribute("data-optimization-completed")).toBe("true");
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toContainText("Natural interaction with the referenced accessories");
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

test("maps a thumbnail crop selection to original image pixels", async ({ page }) => {
  await page.evaluate(() => window.localStorage.setItem("forart_test_crop_thumbnail", "true"));
  await page.reload();
  await page.getByRole("button", { name: "Infinite Canvas" }).click();

  const toolbar = await selectNode(page, "reference");
  await toolbar.getByRole("button", { name: "Crop image" }).click();
  await expect(page.locator(".rf-native-image-crop-editor img")).toHaveJSProperty("naturalWidth", 400);
  await toolbar.getByRole("combobox", { name: "Crop aspect ratio" }).click();
  await page.getByRole("option", { name: "1:1", exact: true }).click();
  await toolbar.getByRole("button", { name: "Confirm" }).click();

  await expect.poll(() => page.locator("html").getAttribute("data-last-crop-payload")).not.toBeNull();
  const payload = JSON.parse(String(await page.locator("html").getAttribute("data-last-crop-payload")));
  expect(payload).toMatchObject({ x: 500, y: 0, width: 3000, height: 3000 });
  await expect(page.locator('.react-flow__node[data-id="reference"]')).toHaveCount(1);
  await expect(page.locator('.react-flow__node[data-id^="assetLoader_"]')).toHaveCount(1);
  await expect(page.locator('.react-flow__node').filter({ hasText: "Reference-cropped" })).toHaveCount(1);
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
