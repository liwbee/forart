import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(repoRoot, "renderer/src/features/infinite-canvas/libtvSyncQueue.ts");
const source = await fs.readFile(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ES2020,
    strict: true,
  },
});
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "forart-libtv-sync-"));
const modulePath = path.join(tempDir, "libtvSyncQueue.mjs");
await fs.writeFile(modulePath, compiled.outputText, "utf8");
const { LibtvRemotePatchQueue } = await import(pathToFileURL(modulePath).href);

function createManualTimers() {
  const timers = new Map();
  let nextId = 1;
  return {
    setTimeout(callback) {
      const id = nextId;
      nextId += 1;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    run(id) {
      const callback = timers.get(id);
      if (!callback) return;
      timers.delete(id);
      callback();
    },
    pendingIds() {
      return [...timers.keys()];
    },
  };
}

async function tick() {
  await Promise.resolve();
  await Promise.resolve();
}

{
  const timers = createManualTimers();
  const flushed = [];
  const queue = new LibtvRemotePatchQueue({
    onFlush: (nodeId, patch) => flushed.push({ nodeId, patch }),
    setTimeout: timers.setTimeout.bind(timers),
    clearTimeout: timers.clearTimeout.bind(timers),
  });

  queue.queue("node-a", { text: "first" });
  queue.queue("node-a", { text: "second", model: "m1" });
  assert.deepEqual(queue.getPendingNodeIds(), ["node-a"]);
  assert.equal(timers.pendingIds().length, 1);
  timers.run(timers.pendingIds()[0]);
  await tick();
  assert.deepEqual(flushed, [{ nodeId: "node-a", patch: { text: "second", model: "m1" } }]);
  assert.equal(queue.hasPending(), false);
}

{
  const flushed = [];
  const queue = new LibtvRemotePatchQueue({
    onFlush: (nodeId, patch) => flushed.push({ nodeId, patch }),
  });

  queue.queue("node-b", { text: "now" }, { flush: true });
  await tick();
  assert.deepEqual(flushed, [{ nodeId: "node-b", patch: { text: "now" } }]);
  assert.equal(queue.hasPending("node-b"), false);
}

{
  const timers = createManualTimers();
  const flushed = [];
  const queue = new LibtvRemotePatchQueue({
    onFlush: (nodeId, patch) => flushed.push({ nodeId, patch }),
    setTimeout: timers.setTimeout.bind(timers),
    clearTimeout: timers.clearTimeout.bind(timers),
  });

  queue.queue("node-manual", { text: "draft" }, { debounceMs: null });
  assert.equal(queue.hasPending("node-manual"), true);
  assert.equal(timers.pendingIds().length, 0);
  await tick();
  assert.deepEqual(flushed, []);
  queue.flushNode("node-manual");
  await tick();
  assert.deepEqual(flushed, [{ nodeId: "node-manual", patch: { text: "draft" } }]);
}

{
  let shouldFail = true;
  const queue = new LibtvRemotePatchQueue({
    onFlush: async () => {
      if (shouldFail) throw new Error("remote down");
    },
  });

  queue.queue("node-c", { text: "retry me" }, { flush: true });
  await tick();
  assert.equal(queue.hasPending("node-c"), true);
  shouldFail = false;
  queue.flushNode("node-c");
  await tick();
  assert.equal(queue.hasPending("node-c"), false);
}

{
  let resolveFlush;
  const queue = new LibtvRemotePatchQueue({
    onFlush: () => new Promise((resolve) => {
      resolveFlush = resolve;
    }),
  });

  queue.queue("node-in-flight", { x: 10, y: 20 }, { flush: true });
  assert.equal(queue.hasPending("node-in-flight"), true);
  resolveFlush();
  await tick();
  assert.equal(queue.hasPending("node-in-flight"), false);
}

{
  const flushed = [];
  const queue = new LibtvRemotePatchQueue({
    onFlush: (nodeId, patch) => flushed.push({ nodeId, patch }),
  });

  queue.queue("node-d", { text: "keep" });
  queue.clearNode("node-d");
  queue.flushAll();
  await tick();
  assert.deepEqual(flushed, []);
  assert.equal(queue.hasPending(), false);
}

console.log("libtv sync queue tests passed");
