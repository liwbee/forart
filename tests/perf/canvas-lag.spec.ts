import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ORIG_DIR = path.join(ROOT, "CanvasAssests", "output");
const THUMB_DIR = path.join(ORIG_DIR, "thumb");
const OUT_DIR = path.join(ROOT, ".tmp", "perf");

interface PerfAsset {
  served: string;
  thumbServed: string;
  file: string;
  width: number;
  height: number;
}

function pickAssets(count: number): PerfAsset[] {
  const names = fs.readdirSync(ORIG_DIR)
    .filter((name) => name.toLowerCase().endsWith(".png"))
    .sort();
  const picked: PerfAsset[] = [];
  for (let index = 0; index < names.length && picked.length < count; index += 1) {
    const name = names[index];
    const file = path.join(ORIG_DIR, name);
    const base = name.replace(/\.png$/i, "");
    if (!fs.existsSync(path.join(THUMB_DIR, `${base}.webp`))) continue;
    picked.push({
      served: `orig-${picked.length}.png`,
      thumbServed: `thumb-${picked.length}.webp`,
      file,
      width: 0,
      height: 0,
    });
  }
  return picked;
}

async function withDimensions(assets: PerfAsset[]) {
  const withDims = await Promise.all(assets.map(async (asset) => {
    const meta = await sharp(asset.file).metadata();
    return { ...asset, width: meta.width || 0, height: meta.height || 0 };
  }));
  return withDims;
}

async function serveAssets(page: Page, assets: PerfAsset[]) {
  const byName = new Map<string, { file: string; type: string }>();
  for (const asset of assets) {
    byName.set(asset.served, { file: asset.file, type: "image/png" });
    const thumbFile = path.join(THUMB_DIR, `${path.basename(asset.file).replace(/\.png$/i, "")}.webp`);
    byName.set(asset.thumbServed, { file: thumbFile, type: "image/webp" });
  }
  await page.route("**/perf-assets/**", async (route) => {
    const requested = path.basename(new URL(route.request().url()).pathname);
    const entry = byName.get(requested);
    if (!entry) {
      await route.fulfill({ status: 404, body: "missing" });
      return;
    }
    await route.fulfill({ status: 200, contentType: entry.type, body: fs.readFileSync(entry.file) });
  });
}

const GRID_COLUMNS = 6;
const NODE_WIDTH = 320;
const NODE_HEIGHT = 420;
const GRID_GAP = 60;

function canvasFixture(assets: PerfAsset[]) {
  const nodes = assets.map((asset, index) => ({
    id: `img-${index}`,
    type: "canvasNode",
    position: {
      x: (index % GRID_COLUMNS) * (NODE_WIDTH + GRID_GAP),
      y: Math.floor(index / GRID_COLUMNS) * (NODE_HEIGHT + GRID_GAP),
    },
    style: { width: NODE_WIDTH, height: NODE_HEIGHT },
    data: {
      kind: "imageLoader",
      label: `Image ${index}`,
      imageUrl: `http://127.0.0.1:6981/perf-assets/${asset.served}`,
      thumbUrl: `http://127.0.0.1:6981/perf-assets/${asset.thumbServed}`,
      imageFileName: path.basename(asset.file),
      imageNaturalWidth: asset.width,
      imageNaturalHeight: asset.height,
    },
  }));
  return {
    id: "canvas-1",
    title: "Perf canvas",
    projectId: "project-1",
    createdAt: 1,
    updatedAt: 1,
    revision: 1,
    canvasSchemaVersion: 2,
    nodes,
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

async function bootCanvas(page: Page, assets: PerfAsset[]) {
  const canvas = canvasFixture(assets);
  await page.addInitScript((fixture) => {
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
        appInfo: async () => ({ name: "Forart", repoUrl: "", updateUrl: "", currentRevision: "perf", currentUpdatedAt: "" }),
        checkUpdate: async () => ({
          ok: true,
          currentRevision: "perf",
          latestRevision: "perf",
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
        start: async () => ({ id: "task-perf" }),
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
          projects: [{ id: "project-1", title: "Perf project", sortOrder: 1, createdAt: 1, updatedAt: 1 }],
          canvases: [{
            id: "canvas-1",
            title: "Perf canvas",
            projectId: "project-1",
            createdAt: 1,
            updatedAt: 1,
            revision: 1,
            nodeCount: fixture.nodes.length,
          }],
        }),
        loadCanvas: async () => fixture,
        saveCanvas: async () => ({ ok: true }),
        getCanvasClipboardStatus: async () => ({ hasNodes: false, hasImage: false }),
      },
    });
  }, canvas);

  await page.goto("http://127.0.0.1:6981/");
  await page.getByRole("button", { name: "Infinite Canvas" }).click();
  await page.locator(".react-flow__node").first().waitFor({ state: "visible", timeout: 30_000 });
  await expect.poll(async () => page.locator(".react-flow__node").count(), { timeout: 30_000 })
    .toBeGreaterThan(0);
  await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete), null, { timeout: 30_000 });
}

