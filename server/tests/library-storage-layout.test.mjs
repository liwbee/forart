import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { reconcileLibraryStorage } from "../src/library/library-storage-layout.mjs";

function unchangedLibraryRuntime(entryCount) {
  const storageRoot = path.resolve("virtual-library-root");
  const project = { id: "project-1", name: "Project", cover_asset_id: null };
  const entries = Array.from({ length: entryCount }, (_, index) => ({
    id: `entry-${index}`,
    name: `Entry ${index}`,
    project_id: project.id,
  }));
  const links = entries.map((entry, index) => {
    const filename = `${entry.name}_001.png`;
    return {
      id: `link-${index}`,
      entry_id: entry.id,
      project_id: project.id,
      kind: "model",
      asset_id: `asset-${index}`,
      storage_key: path.relative(storageRoot, path.join(storageRoot, "Model Library", project.name, entry.name, filename)),
      filename,
      mime_type: "image/png",
      sort_order: 0,
      created_at: "2026-08-14T00:00:00.000Z",
    };
  });
  const linkByEntry = new Map(links.map((link) => [link.entry_id, link]));
  const counters = { entryAssetBatches: 0, ownerBatches: 0, updates: 0 };
  const repository = {
    async listProjects(kind) { return kind === "model" ? [project] : []; },
    async listEntries() { return entries; },
    async listEntryAssetsForEntries(_kind, entryIds) {
      counters.entryAssetBatches += 1;
      return entryIds.map((entryId) => linkByEntry.get(entryId));
    },
    async listEntryAssetLinksForAssets(assetIds) {
      counters.ownerBatches += 1;
      const requested = new Set(assetIds);
      return links.filter((link) => requested.has(link.asset_id));
    },
    async updateAsset() { counters.updates += 1; },
    async getAsset() { throw new Error("project cover lookup should not run"); },
    async listEntryAssets() { throw new Error("per-entry asset queries should not run"); },
    async entryAssetReferenceCount() { throw new Error("per-asset reference queries should not run"); },
  };
  return {
    counters,
    runtime: {
      repository,
      storageRoot,
      labels: {
        modelLibrary: "Model Library",
        outfitLibrary: "Outfit Library",
        actionLibrary: "Action Library",
      },
    },
  };
}

test("startup reconciliation batches unchanged assets without database writes", async () => {
  const { runtime, counters } = unchangedLibraryRuntime(1_000);

  await reconcileLibraryStorage(runtime);

  assert.equal(counters.entryAssetBatches, 2);
  assert.equal(counters.ownerBatches, 1);
  assert.equal(counters.updates, 0);
});
