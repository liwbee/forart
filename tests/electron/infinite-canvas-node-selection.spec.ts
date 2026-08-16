import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("forart_sidebar_open_v2", "true");
    window.localStorage.setItem("forart_infinite_canvas_show_home", "false");
    window.localStorage.setItem("forart_infinite_canvas_last_canvas_id", "canvas-1");

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

    const node = (id: string, x: number, label: string) => ({
      id,
      type: "canvasNode",
      position: { x, y: 140 },
      style: { width: 260, height: 160 },
      data: { kind: "prompt", label },
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
          nodes: [node("node-a", 100, "A"), node("node-b", 520, "B")],
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

async function selectBothNodesWithMarquee(page: Page) {
  const canvas = page.locator(".rf-native-flow-surface");
  const first = await canvas.locator('.react-flow__node[data-id="node-a"]').boundingBox();
  const second = await canvas.locator('.react-flow__node[data-id="node-b"]').boundingBox();
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();

  await page.mouse.move(first!.x - 30, first!.y - 30);
  await page.mouse.down();
  await page.mouse.move(second!.x + second!.width + 30, second!.y + second!.height + 30, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator(".rf-native-multi-selection-frame")).toBeVisible();
}

async function zoomCanvasToRoundedPercent(page: Page, targetPercent: number) {
  const pane = page.locator(".rf-native-flow-surface .react-flow__pane");
  const paneBox = await pane.boundingBox();
  expect(paneBox).not.toBeNull();
  await page.mouse.move(paneBox!.x + paneBox!.width / 2, paneBox!.y + paneBox!.height / 2);

  for (let attempt = 0; attempt < 200; attempt += 1) {
    const zoom = await page.locator(".react-flow__viewport").evaluate((element) => {
      const match = (element as HTMLElement).style.transform.match(/scale\(([^)]+)\)/);
      return Number(match?.[1] || 1);
    });
    if (Math.round(zoom * 100) === targetPercent) return zoom;
    const target = targetPercent / 100;
    const wheelStep = Math.abs(zoom - target) > 0.03 ? 20 : 2;
    await page.mouse.wheel(0, zoom > target ? wheelStep : -wheelStep);
    await page.waitForTimeout(20);
  }

  throw new Error(`Could not reach ${targetPercent}% zoom`);
}

async function readMultiSelectionFrameError(page: Page) {
  return page.evaluate(() => {
    const first = document.querySelector<HTMLElement>('.react-flow__node[data-id="node-a"]');
    const second = document.querySelector<HTMLElement>('.react-flow__node[data-id="node-b"]');
    const frame = document.querySelector<HTMLElement>(".rf-native-multi-selection-frame");
    if (!first || !second || !frame) throw new Error("Selection geometry is unavailable");

    const firstBox = first.getBoundingClientRect();
    const secondBox = second.getBoundingClientRect();
    const frameBox = frame.getBoundingClientRect();
    const expected = {
      left: Math.min(firstBox.left, secondBox.left) - 24,
      top: Math.min(firstBox.top, secondBox.top) - 24,
      right: Math.max(firstBox.right, secondBox.right) + 24,
      bottom: Math.max(firstBox.bottom, secondBox.bottom) + 24,
    };

    return Math.max(
      Math.abs(frameBox.left - expected.left),
      Math.abs(frameBox.top - expected.top),
      Math.abs(frameBox.right - expected.right),
      Math.abs(frameBox.bottom - expected.bottom),
    );
  });
}

test("uses the live marquee paint style with pixel-aligned edges after selection", async ({ page }) => {
  await selectBothNodesWithMarquee(page);
  const frame = page.locator(".rf-native-multi-selection-frame");

  await expect.poll(() => frame.evaluate((element) => element.closest(".react-flow__viewport") === null)).toBe(true);
  await expect(frame).toHaveClass(/react-flow__selection/);

  for (let targetPercent = 80; targetPercent >= 50; targetPercent -= 1) {
    await zoomCanvasToRoundedPercent(page, targetPercent);
    const first = await page.locator('.react-flow__node[data-id="node-a"]').boundingBox();
    const second = await page.locator('.react-flow__node[data-id="node-b"]').boundingBox();
    const frameBox = await frame.boundingBox();
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(frameBox).not.toBeNull();
    const expectedBounds = {
      x: Math.min(first!.x, second!.x) - 24,
      y: Math.min(first!.y, second!.y) - 24,
      width: Math.max(first!.x + first!.width, second!.x + second!.width) - Math.min(first!.x, second!.x) + 48,
      height: Math.max(first!.y + first!.height, second!.y + second!.height) - Math.min(first!.y, second!.y) + 48,
    };
    expect(Math.abs(frameBox!.x - expectedBounds.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(frameBox!.y - expectedBounds.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(frameBox!.width - expectedBounds.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(frameBox!.height - expectedBounds.height)).toBeLessThanOrEqual(1);
    for (const edge of [frameBox!.x, frameBox!.y, frameBox!.x + frameBox!.width, frameBox!.y + frameBox!.height]) {
      expect(Math.abs(edge - Math.round(edge))).toBeLessThanOrEqual(0.01);
    }
    const borderWidths = await frame.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth]
        .map((value) => parseFloat(value));
    });
    expect(borderWidths).toEqual([1, 1, 1, 1]);
  }
});

for (const snapToGrid of [false, true]) {
  test(`keeps the completed selection frame attached while dragging${snapToGrid ? " with grid snapping" : ""}`, async ({ page }) => {
    test.setTimeout(120_000);
    if (snapToGrid) {
      await page.getByRole("button", { name: "Enable snap to grid" }).click();
      await expect(page.getByRole("button", { name: "Disable snap to grid" })).toBeVisible();
    }
    await selectBothNodesWithMarquee(page);

    const first = page.locator('.react-flow__node[data-id="node-a"]');
    for (let targetPercent = 80; targetPercent >= 50; targetPercent -= 1) {
      await zoomCanvasToRoundedPercent(page, targetPercent);
      const initialBox = await first.boundingBox();
      expect(initialBox).not.toBeNull();
      const start = { x: initialBox!.x + 20, y: initialBox!.y + 60 };
      const errors: number[] = [];

      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      for (let step = 1; step <= 6; step += 1) {
        await page.mouse.move(start.x + step * 12, start.y + step * 6);
        errors.push(await readMultiSelectionFrameError(page));
      }
      for (let step = 5; step >= 0; step -= 1) {
        await page.mouse.move(start.x + step * 12, start.y + step * 6);
        errors.push(await readMultiSelectionFrameError(page));
      }
      await page.mouse.up();
      errors.push(await readMultiSelectionFrameError(page));

      expect(
        Math.max(...errors),
        `selection frame drifted at ${targetPercent}%${snapToGrid ? " with grid snapping" : ""}`,
      ).toBeLessThanOrEqual(1);
    }
  });
}

test("keeps alternating nodes selected when a click contains slight pointer movement", async ({ page }) => {
  const canvas = page.locator(".rf-native-flow-surface");
  const pane = canvas.locator(".react-flow__pane");
  const paneBox = await pane.boundingBox();
  expect(paneBox).not.toBeNull();

  for (let iteration = 0; iteration < 10; iteration += 1) {
    const pointerJitter = (iteration % 3) + 1;
    for (const id of ["node-a", "node-b"]) {
      const node = canvas.locator(`.react-flow__node[data-id="${id}"]`);
      const box = await node.boundingBox();
      expect(box).not.toBeNull();

      await page.mouse.move(box!.x + 20, box!.y + 60);
      await page.mouse.down();
      await page.mouse.move(box!.x + 20 + pointerJitter, box!.y + 60);
      await page.mouse.move(box!.x + 20, box!.y + 60);
      await page.mouse.up();

      await expect(node).toHaveClass(/selected/);
      await expect(page.locator(".rf-native-node-toolbar")).toHaveCount(1);

      await page.mouse.click(paneBox!.x + paneBox!.width - 80, paneBox!.y + paneBox!.height / 2);
      await expect(page.locator(".rf-native-node-toolbar")).toHaveCount(0);
    }
  }
});

test("still starts dragging after the pointer passes the click tolerance", async ({ page }) => {
  const node = page.locator('.rf-native-flow-surface .react-flow__node[data-id="node-a"]');
  const initialBox = await node.boundingBox();
  expect(initialBox).not.toBeNull();

  await page.mouse.move(initialBox!.x + 20, initialBox!.y + 60);
  await page.mouse.down();
  await page.mouse.move(initialBox!.x + 60, initialBox!.y + 60, { steps: 5 });
  await page.mouse.up();

  const draggedBox = await node.boundingBox();
  expect(draggedBox).not.toBeNull();
  expect(draggedBox!.x).toBeGreaterThan(initialBox!.x + 20);
  await expect(node).toHaveClass(/selected/);
  await expect(page.locator(".rf-native-node-toolbar")).toHaveCount(1);
});
