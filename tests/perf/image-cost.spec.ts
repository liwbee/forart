import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
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
  thumbFile: string;
  width: number;
  height: number;
}

async function buildAssets(count: number): Promise<PerfAsset[]> {
  const names = fs.readdirSync(ORIG_DIR).filter((name) => name.toLowerCase().endsWith(".png")).sort();
  const picked: PerfAsset[] = [];
  for (const name of names) {
    if (picked.length >= count) break;
    const file = path.join(ORIG_DIR, name);
    const thumbFile = path.join(THUMB_DIR, `${name.replace(/\.png$/i, "")}.webp`);
    if (!fs.existsSync(thumbFile)) continue;
    const meta = await sharp(file).metadata();
    picked.push({
      served: `orig-${picked.length}.png`,
      thumbServed: `thumb-${picked.length}.webp`,
      file,
      thumbFile,
      width: meta.width || 0,
      height: meta.height || 0,
    });
  }
  return picked;
}

async function serveAssets(page: Page, assets: PerfAsset[]) {
  const byName = new Map<string, { file: string; type: string; size: number }>();
  for (const asset of assets) {
    byName.set(asset.served, { file: asset.file, type: "image/png", size: fs.statSync(asset.file).size });
    byName.set(asset.thumbServed, { file: asset.thumbFile, type: "image/webp", size: fs.statSync(asset.thumbFile).size });
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

const GRID_COLUMNS = 8;
const NODE_WIDTH = 260;
const NODE_HEIGHT = 340;
const GRID_GAP = 40;

function canvasFixture(assets: PerfAsset[]) {
  return {
    id: "canvas-1",
    title: "Perf canvas",
    projectId: "project-1",
    createdAt: 1,
    updatedAt: 1,
    revision: 1,
    canvasSchemaVersion: 2,
    nodes: assets.map((asset, index) => ({
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
    })),
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

async function bootCanvas(page: Page, assets: PerfAsset[]) {
  const fixture = canvasFixture(assets);
  await page.addInitScript((canvas) => {
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
      value: { isMaximized: async () => ({ ok: true, maximized: false }), onMaximizedChanged: () => () => undefined },
    });
    Object.defineProperty(window, "forartConfig", {
      configurable: true,
      value: {
        load: async () => config,
        save: async (next: typeof config) => ({ ok: true, config: next }),
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
            nodeCount: canvas.nodes.length,
          }],
        }),
        loadCanvas: async () => canvas,
        saveCanvas: async () => ({ ok: true }),
        getCanvasClipboardStatus: async () => ({ hasNodes: false, hasImage: false }),
      },
    });
  }, fixture);

  await page.goto("http://127.0.0.1:6981/");
  await page.getByRole("button", { name: "Infinite Canvas" }).click();
  await page.locator(".react-flow__node").first().waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete), null, { timeout: 30_000 });
}

async function readZoom(page: Page) {
  return page.locator(".react-flow__viewport").evaluate((element) => {
    const match = (element as HTMLElement).style.transform.match(/scale\(([^)]+)\)/);
    return Number(match?.[1] || 1);
  });
}

async function zoomTo(page: Page, target: number) {
  const pane = page.locator(".rf-native-flow-surface .react-flow__pane").first();
  const box = await pane.boundingBox();
  if (!box) throw new Error("pane not measurable");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const current = await readZoom(page);
    if (Math.abs(current - target) / target < 0.05) return current;
    const step = Math.abs(current - target) > target * 0.4 ? 60 : 12;
    await page.mouse.wheel(0, current > target ? step : -step);
    await page.waitForTimeout(25);
  }
  return readZoom(page);
}

async function readRendererMemoryMB(page: Page) {
  const browser = page.context().browser();
  if (!browser) return null;
  const session = await browser.newBrowserCDPSession();
  try {
    const { processInfo } = await session.send("SystemInfo.getProcessInfo");
    const renderers = processInfo.filter((entry) => entry.type === "renderer");
    if (!renderers.length) return null;
    const idList = renderers.map((entry) => `-Id ${entry.id}`).join(", ");
    const output = execFileSync("powershell", [
      "-NoProfile",
      "-Command",
      `(Get-Process ${idList} -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum`,
    ], { encoding: "utf8", windowsHide: true });
    const total = Number(output.trim());
    return {
      rendererCount: renderers.length,
      totalMB: Number.isFinite(total) ? Number((total / 1048576).toFixed(1)) : null,
      perProcessMB: renderers.map((entry) => {
        const single = execFileSync("powershell", [
          "-NoProfile",
          "-Command",
          `(Get-Process -Id ${entry.id} -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum`,
        ], { encoding: "utf8", windowsHide: true });
        const value = Number(single.trim());
        return { pid: entry.id, mb: Number.isFinite(value) ? Number((value / 1048576).toFixed(1)) : null };
      }),
    };
  } finally {
    await session.detach();
  }
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
    };
  });
}

