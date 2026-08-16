import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { createCanvasExchangeContext } from "../src/canvas-exchange/canvas-exchange-context.mjs";
import { PACKAGE_FORMAT } from "../src/canvas-exchange/canvas-exchange-types.mjs";

test("direct canvas exchange uploads resources without a package archive", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "forart-direct-canvas-exchange-"));
  try {
    const context = createCanvasExchangeContext({ getStorageRoot: () => root });
    const project = context.store.createProject({ title: "Direct upload project" }).project;
    const bytes = Buffer.from("direct-canvas-resource");
    const started = context.store.beginCanvasUpload({
      projectId: project.id,
      canvas: {
        id: "local_canvas",
        title: "Direct canvas",
        canvasSchemaVersion: 2,
        nodes: [{ id: "image-node", type: "imageLoader", data: { imageUrl: "forart-package://asset/asset_001" } }],
        edges: [],
        viewport: { x: 0, y: 0, scale: 1 },
      },
      manifest: {
        format: PACKAGE_FORMAT,
        version: 1,
        canvas: { title: "Direct canvas", nodeCount: 1 },
        assets: [{ id: "asset_001", kind: "input", packagePath: "assets/input/image_001.png", fileName: "image_001.png", sizeBytes: bytes.length }],
        warnings: [],
      },
    });

    await context.store.receiveCanvasAsset(started.canvasId, "asset_001", Readable.from(bytes), bytes.length);
    const completed = context.store.completeCanvasUpload(started.canvasId);
    assert.equal(completed.ok, true);
    assert.equal(completed.canvas.assetCount, 1);

    const transfer = context.store.loadCanvasTransfer(started.canvasId);
    const imageUrl = transfer.canvas.nodes[0].data.imageUrl;
    assert.match(imageUrl, new RegExp(`/api/canvas-exchange/canvases/${started.canvasId}/assets/`));
    assert.equal(transfer.manifest.assets.length, 1);
    const storedPath = context.paths.assetAbsolutePath(transfer.manifest.assets[0].relativePath);
    assert.deepEqual(readFileSync(storedPath), bytes);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("direct canvas exchange completes canvases without resources", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "forart-direct-empty-canvas-"));
  try {
    const context = createCanvasExchangeContext({ getStorageRoot: () => root });
    const started = context.store.beginCanvasUpload({
      canvas: { id: "empty", title: "Empty canvas", nodes: [], connections: [], groups: [] },
      manifest: {
        format: PACKAGE_FORMAT,
        version: 1,
        canvas: { title: "Empty canvas", nodeCount: 0 },
        assets: [],
        warnings: [],
      },
    });

    const completed = context.store.completeCanvasUpload(started.canvasId);
    assert.equal(completed.canvas.assetCount, 0);
    assert.deepEqual(context.store.loadCanvasTransfer(started.canvasId).manifest.assets, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("failed direct canvas finalization removes resources already moved to final storage", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "forart-direct-canvas-rollback-"));
  try {
    const context = createCanvasExchangeContext({ getStorageRoot: () => root });
    const bytes = Buffer.from("first-resource");
    const started = context.store.beginCanvasUpload({
      canvas: { id: "rollback", title: "Rollback canvas", nodes: [] },
      manifest: {
        format: PACKAGE_FORMAT,
        version: 1,
        canvas: { title: "Rollback canvas", nodeCount: 0 },
        assets: [
          { id: "asset_001", kind: "input", packagePath: "assets/input/first.png", fileName: "first.png", sizeBytes: bytes.length },
          { id: "asset_002", kind: "input", packagePath: "assets/input/missing.png", fileName: "missing.png", sizeBytes: 10 },
        ],
        warnings: [],
      },
    });
    await context.store.receiveCanvasAsset(started.canvasId, "asset_001", Readable.from(bytes), bytes.length);

    assert.throws(() => context.store.completeCanvasUpload(started.canvasId), /resource is missing/i);
    assert.deepEqual(readdirSync(context.paths.inputRoot()), []);
    context.store.cancelCanvasUpload(started.canvasId);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("canvas exchange initialization removes stale direct-upload sessions", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "forart-direct-canvas-stale-"));
  try {
    const staleSession = path.join(root, "CanvasAssests", "tmp", "upload-remote_canvas_stale");
    mkdirSync(staleSession, { recursive: true });
    const staleTime = new Date(Date.now() - (48 * 60 * 60 * 1000));
    utimesSync(staleSession, staleTime, staleTime);

    createCanvasExchangeContext({ getStorageRoot: () => root });
    assert.equal(existsSync(staleSession), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
