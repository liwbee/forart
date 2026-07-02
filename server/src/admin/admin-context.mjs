import { existsSync, statSync } from "node:fs";
import { networkInterfaces } from "node:os";

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

function localNetworkUrls(port) {
  const urls = [];
  for (const interfaces of Object.values(networkInterfaces())) {
    for (const item of interfaces || []) {
      if (item.family === "IPv4" && !item.internal) {
        urls.push(`http://${item.address}:${port}`);
      }
    }
  }
  return urls;
}

export function createAdminContext({
  serverHost,
  serverPort,
  startedAt,
  databaseFilename,
  getDataDir,
  getDatabaseDir,
  getDatabasePath,
  getStorageRoot,
  getDb,
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

  function storagePayload() {
    const databasePath = getDatabasePath();
    const file = fileStatPayload(databasePath);
    return {
      ok: true,
      storage: {
        dataDir: getDataDir(),
        storageRoot: getStorageRoot(),
        databaseDir: getDatabaseDir(),
        databaseFilename,
        databasePath,
        databaseExists: file.exists,
        databaseSizeBytes: file.sizeBytes,
        databaseModifiedAt: file.modifiedAt,
      },
    };
  }

  function countTable(tableName) {
    const database = getDb();
    if (!database) return 0;
    return database.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get()?.count || 0;
  }

  function librarySummaryPayload() {
    return {
      ok: true,
      summary: {
        modelProjects: countTable("model_projects"),
        models: countTable("model_entries"),
        outfitProjects: countTable("outfit_projects"),
        outfits: countTable("outfit_entries"),
        actionProjects: countTable("action_projects"),
        actions: countTable("action_entries"),
        assets: countTable("assets"),
      },
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
  };
}