async function measureDecode(page: Page, assets: PerfAsset[], useThumb: boolean, rounds: number) {
  return page.evaluate(async ({ list, thumb, times }) => {
    const results: { ms: number; bytes: number; w: number; h: number }[] = [];
    for (let index = 0; index < times; index += 1) {
      const target = list[index % list.length];
      const url = thumb ? target.thumb : target.orig;
      const image = new Image();
      image.decoding = "async";
      image.src = `${url}?decode=${index}`;
      const startedAt = performance.now();
      await image.decode();
      results.push({
        ms: Number((performance.now() - startedAt).toFixed(1)),
        bytes: target.bytes,
        w: image.naturalWidth,
        h: image.naturalHeight,
      });
      image.src = "";
    }
    const times2 = results.map((entry) => entry.ms).sort((left, right) => left - right);
    return {
      rounds: results.length,
      medianMs: times2[Math.floor(times2.length / 2)],
      maxMs: times2[times2.length - 1],
      firstMs: results[0].ms,
      decodedMB: Number(((results[0].w * results[0].h * 4) / 1048576).toFixed(1)),
      samples: results.slice(0, 4),
    };
  }, {
    list: assets.map((asset) => ({
      orig: `http://127.0.0.1:6981/perf-assets/${asset.served}`,
      thumb: `http://127.0.0.1:6981/perf-assets/${asset.thumbServed}`,
      bytes: fs.statSync(asset.file).size,
    })),
    thumb: useThumb,
    times: rounds,
  });
}

const ASSET_COUNT = Number(process.env.PERF_ASSET_COUNT || 16);

test("decode cost: original versus thumbnail", async ({ page }) => {
  const assets = await buildAssets(ASSET_COUNT);
  await serveAssets(page, assets);
  await bootCanvas(page, assets);

  const rows = {
    originals: await measureDecode(page, assets, false, 8),
    thumbnails: await measureDecode(page, assets, true, 8),
    sourceSizes: assets.slice(0, 4).map((asset) => ({
      name: path.basename(asset.file),
      bytes: fs.statSync(asset.file).size,
      size: `${asset.width}x${asset.height}`,
      thumbBytes: fs.statSync(asset.thumbFile).size,
    })),
  };
  console.log(`[PERF-decode] ${JSON.stringify(rows)}`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "decode-cost.json"), JSON.stringify(rows, null, 2));
});

test("renderer memory while zooming across the 400% original-image threshold", async ({ page }) => {
  const assets = await buildAssets(ASSET_COUNT);
  await serveAssets(page, assets);
  await bootCanvas(page, assets);

  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable");
  await page.waitForTimeout(1200);

  const rows: unknown[] = [];
  const record = async (label: string) => {
    const row = {
      label,
      zoom: Number((await readZoom(page)).toFixed(2)),
      dom: await readDomInfo(page),
      renderer: await readRendererMemoryMB(page),
    };
    rows.push(row);
    console.log(`[PERF-mem] ${JSON.stringify(row)}`);
  };

  await record("boot-thumbs");
  for (let round = 1; round <= 3; round += 1) {
    await zoomTo(page, 5.5);
    await page.waitForTimeout(1200);
    await record(`round-${round}-zoom-5.5x`);
    await zoomTo(page, 1);
    await page.waitForTimeout(800);
    await record(`round-${round}-zoom-1x-thumbs`);
  }
  await zoomTo(page, 0.2);
  await page.waitForTimeout(1500);
  await record("zoom-0.2x-all-nodes");

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "renderer-memory.json"), JSON.stringify(rows, null, 2));
});

