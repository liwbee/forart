import assert from "node:assert/strict";
import test from "node:test";
import { createAdminContext } from "../src/admin/admin-context.mjs";

function contextForDatabase(checkDatabase) {
  return createAdminContext({
    serverHost: "127.0.0.1",
    serverPort: 6980,
    startedAt: new Date("2026-08-14T00:00:00.000Z"),
    databaseFilename: "postgresql",
    getDataDir: () => "/library",
    getRuntimeDataDir: () => "/forart_data",
    getDatabaseDir: () => "",
    getDatabasePath: () => "",
    getStorageRoot: () => "/library",
    getCanvasStorageRoot: () => "/library/canvas",
    getRepository: () => null,
    getDatabaseDriver: () => "postgres",
    checkDatabase,
    getAuthRuntime: () => null,
    getCanvasSummary: () => ({ canvasProjects: 0, canvases: 0 }),
  });
}

test("PostgreSQL reports ready from a live check without a database file path", async () => {
  const payload = await contextForDatabase(async () => {}).storagePayload();

  assert.equal(payload.storage.databaseDriver, "postgres");
  assert.equal(payload.storage.databaseExists, false);
  assert.equal(payload.storage.databaseReady, true);
});

test("PostgreSQL reports unavailable when the live check fails", async () => {
  const payload = await contextForDatabase(async () => { throw new Error("offline"); }).storagePayload();

  assert.equal(payload.storage.databaseExists, false);
  assert.equal(payload.storage.databaseReady, false);
});