async function installFrameSampler(page: Page) {
  await page.evaluate(() => {
    const state = { frames: [] as number[], sampling: false, last: 0 };
    (window as unknown as { __perfFrames: typeof state }).__perfFrames = state;
    const tick = (time: number) => {
      if (state.sampling) {
        if (state.last) state.frames.push(time - state.last);
        state.last = time;
      } else {
        state.last = 0;
      }
      window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
  });
}

async function frameSampleStart(page: Page) {
  await page.evaluate(() => {
    const state = (window as unknown as { __perfFrames: { frames: number[]; sampling: boolean; last: number } }).__perfFrames;
    state.frames = [];
    state.last = 0;
    state.sampling = true;
  });
}

async function frameSampleStop(page: Page) {
  return page.evaluate(() => {
    const state = (window as unknown as { __perfFrames: { frames: number[]; sampling: boolean } }).__perfFrames;
    state.sampling = false;
    const frames = state.frames.slice().sort((left, right) => left - right);
    const at = (ratio: number) => frames.length ? frames[Math.min(frames.length - 1, Math.floor(frames.length * ratio))] : 0;
    return {
      samples: frames.length,
      p50: Number(at(0.5).toFixed(1)),
      p95: Number(at(0.95).toFixed(1)),
      max: Number((frames.length ? frames[frames.length - 1] : 0).toFixed(1)),
      janky: frames.filter((value) => value > 32).length,
    };
  });
}

async function readPerfMetrics(client: import("@playwright/test").CDPSession) {
  const { metrics } = await client.send("Performance.getMetrics");
  const map = new Map(metrics.map((metric) => [metric.name, metric.value]));
  const get = (name: string) => Number(map.get(name) || 0);
  return {
    heapMB: Number((get("JSHeapUsedSize") / 1048576).toFixed(1)),
    domNodes: get("Nodes"),
    listeners: get("JSEventListeners"),
    documents: get("Documents"),
    layoutCount: get("LayoutCount"),
    recalcStyleCount: get("RecalcStyleCount"),
    taskDuration: Number(get("TaskDuration").toFixed(2)),
    scriptDuration: Number(get("ScriptDuration").toFixed(2)),
    layoutDuration: Number(get("LayoutDuration").toFixed(3)),
    styleDuration: Number(get("RecalcStyleDuration").toFixed(3)),
  };
}

async function readDomInfo(page: Page) {
  return page.evaluate(() => {
    const images = Array.from(document.images);
    const decodedPixels = images.reduce((sum, image) => sum + image.naturalWidth * image.naturalHeight, 0);
    return {
      nodeCount: document.querySelectorAll(".react-flow__node").length,
      imgCount: images.length,
      decodedMB: Number(((decodedPixels * 4) / 1048576).toFixed(1)),
      originalSrcs: images.filter((image) => image.currentSrc.includes("/orig-")).length,
      thumbSrcs: images.filter((image) => image.currentSrc.includes("/thumb-")).length,
      broken: images.filter((image) => image.complete && image.naturalWidth === 0).length,
    };
  });
}

async function readDomHistogram(page: Page) {
  return page.evaluate(() => {
    const counts = new Map<string, number>();
    for (const element of Array.from(document.querySelectorAll("*"))) {
      const className = typeof element.className === "string" && element.className
        ? `.${element.className.trim().split(/\s+/).slice(0, 2).join(".")}`
        : "";
      const key = `${element.tagName.toLowerCase()}${className}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return Object.fromEntries([...counts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 25));
  });
}

async function forceGc(client: import("@playwright/test").CDPSession) {
  await client.send("HeapProfiler.enable");
  await client.send("HeapProfiler.collectGarbage");
}

async function readListenerReport(client: import("@playwright/test").CDPSession) {
  const { result } = await client.send("Runtime.evaluate", { expression: "window", returnByValue: false });
  if (!result.objectId) return { window: {}, anchored: 0 } as Record<string, unknown>;
  const { listeners } = await client.send("DOMDebugger.getEventListeners", {
    objectId: result.objectId,
    depth: 1,
    pierce: true,
  });
  const byType = new Map<string, number>();
  let withHandler = 0;
  for (const listener of listeners) {
    byType.set(listener.type, (byType.get(listener.type) || 0) + 1);
    if (listener.handler) withHandler += 1;
  }
  return {
    total: listeners.length,
    withHandler,
    types: Object.fromEntries([...byType.entries()].sort((left, right) => right[1] - left[1]).slice(0, 15)),
  };
}

async function measureSustainedPan(page: Page, durationMs: number) {
  const pane = page.locator(".rf-native-flow-surface .react-flow__pane").first();
  const box = await pane.boundingBox();
  if (!box) throw new Error("canvas pane is not measurable");
  const startX = box.x + box.width * 0.35;
  const startY = box.y + box.height * 0.4;

  await frameSampleStart(page);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  const startedAt = Date.now();
  let step = 0;
  while (Date.now() - startedAt < durationMs) {
    step += 1;
    await page.mouse.move(startX + (step % 2 ? 18 : -18) + (step % 5) * 3, startY + (step % 7) - 3);
    await page.waitForTimeout(8);
  }
  await page.mouse.up();
  return frameSampleStop(page);
}

async function zoomBy(page: Page, wheelDelta: number, times: number) {
  const pane = page.locator(".rf-native-flow-surface .react-flow__pane").first();
  const box = await pane.boundingBox();
  if (!box) throw new Error("canvas pane is not measurable");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let index = 0; index < times; index += 1) {
    await page.mouse.wheel(0, wheelDelta);
    await page.waitForTimeout(30);
  }
}

async function readZoom(page: Page) {
  return page.locator(".react-flow__viewport").evaluate((element) => {
    const match = (element as HTMLElement).style.transform.match(/scale\(([^)]+)\)/);
    return Number(match?.[1] || 1);
  });
}

const ASSET_COUNT = Number(process.env.PERF_ASSET_COUNT || 24);
const CYCLES = Number(process.env.PERF_CYCLES || 10);

test("sustained canvas interaction stays flat while no new content is added", async ({ page }) => {
  const assets = await withDimensions(pickAssets(ASSET_COUNT));
  expect(assets.length).toBe(ASSET_COUNT);
  await serveAssets(page, assets);
  await bootCanvas(page, assets);
  await installFrameSampler(page);

  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable");
  await page.waitForTimeout(1500);

  const rows: unknown[] = [];
  for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
    await zoomBy(page, -120, 6);
    await zoomBy(page, 120, 6);
    const frames = await measureSustainedPan(page, 1200);
    const metrics = await readPerfMetrics(client);
    const dom = await readDomInfo(page);
    const row = { cycle, frames, metrics, dom, zoom: await readZoom(page) };
    rows.push(row);
    console.log(`[PERF-static] ${JSON.stringify(row)}`);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "static-interaction.json"), JSON.stringify(rows, null, 2));
});

test("interaction accumulates DOM and listeners outside the visible nodes", async ({ page }) => {
  const assets = await withDimensions(pickAssets(ASSET_COUNT));
  await serveAssets(page, assets);
  await bootCanvas(page, assets);
  await installFrameSampler(page);

  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable");
  await page.waitForTimeout(1500);

  const snapshots: unknown[] = [];
  const snapshot = async (label: string) => {
    await forceGc(client);
    const entry = {
      label,
      metrics: await readPerfMetrics(client),
      dom: await readDomInfo(page),
      histogram: await readDomHistogram(page),
      listeners: await readListenerReport(client),
    };
    snapshots.push(entry);
    console.log(`[PERF-attribution] ${JSON.stringify(entry)}`);
  };

  await snapshot("boot");
  for (let cycle = 1; cycle <= 9; cycle += 1) {
    await zoomBy(page, -120, 6);
    await zoomBy(page, 120, 6);
    await measureSustainedPan(page, 1200);
    if (cycle % 3 === 0) await snapshot(`cycle-${cycle}`);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "dom-listener-attribution.json"), JSON.stringify(snapshots, null, 2));
});

test("zooming past 400% swaps every node to the original image", async ({ page }) => {
  const assets = await withDimensions(pickAssets(ASSET_COUNT));
  await serveAssets(page, assets);
  await bootCanvas(page, assets);
  await installFrameSampler(page);

  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable");
  await page.waitForTimeout(1500);

  const rows: unknown[] = [];
  const record = async (label: string) => {
    const frames = await measureSustainedPan(page, 1200);
    const row = { label, frames, metrics: await readPerfMetrics(client), dom: await readDomInfo(page), zoom: await readZoom(page) };
    rows.push(row);
    console.log(`[PERF-swap] ${JSON.stringify(row)}`);
  };

  await record("baseline-thumbnails");
  await zoomBy(page, -120, 40);
  await page.waitForTimeout(500);
  await record("zoom-in-originals");
  await zoomBy(page, 120, 40);
  await page.waitForTimeout(500);
  await record("zoom-out-back-to-thumbs");

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "zoom-image-swap.json"), JSON.stringify(rows, null, 2));
});