async function sampleWithPurge(page: Page, client: import("@playwright/test").CDPSession) {
  const before = await readRendererMemoryMB(page);
  await client.send("HeapProfiler.enable");
  await client.send("HeapProfiler.collectGarbage");
  await client.send("Memory.forciblyPurgeCaches").catch(() => undefined);
  await page.waitForTimeout(400);
  const after = await readRendererMemoryMB(page);
  return { before, after };
}

test("control: off-screen originals (decoded but never composited)", async ({ page }) => {
  const assets = await buildAssets(4);
  await serveAssets(page, assets);
  const urls = assets.map((asset) => ({
    thumb: `http://127.0.0.1:6981/perf-assets/${asset.thumbServed}`,
    orig: `http://127.0.0.1:6981/perf-assets/${asset.served}`,
  }));

  await page.setContent(`<body style="margin:0;background:#111;position:relative">
    <div style="position:absolute;left:-20000px;top:0">${urls.map((url, index) => `<img id="o${index}" src="${url.thumb}" style="width:640px">`).join("")}</div>
  </body>`);
  await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete));

  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable");
  await client.send("Memory.enable").catch(() => undefined);
  await page.waitForTimeout(1000);

  const rows: unknown[] = [];
  const record = async (label: string) => {
    await client.send("HeapProfiler.enable");
    await client.send("HeapProfiler.collectGarbage");
    await client.send("Memory.forciblyPurgeCaches").catch(() => undefined);
    await page.waitForTimeout(400);
    const row = { label, memory: await readRendererMemoryMB(page) };
    rows.push(row);
    console.log(`[PERF-offscreen] ${JSON.stringify(row)}`);
  };

  const rounds = Number(process.env.PERF_SWAP_ROUNDS || 6);
  await record("baseline-thumbs");
  for (let round = 0; round < rounds; round += 1) {
    for (const field of ["orig", "thumb"] as const) {
      await page.evaluate(({ list, key }) => {
        list.forEach((url, index) => {
          const image = document.getElementById(`o${index}`) as HTMLImageElement;
          image.src = url[key];
        });
      }, { list: urls, key: field });
      await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete));
      await page.waitForTimeout(300);
    }
  }
  await record(`after-${rounds}-offscreen-swap-rounds`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "offscreen-swap.json"), JSON.stringify(rows, null, 2));
});

test("control: swapping to a mid-size derivative instead of the original", async ({ page }) => {
  const assets = await buildAssets(4);
  const midName = (index: number) => `mid-${index}.webp`;
  const smallName = (index: number) => `small-${index}.webp`;
  const midBuffers = await Promise.all(assets.map(async (asset, index) => ({
    name: midName(index),
    buffer: await sharp(asset.file).resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer(),
  })));
  const smallBuffers = await Promise.all(assets.map(async (asset, index) => ({
    name: smallName(index),
    buffer: await sharp(asset.file).resize({ width: 640, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer(),
  })));

  const byName = new Map<string, { body: Buffer; type: string }>();
  for (const asset of assets) {
    byName.set(asset.served, { body: fs.readFileSync(asset.file), type: "image/png" });
    byName.set(asset.thumbServed, { body: fs.readFileSync(asset.thumbFile), type: "image/webp" });
  }
  for (const mid of midBuffers) byName.set(mid.name, { body: mid.buffer, type: "image/webp" });
  for (const small of smallBuffers) byName.set(small.name, { body: small.buffer, type: "image/webp" });
  await page.route("**/perf-assets/**", async (route) => {
    const requested = path.basename(new URL(route.request().url()).pathname);
    const entry = byName.get(requested);
    if (!entry) {
      await route.fulfill({ status: 404, body: "missing" });
      return;
    }
    await route.fulfill({ status: 200, contentType: entry.type, body: entry.body });
  });

  const urls = assets.map((asset, index) => ({
    thumb: `http://127.0.0.1:6981/perf-assets/${asset.thumbServed}`,
    small: `http://127.0.0.1:6981/perf-assets/${smallName(index)}`,
    mid: `http://127.0.0.1:6981/perf-assets/${midName(index)}`,
    orig: `http://127.0.0.1:6981/perf-assets/${asset.served}`,
  }));

  await page.setContent(`<body style="margin:0;background:#111">${urls.map((url, index) => `<img id="i${index}" src="${url.thumb}" style="width:640px">`).join("")}</body>`);
  await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete));

  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable");
  await client.send("Memory.enable").catch(() => undefined);
  await page.waitForTimeout(1200);

  const rows: unknown[] = [];
  const record = async (label: string) => {
    await client.send("HeapProfiler.enable");
    await client.send("HeapProfiler.collectGarbage");
    await client.send("Memory.forciblyPurgeCaches").catch(() => undefined);
    await page.waitForTimeout(400);
    const row = { label, memory: await readRendererMemoryMB(page) };
    rows.push(row);
    console.log(`[PERF-mid] ${JSON.stringify(row)}`);
  };

  const swap = async (key: "thumb" | "small" | "mid" | "orig", rounds: number) => {
    for (let round = 0; round < rounds; round += 1) {
      for (const target of [key, "thumb"] as const) {
        await page.evaluate(({ list, field }) => {
          list.forEach((url, index) => {
            const image = document.getElementById(`i${index}`) as HTMLImageElement;
            image.src = url[field];
          });
        }, { list: urls, field: target });
        await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete));
        await page.waitForTimeout(300);
      }
    }
  };

  await record("baseline-thumbs");
  await swap("small", 5);
  await record("after-5x-thumb-to-640px-small");
  await swap("mid", 5);
  await record("after-5x-thumb-to-1600px-mid");
  await swap("orig", 5);
  await record("after-5x-thumb-to-original");

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "mid-size-swap.json"), JSON.stringify(rows, null, 2));
});

