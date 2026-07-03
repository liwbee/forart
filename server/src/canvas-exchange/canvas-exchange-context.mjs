import crypto from "node:crypto";
import { createCanvasExchangeIndex } from "./canvas-exchange-index.mjs";
import { createCanvasExchangePackages } from "./canvas-exchange-packages.mjs";
import { createCanvasExchangePaths } from "./canvas-exchange-paths.mjs";
import { createCanvasExchangeStore } from "./canvas-exchange-store.mjs";

export function createCanvasExchangeContext({ getStorageRoot }) {
  const paths = createCanvasExchangePaths({ getStorageRoot });
  const index = createCanvasExchangeIndex(paths);
  const packages = createCanvasExchangePackages(paths);
  const store = createCanvasExchangeStore({ paths, index, packages });

  return {
    getStorageRoot,
    newId: (prefix = "") => {
      const base = crypto.randomUUID().replace(/-/g, "");
      return prefix ? `${prefix}_${base}` : base;
    },
    nowIso: () => new Date().toISOString(),
    paths,
    store,
  };
}

