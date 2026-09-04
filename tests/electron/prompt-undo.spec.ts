import { expect, test, type Page } from "@playwright/test";

// 撤销能力诊断矩阵：智能优化 / 手动输入 / 编辑器滚动 各场景下 Ctrl+Z 的行为。
// 已知机制背景：
// - 画布级历史（zundo）记录 text/imagePromptDocument 等持久字段；
// - ReactFlowCanvasPage 的 Ctrl+Z 快捷键在焦点位于 contenteditable/input 时跳过，
//   交给 Lexical 编辑器自身历史；
// - 智能优化结果是编程写入的，Lexical 自身历史里没有对应条目。

test.use({ viewport: { width: 1440, height: 900 } });

const APP_URL = process.env.FORART_TEST_URL || "http://127.0.0.1:6981/";
const ORIGINAL_PROMPT = "Generate a test image";

test.beforeEach(async ({ page }) => {
  await page.addInitScript((originalPrompt) => {
    window.localStorage.setItem("forart_sidebar_open_v2", "true");
    window.localStorage.setItem("forart_infinite_canvas_show_home", "false");
    window.localStorage.setItem("forart_infinite_canvas_last_canvas_id", "canvas-undo");
    window.localStorage.setItem("forart_infinite_canvas_open_tabs", JSON.stringify([
      { id: "canvas-undo", title: "Undo", projectId: "project-1", createdAt: 1, updatedAt: 1, revision: 1, nodeCount: 1 },
    ]));

    const provider = {
      id: "provider-1", name: "Test provider", baseUrl: "https://example.invalid/v1", apiKey: "test-key",
      protocol: "openai", imageRequestMode: "openai", imageGenerationEndpoint: "", imageEditEndpoint: "",
      imageModels: ["test-image-model"],
      chatModels: window.localStorage.getItem("forart_prompt_undo_multiple_chat_models") === "true"
        ? ["test-chat-model", "test-chat-model-2"]
        : ["test-chat-model"],
      videoModels: [],
      modelAliases: { image: {}, chat: {}, video: {} }, modelRules: { image: {} }, hasApiKey: true,
    };
    Object.defineProperty(window, "forartWindow", {
      configurable: true,
      value: { isMaximized: async () => ({ ok: true, maximized: false }), onMaximizedChanged: () => () => undefined },
    });
    Object.defineProperty(window, "forartConfig", {
      configurable: true,
      value: {
        load: async () => ({ mode: "local", language: "en-US" }),
        loadApiSettings: async () => ({ providers: [provider], defaultImageProviderId: provider.id, providerOrder: [provider.id] }),
        loadAgentSettings: async () => ({ thinkingMode: false, reasoningLevel: "medium", imageGeneratorPromptOptimization: { providerId: provider.id, model: "test-chat-model" } }),
        appInfo: async () => ({ name: "Forart", repoUrl: "", updateUrl: "", currentRevision: "test", currentUpdatedAt: "" }),
        checkUpdate: async () => ({ ok: true, currentRevision: "test", latestRevision: "test", currentUpdatedAt: "", latestUpdatedAt: "", updateAvailable: false, repoUrl: "" }),
        onUpdateProgress: () => () => undefined,
        serverSession: async () => ({ ok: false, status: 401 }),
      },
    });
    Object.defineProperty(window, "forartCanvasTasks", {
      configurable: true,
      value: { listPage: async () => ({ tasks: [], total: 0, counts: { all: 0, active: 0, succeeded: 0, exceptional: 0 } }) },
    });
    Object.defineProperty(window, "forartGenerationTasks", {
      configurable: true,
      value: {
        start: async () => ({ id: "task-1" }), get: async () => null,
        stop: async () => ({ ok: true }), list: async () => ({ tasks: [] }), onChanged: () => () => undefined,
      },
    });
    Object.defineProperty(window, "forartCanvasAgent", {
      configurable: true,
      value: {
        run: async (request: { runId: string; task: string; context?: { prompt?: string } }) => {
          await new Promise((resolve) => window.setTimeout(resolve, 300));
          const result = request.task === "optimize-image-generator-prompt"
            ? {
                optimizedPrompt: window.localStorage.getItem("forart_prompt_undo_reference_result") === "true"
                  ? "@Image 1 Cinematic optimized prompt with rim light"
                  : "Cinematic optimized prompt with rim light",
                preserved: [], changes: [], warnings: [],
              }
            : {};
          return result;
        },
        cancel: async () => ({ ok: true, canceled: false }),
        listActive: async () => [],
        onProgress: () => () => undefined,
      },
    });
    Object.defineProperty(window, "easyTool", {
      configurable: true,
      value: {
        loadCanvas: async () => ({
          id: "canvas-undo", title: "Undo", projectId: "project-1", createdAt: 1, updatedAt: 1, revision: 1, canvasSchemaVersion: 2,
          nodes: [{
            id: "image-generator", type: "canvasNode", position: { x: 200, y: 200 }, style: { width: 420, height: 360 },
            data: { kind: "imageGenerator", label: "Generator", text: originalPrompt, imageProviderId: provider.id, imageModel: "test-image-model" },
          }, {
            id: "reference-image", type: "canvasNode", position: { x: 20, y: 200 }, style: { width: 120, height: 120 },
            data: { kind: "imageLoader", label: "Reference", imageUrl: "data:image/png;base64,iVBORw0KGgo=" },
          }],
          edges: [{
            id: "reference-edge", type: "default", source: "reference-image", sourceHandle: "output",
            target: "image-generator", targetHandle: "input", data: { inputKind: "referenceImage", referenceOrder: 0 },
          }], viewport: { x: 0, y: 0, zoom: 1 },
        }),
        saveCanvas: async () => ({ ok: true }),
        getCanvasClipboardStatus: async () => ({ hasNodes: false, hasImage: false }),
        listCanvases: async () => ({
          projects: [{ id: "project-1", title: "P", sortOrder: 1, createdAt: 1, updatedAt: 1 }],
          canvases: [{ id: "canvas-undo", title: "Undo", projectId: "project-1", createdAt: 1, updatedAt: 1, revision: 1, nodeCount: 1 }],
        }),
      },
    });
  }, ORIGINAL_PROMPT);

  await page.goto(APP_URL);
  await page.getByRole("button", { name: "Infinite Canvas" }).click();
});