test("control: bare Chromium swapping img src between thumbnail and original", async ({ page }) => {
  const assets = await buildAssets(Number(process.env.PERF_BARE_IMAGES || 4));
  await serveAssets(page, assets);
  const urls = assets.map((asset) => ({
    thumb: `http://127.0.0.1:6981/perf-assets/${asset.thumbServed}`,
    orig: `http://127.0.0.1:6981/perf-assets/${asset.served}`,
  }));

  await page.setContent(`<body style="margin:0;background:#111">${urls.map((url, index) => `<img id="i${index}" src="${url.thumb}" style="width:640px">`).join("")}</body>`);
  await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete));

  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable");
  await client.send("Memory.enable").catch(() => undefined);
  await page.waitForTimeout(1200);

  const rows: unknown[] = [];
  const record = async (label: string) => {
    const before = await readRendererMemoryMB(page);
    await client.send("HeapProfiler.enable");
    await client.send("HeapProfiler.collectGarbage");
    await client.send("Memory.forciblyPurgeCaches").catch(() => undefined);
    await page.waitForTimeout(400);
    const row = { label, memory: { before, after: await readRendererMemoryMB(page) } };
    rows.push(row);
    console.log(`[PERF-bare] ${JSON.stringify(row)}`);
  };

  const totalRounds = Number(process.env.PERF_SWAP_ROUNDS || 12);
  await record("baseline-thumbs");
  for (let round = 1; round <= totalRounds; round += 1) {
    await page.evaluate((list) => {
      list.forEach((url, index) => {
        const image = document.getElementById(`i${index}`) as HTMLImageElement;
        image.src = url.orig;
      });
    }, urls);
    await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete));
    await page.waitForTimeout(400);
    await page.evaluate((list) => {
      list.forEach((url, index) => {
        const image = document.getElementById(`i${index}`) as HTMLImageElement;
        image.src = url.thumb;
      });
    }, urls);
    await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete));
    await page.waitForTimeout(400);
    if (round % 3 === 0) await record(`after-${round}-swap-rounds`);
  }
  await record(`after-${totalRounds}-swap-rounds`);
  await page.waitForTimeout(30_000);
  await record(`after-${totalRounds}-swap-rounds-plus-30s-idle`);
  await client.send("Memory.simulatePressureNotification", { level: "critical" }).catch(() => undefined);
  await page.waitForTimeout(3_000);
  await record(`after-critical-memory-pressure`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "bare-image-swap.json"), JSON.stringify(rows, null, 2));
});

