import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { registerLocalApiIpc } = require("../../electron/main/ipc/local-api-ipc.cjs");

test("Local IPC serializes concurrent SQLite initialization and path changes", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "forart-local-ipc-"));
  const firstLibrary = path.join(root, "library-one");
  const secondLibrary = path.join(root, "library-two");
  let currentLibrary = firstLibrary;
  const handlers = new Map();
  const ipcMain = { handle(channel, handler) { handlers.set(channel, handler); } };
  const configStore = { load() { return { localLibraryPath: currentLibrary, language: "zh-CN" }; } };
  const localApi = registerLocalApiIpc({ ipcMain, configStore, app: {}, dataRoot: root });
  const request = handlers.get("local-api:request");

  try {
    assert.equal(typeof request, "function");
    const firstResponses = await Promise.all(Array.from({ length: 20 }, () => request(null, { method: "GET", path: "/api/model-projects" })));
    assert.equal(firstResponses.every((response) => response.ok && response.body.projects.length === 1), true);
    assert.equal(existsSync(path.join(firstLibrary, ".forart", "database", "forart-library.sqlite")), true);
    assert.equal(existsSync(path.join(root, "forart_data")), true);

    currentLibrary = secondLibrary;
    const secondResponses = await Promise.all(Array.from({ length: 20 }, () => request(null, { method: "GET", path: "/api/action-projects" })));
    assert.equal(secondResponses.every((response) => response.ok && response.body.projects.length === 1), true);
    assert.equal(existsSync(path.join(secondLibrary, ".forart", "database", "forart-library.sqlite")), true);
  } finally {
    await localApi.close();
    rmSync(root, { recursive: true, force: true });
  }
});
