import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });

const ORIGINAL = "https://canvas-preview.test/original-full.png";
const THUMBNAIL = "https://canvas-preview.test/derived-thumb.webp";
const APP_URL = process.env.FORART_TEST_URL || "http://127.0.0.1:6981/";
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

interface PreviewRequests {
  originals: string[];
  thumbnails: string[];
}

async function countCanvasImageRequests(page: Page): Promise<PreviewRequests> {
  const requests: PreviewRequests = { originals: [], thumbnails: [] };
  await page.route("**/canvas-preview.test/**", async (route) => {
    const url = route.request().url();
    if (url.includes("original-full")) requests.originals.push(url);
    if (url.includes("derived-thumb")) requests.thumbnails.push(url);
    await route.fulfill({ status: 200, contentType: "image/png", body: ONE_PIXEL_PNG });
  });
  return requests;
}

async function bootImageLoaderCanvas(page: Page) {
  await page.addInitScript(({ original, thumbnail }) => {
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
        loadApiSettings: async () => ({ providers: [], defaultImageProviderId: "", providerOrder: [] }),
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
        start: async () => ({ id: "task-preview" }),
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
            nodeCount: 1,
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
          nodes: [{
            id: "image-node",
            type: "canvasNode",
            position: { x: 200, y: 160 },
            style: { width: 320, height: 420 },
            data: {
              kind: "imageLoader",
              label: "Preview",
              imageUrl: original,
              thumbUrl: thumbnail,
              imageFileName: "original-full.png",
              imageNaturalWidth: 3636,
              imageNaturalHeight: 2424,
            },
          }],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        }),
        saveCanvas: async () => ({ ok: true }),
        getCanvasClipboardStatus: async () => ({ hasNodes: false, hasImage: false }),
      },
    });
  }, { original: ORIGINAL, thumbnail: THUMBNAIL });

  await page.goto(APP_URL);
  await page.getByRole("button", { name: "Infinite Canvas" }).click();
  await page.locator('.react-flow__node[data-id="image-node"]').waitFor({ state: "visible", timeout: 30_000 });
}

async function readCanvasZoom(page: Page) {
  return page.locator(".react-flow__viewport").evaluate((element) => {
    const match = (element as HTMLElement).style.transform.match(/scale\(([^)]+)\)/);
    return Number(match?.[1] || 1);
  });
}

async function zoomCanvasTo(page: Page, target: number) {
  const pane = page.locator(".rf-native-flow-surface .react-flow__pane").first();
  const box = await pane.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const current = await readCanvasZoom(page);
    if (Math.abs(current - target) / target < 0.05) return current;
    await page.mouse.wheel(0, current > target ? 60 : -60);
    await page.waitForTimeout(25);
  }
  return readCanvasZoom(page);
}

test("canvas previews keep using the thumbnail past 400% zoom", async ({ page }) => {
  const requests = await countCanvasImageRequests(page);
  await bootImageLoaderCanvas(page);

  const preview = page.locator('.react-flow__node[data-id="image-node"] img.rf-upload-asset-ready');
  await expect(preview).toHaveAttribute("src", THUMBNAIL);
  await expect.poll(() => requests.thumbnails.length).toBeGreaterThan(0);
  expect(requests.originals).toHaveLength(0);

  const zoom = await zoomCanvasTo(page, 5.5);
  expect(zoom).toBeGreaterThan(4.1);
  await page.waitForTimeout(800);

  await expect(preview).toHaveAttribute("src", THUMBNAIL);
  expect(requests.originals).toHaveLength(0);

  await zoomCanvasTo(page, 1);
  await page.waitForTimeout(400);
  await expect(preview).toHaveAttribute("src", THUMBNAIL);
  expect(requests.originals).toHaveLength(0);
});

test("opening the large image viewer still requests the original", async ({ page }) => {
  const requests = await countCanvasImageRequests(page);
  await bootImageLoaderCanvas(page);

  const preview = page.locator('.react-flow__node[data-id="image-node"] img.rf-upload-asset-ready');
  await expect(preview).toHaveAttribute("src", THUMBNAIL);

  await preview.dblclick();

  await expect.poll(() => requests.originals.length).toBeGreaterThan(0);
});