async function selectGenerator(page: Page) {
  const node = page.locator('.react-flow__node[data-id="image-generator"]');
  await expect(node).toBeVisible();
  await node.locator(".rf-native-node-caption").click();
  const toolbar = page.locator(".rf-native-node-toolbar");
  await expect(toolbar).toBeVisible();
  return toolbar;
}

async function readPrompt(page: Page) {
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await expect(prompt).toBeVisible();
  return prompt.textContent() || "";
}

async function runOptimization(page: Page) {
  await page.getByRole("button", { name: "Optimize" }).click();
  await expect.poll(async () => readPrompt(page)).toContain("Cinematic optimized");
}

test("undo restores the optimized prompt when focus is outside the editor", async ({ page }) => {
  await selectGenerator(page);
  await runOptimization(page);

  // 焦点停在优化按钮上（非编辑元素），Ctrl+Z 应走画布历史。
  await page.keyboard.press("Control+z");
  await selectGenerator(page);
  expect(await readPrompt(page)).toBe(ORIGINAL_PROMPT);
});

test("undo restores the optimized prompt when focus is inside the editor", async ({ page }) => {
  const toolbar = await selectGenerator(page);
  await runOptimization(page);

  // 常见路径：优化完成后点击提示词查看结果，再按 Ctrl+Z —— 焦点在 contenteditable 内，
  // 画布快捷键被跳过，Lexical 自身历史又没有这条编程写入的变更。
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await prompt.click();
  await page.keyboard.press("Control+z");
  await expect(toolbar).toBeVisible();
  expect(await readPrompt(page)).toBe(ORIGINAL_PROMPT);
});

test("undo inside the editor reverts manual typing", async ({ page }) => {
  await selectGenerator(page);
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await prompt.click();
  await page.keyboard.insertText(" typed tail");
  await expect.poll(async () => readPrompt(page)).toContain("typed tail");

  await page.keyboard.press("Control+z");
  expect(await readPrompt(page)).toBe(ORIGINAL_PROMPT);
});

test("canvas undo reverts a whole typing session after leaving the editor", async ({ page }) => {
  await selectGenerator(page);
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await prompt.click();
  await page.keyboard.type(" typed tail");
  await page.locator(".react-flow__pane").click({ position: { x: 30, y: 30 } });
  await page.waitForTimeout(200);

  await page.keyboard.press("Control+z");
  await selectGenerator(page);
  expect(await readPrompt(page)).toBe(ORIGINAL_PROMPT);
});

