import { existsSync, statSync } from "node:fs";
import { localNetworkUrls } from "../shared/network-addresses.mjs";

function toIsoFromMs(value) {
  return Number.isFinite(value) && value > 0 ? new Date(value).toISOString() : "";
}

function fileStatPayload(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return {
      exists: false,
      sizeBytes: 0,
      modifiedAt: "",
    };
  }

  const stat = statSync(filePath);
  return {
    exists: true,
    sizeBytes: stat.size,
    modifiedAt: toIsoFromMs(stat.mtimeMs),
  };
}

export function createAdminContext({
  serverHost,
  serverPort,
  startedAt,
  databaseFilename,
  getDataDir,
  getRuntimeDataDir,
  getDatabaseDir,
  getDatabasePath,
  getStorageRoot,
  getCanvasStorageRoot,
  getRepository,
  getDatabaseDriver,
  checkDatabase,
  getAuthRuntime,
  getCanvasSummary,
}) {
  function serverPayload() {
    const local = `http://127.0.0.1:${serverPort}`;
    return {
      ok: true,
      server: {
        host: serverHost,
        port: serverPort,
        startedAt: startedAt.toISOString(),
        uptimeSeconds: Math.max(0, Math.floor((Date.now() - startedAt.getTime()) / 1000)),
        nodeVersion: process.version,
      },
      urls: {
        local,
        lan: localNetworkUrls(serverPort),
        health: `${local}/api/health`,
      },
    };
  }

  async function storagePayload() {
    const databasePath = getDatabasePath();
    const file = fileStatPayload(databasePath);
    const databaseDriver = getDatabaseDriver?.() || "";
    let databaseReady = false;
    if (checkDatabase) {
      try {
        await checkDatabase();
        databaseReady = true;
      } catch {}
    } else if (databaseDriver === "sqlite") {
      databaseReady = file.exists;
    }
    return {
      ok: true,
      storage: {
        dataDir: getDataDir(),
        runtimeDataDir: getRuntimeDataDir?.() || "",
        storageRoot: getStorageRoot(),
        canvasStorageRoot: getCanvasStorageRoot?.() || getStorageRoot(),
        databaseDir: getDatabaseDir(),
        databaseFilename,
        databasePath,
        databaseExists: file.exists,
        databaseSizeBytes: file.sizeBytes,
        databaseModifiedAt: file.modifiedAt,
        databaseDriver,
        databaseReady,
      },
    };
  }

  async function librarySummaryPayload() {
    const repository = getRepository?.();
    if (!repository) return { ok: true, summary: {} };
    return {
      ok: true,
      summary: await Promise.all([
        repository.countKind("library_projects", "model"),
        repository.countKind("library_entries", "model"),
        repository.countKind("library_projects", "outfit"),
        repository.countKind("library_entries", "outfit"),
        repository.countKind("library_projects", "action"),
        repository.countKind("library_entries", "action"),
        repository.countTable("assets"),
      ]).then(([modelProjects, models, outfitProjects, outfits, actionProjects, actions, assets]) => ({
        modelProjects, models, outfitProjects, outfits, actionProjects, actions, assets,
        ...(getCanvasSummary?.() || { canvasProjects: 0, canvases: 0 }),
      })),
    };
  }

  function environmentPayload() {
    return {
      ok: true,
      environment: {
        nodeEnv: process.env.NODE_ENV || "",
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
        language: process.env.FORART_LANGUAGE === "en-US" ? "en-US" : "zh-CN",
        configuredHost: serverHost,
        configuredPort: serverPort,
      },
    };
  }

  return {
    serverPayload,
    storagePayload,
    librarySummaryPayload,
    environmentPayload,
    authRuntime: () => getAuthRuntime?.(),
  };
}