test("control: zooming inside the thumbnail range versus across the 400% threshold", async ({ page }) => {
  const assets = await buildAssets(ASSET_COUNT);
  await serveAssets(page, assets);
  await bootCanvas(page, assets);

  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable");
  await client.send("Memory.enable").catch(() => undefined);
  await page.waitForTimeout(1500);

  const rows: unknown[] = [];
  const record = async (label: string) => {
    const memory = await sampleWithPurge(page, client);
    const row = { label, zoom: Number((await readZoom(page)).toFixed(2)), dom: await readDomInfo(page), memory };
    rows.push(row);
    console.log(`[PERF-control] ${JSON.stringify(row)}`);
  };

  await record("baseline");
  const rounds = Number(process.env.PERF_CONTROL_ROUNDS || 5);

  for (let round = 1; round <= rounds; round += 1) {
    await zoomTo(page, 2.2);
    await page.waitForTimeout(700);
  }
  await zoomTo(page, 1);
  await page.waitForTimeout(700);
  await record(`after-${rounds}x-zoom-between-1-and-2.2-thumbnails-only`);

  for (let round = 1; round <= rounds; round += 1) {
    await zoomTo(page, 5.5);
    await page.waitForTimeout(700);
    await zoomTo(page, 1);
    await page.waitForTimeout(400);
    if (round % 2 === 0) await record(`after-${round}-crossings`);
  }
  await record(`after-${rounds}x-crossing-400-percent`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "zoom-threshold-control.json"), JSON.stringify(rows, null, 2));
});

test("interaction cost scales with the number of mounted nodes", async ({ page }) => {
  const assets = await buildAssets(48);
  await serveAssets(page, assets);
  await bootCanvas(page, assets);
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

  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable");
  await page.waitForTimeout(1500);

  const rows: unknown[] = [];
  const pan = async (durationMs: number) => {
    const pane = page.locator(".rf-native-flow-surface .react-flow__pane").first();
    const box = await pane.boundingBox();
    if (!box) throw new Error("pane not measurable");
    await page.evaluate(() => {
      const state = (window as unknown as { __perfFrames: { frames: number[]; sampling: boolean; last: number } }).__perfFrames;
      state.frames = [];
      state.last = 0;
      state.sampling = true;
    });
    const before = await client.send("Performance.getMetrics");
    const beforeMap = new Map(before.metrics.map((metric) => [metric.name, metric.value]));
    const startX = box.x + box.width * 0.4;
    const startY = box.y + box.height * 0.4;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    const startedAt = Date.now();
    let step = 0;
    while (Date.now() - startedAt < durationMs) {
      step += 1;
      await page.mouse.move(startX + (step % 2 ? 20 : -20), startY + (step % 5) - 2);
      await page.waitForTimeout(8);
    }
    await page.mouse.up();
    const after = await client.send("Performance.getMetrics");
    const afterMap = new Map(after.metrics.map((metric) => [metric.name, metric.value]));
    const delta = (name: string) => Number(((afterMap.get(name) || 0) - (beforeMap.get(name) || 0)).toFixed(3));
    const frames = await page.evaluate(() => {
      const state = (window as unknown as { __perfFrames: { frames: number[]; sampling: boolean } }).__perfFrames;
      state.sampling = false;
      const sorted = state.frames.slice().sort((left, right) => left - right);
      return {
        samples: sorted.length,
        p50: Number((sorted[Math.floor(sorted.length * 0.5)] || 0).toFixed(1)),
        p95: Number((sorted[Math.floor(sorted.length * 0.95)] || 0).toFixed(1)),
        max: Number((sorted[sorted.length - 1] || 0).toFixed(1)),
        over32ms: sorted.filter((value) => value > 32).length,
      };
    });
    return {
      frames,
      taskMs: Number((delta("TaskDuration") * 1000).toFixed(0)),
      scriptMs: Number((delta("ScriptDuration") * 1000).toFixed(0)),
      styleMs: Number((delta("RecalcStyleDuration") * 1000).toFixed(0)),
      layoutMs: Number((delta("LayoutDuration") * 1000).toFixed(0)),
      layoutCount: delta("LayoutCount"),
      styleCount: delta("RecalcStyleCount"),
    };
  };

  for (const target of [0.25, 0.5, 1, 2]) {
    await zoomTo(page, target);
    await page.waitForTimeout(900);
    const row = {
      targetZoom: target,
      zoom: Number((await readZoom(page)).toFixed(2)),
      dom: await readDomInfo(page),
      pan: await pan(1200),
    };
    rows.push(row);
    console.log(`[PERF-scale] ${JSON.stringify(row)}`);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "interaction-scaling.json"), JSON.stringify(rows, null, 2));
});