test("one undo restores a dragged node to its previous position", async ({ page }) => {
  const node = page.locator('.react-flow__node[data-id="image-generator"]');
  const caption = node.locator(".rf-native-node-caption");
  await expect(node).toBeVisible();
  const before = await node.boundingBox();
  if (!before) throw new Error("Generator bounds unavailable before drag");
  const beforeCenter = { x: before.x + before.width / 2, y: before.y + before.height / 2 };

  const handle = await caption.boundingBox();
  if (!handle) throw new Error("Generator drag handle unavailable");
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 140, handle.y + handle.height / 2 + 70, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => {
    const after = await node.boundingBox();
    return after ? Math.round(Math.abs(after.x + after.width / 2 - beforeCenter.x)) : 0;
  }).toBeGreaterThan(50);

  await page.keyboard.press("Control+z");

  await expect.poll(async () => {
    const restored = await node.boundingBox();
    return restored ? Math.round(restored.x + restored.width / 2) : 0;
  }).toBe(Math.round(beforeCenter.x));
  await expect.poll(async () => {
    const restored = await node.boundingBox();
    return restored ? Math.round(restored.y + restored.height / 2) : 0;
  }).toBe(Math.round(beforeCenter.y));
});

test("scrolling the prompt editor does not block undo of the optimization", async ({ page }) => {
  await selectGenerator(page);
  await runOptimization(page);

  // 编辑器内部滚动是 DOM 局部状态，不应进入历史或影响撤销。
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await prompt.click();
  await page.mouse.wheel(0, 240);
  await page.mouse.wheel(0, -120);
  await page.locator(".react-flow__pane").click({ position: { x: 30, y: 30 } });

  await page.keyboard.press("Control+z");
  await selectGenerator(page);
  expect(await readPrompt(page)).toBe(ORIGINAL_PROMPT);
});

test("undo restores the optimized prompt after closing and reopening the parameter panel", async ({ page }) => {
  await selectGenerator(page);
  await runOptimization(page);

  await page.locator(".react-flow__pane").click({ position: { x: 30, y: 30 } });
  await expect(page.locator(".rf-native-node-toolbar")).toBeHidden();
  await selectGenerator(page);

  await page.keyboard.press("Control+z");
  await selectGenerator(page);
  expect(await readPrompt(page)).toBe(ORIGINAL_PROMPT);
});

test("one undo restores the prompt when optimization returns a structured image reference", async ({ page }) => {
  await page.evaluate(() => window.localStorage.setItem("forart_prompt_undo_reference_result", "true"));
  await selectGenerator(page);
  await runOptimization(page);

  await page.keyboard.press("Control+z");
  expect(await readPrompt(page)).toBe(ORIGINAL_PROMPT);
});

test("one undo restores the manually edited prompt after optimization", async ({ page }) => {
  await selectGenerator(page);
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await prompt.click();
  await page.keyboard.insertText(" typed before optimization");
  const editedPrompt = `${ORIGINAL_PROMPT} typed before optimization`;
  await expect.poll(async () => readPrompt(page)).toBe(editedPrompt);

  await runOptimization(page);
  await prompt.click();
  await page.keyboard.press("Control+z");

  expect(await readPrompt(page)).toBe(editedPrompt);
});

test("one undo restores the prompt when using the Agent settings model", async ({ page }) => {
  await page.evaluate(() => window.localStorage.setItem("forart_prompt_undo_multiple_chat_models", "true"));
  await page.reload();
  await page.getByRole("button", { name: "Infinite Canvas" }).click();
  await selectGenerator(page);

  await page.getByRole("button", { name: "Optimize" }).click();
  await expect.poll(async () => readPrompt(page)).toContain("Cinematic optimized");

  await page.keyboard.press("Control+z");
  expect(await readPrompt(page)).toBe(ORIGINAL_PROMPT);
});

test("repeated optimizations undo one step at a time", async ({ page }) => {
  await selectGenerator(page);
  await runOptimization(page);
  await page.getByRole("button", { name: "Optimize" }).click();
  await expect.poll(async () => readPrompt(page)).toContain("Cinematic optimized");

  await page.keyboard.press("Control+z");
  await selectGenerator(page);
  expect(await readPrompt(page)).toBe(ORIGINAL_PROMPT);
});

test("redo inside the editor reapplies the optimized prompt", async ({ page }) => {
  await selectGenerator(page);
  await runOptimization(page);

  let prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await prompt.click();
  await page.keyboard.press("Control+z");
  await selectGenerator(page);
  expect(await readPrompt(page)).toBe(ORIGINAL_PROMPT);

  prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await prompt.click();
  await page.keyboard.press("Control+Shift+z");
  await selectGenerator(page);
  expect(await readPrompt(page)).toContain("Cinematic optimized");
});
