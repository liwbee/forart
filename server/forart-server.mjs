import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAdminContext } from "./src/admin/admin-context.mjs";
import { createAdminRouter } from "./src/http/admin-router.mjs";
import { createCanvasExchangeContext } from "./src/canvas-exchange/canvas-exchange-context.mjs";
import { createCanvasExchangeRouter } from "./src/http/canvas-exchange-router.mjs";
import { sendJson, sendText, withCorsHeaders } from "./src/http/responses.mjs";
import { createForartServer } from "./src/server-app.mjs";
import { createActionFolderImportService } from "./src/library/action-folder-import-service.mjs";
import { createActionLibraryService } from "./src/library/action-library-service.mjs";
import { createModelLibraryService } from "./src/library/model-library-service.mjs";
import { createOutfitLibraryService } from "./src/library/outfit-library-service.mjs";
import { createLibraryRuntime } from "./src/library/library-runtime.mjs";
import { LIBRARY_DATABASE_FILENAME } from "./src/db/database-runtime.mjs";
import { createAuthRuntime } from "./src/auth/auth-runtime.mjs";
import { handleAuthHttp, handleMeApi, handleMyPermissionsApi } from "./src/auth/auth-http.mjs";
import { authorizeApiRequest } from "./src/auth/request-authorization.mjs";
import { ensureLibraryAssetThumbnail } from "./src/library/library-asset-thumbnails.mjs";
import { parseRequest } from "./src/shared/validation.mjs";
import { localNetworkUrls } from "./src/shared/network-addresses.mjs";
import {
  libraryAddModelImagePayloadSchema,
  libraryAssetUploadPayloadSchema,
  libraryBulkEntriesPayloadSchema,
  libraryCreateModelPayloadSchema,
  libraryCreateProjectPayloadSchema,
  libraryCreateTagPayloadSchema,
  libraryImportEntriesPayloadSchema,
  libraryTagProjectQuerySchema,
  libraryTagRouteParamsSchema,
  libraryUpdateActionPayloadSchema,
  libraryUpdateModelPayloadSchema,
  libraryUpdateOutfitPayloadSchema,
  libraryUpdateProjectPayloadSchema,
  libraryUpdateTagPayloadSchema,
} from "./src/library/library-route-schemas.mjs";

const SERVER_PORT = Number(process.env.PORT || 6980);
const SERVER_HOST = process.env.HOST || "0.0.0.0";
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_ROOT = path.join(SERVER_DIR, "admin");
const DEFAULT_DATA_ROOT = path.join(ROOT_DIR, ".forart-data");
const FORART_DATA_DIR = path.resolve(process.env.FORART_DATA_DIR || path.join(DEFAULT_DATA_ROOT, "runtime"));
const LIBRARY_DIR = path.resolve(process.env.FORART_LIBRARY_DIR || path.join(DEFAULT_DATA_ROOT, "library"));
const CANVAS_STORAGE_ROOT = path.resolve(process.env.FORART_CANVAS_STORAGE_ROOT || process.env.FORART_LIBRARY_DIR || LIBRARY_DIR);
const DATABASE_FILENAME = LIBRARY_DATABASE_FILENAME;
const SERVER_LANGUAGE = process.env.FORART_LANGUAGE === "en-US" ? "en-US" : "zh-CN";
const AUTH_DISABLED = process.env.FORART_AUTH_DISABLED === "1" && process.env.NODE_ENV === "test";

let DATA_DIR = "";
let DATABASE_PATH = "";
let STORAGE_ROOT = "";
let db;
let serverRuntime = null;
let authRuntime = null;
let activeActionImportRuntime = null;
let activeActionImportService = null;
const SERVER_STARTED_AT = new Date();

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function resolveDataDir(value) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("Save path is required");
  return path.resolve(raw);
}

function ensureDataDirWritable(targetDir) {
  const resolved = resolveDataDir(targetDir);
  ensureDir(resolved);
  const probe = path.join(resolved, ".forart-write-test");
  writeFileSync(probe, "ok", "utf8");
  unlinkSync(probe);
  return resolved;
}

function applyDataDir(targetDir) {
  DATA_DIR = ensureDataDirWritable(targetDir);
  STORAGE_ROOT = DATA_DIR;
  ensureDir(STORAGE_ROOT);
}

function storageSettingsPayload() {
  return { configured: Boolean(db && DATA_DIR), driver: serverRuntime?.driver || "" };
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

async function initializeServerRuntime() {
  const initializationStartedAt = Date.now();
  applyDataDir(LIBRARY_DIR);
  const libraryStartedAt = Date.now();
  serverRuntime = await createLibraryRuntime({
    dataDir: DATA_DIR,
    runtimeDataDir: FORART_DATA_DIR,
    databaseFilename: DATABASE_FILENAME,
    canvasStorageRoot: CANVAS_STORAGE_ROOT,
    language: SERVER_LANGUAGE,
    driver: process.env.FORART_DB_DRIVER || "postgres",
    databaseUrl: "",
  });
  console.log(`[startup] Library runtime initialized in ${Date.now() - libraryStartedAt} ms.`);
  db = serverRuntime.db;
  STORAGE_ROOT = serverRuntime.storageRoot;
  DATABASE_PATH = serverRuntime.databasePath;
  const authStartedAt = Date.now();
  authRuntime = await createAuthRuntime({
    db,
    driver: serverRuntime.driver,
    serverPort: SERVER_PORT,
    runtimeDataDir: serverRuntime.runtimeDataDir,
  });
  console.log(`[startup] Authentication runtime initialized in ${Date.now() - authStartedAt} ms.`);
  if (process.env.FORART_ADMIN_PASSWORD !== undefined) {
    const result = await authRuntime.syncConfiguredAdmin({
      username: process.env.FORART_ADMIN_USERNAME || "admin",
      password: process.env.FORART_ADMIN_PASSWORD,
    });
    if (result.status === "created") {
      console.log(`[auth] Created configured administrator "${result.user.username || result.user.name}".`);
    } else if (result.status === "updated") {
      console.log(`[auth] Updated configured administrator "${result.user.username || result.user.name}" password and revoked existing sessions.`);
    } else {
      console.log(`[auth] Configured administrator "${result.user.username || result.user.name}" password already matches.`);
    }
  }
  console.log(`[startup] Server initialization completed in ${Date.now() - initializationStartedAt} ms.`);
}

await initializeServerRuntime();

const adminContext = createAdminContext({
  serverHost: SERVER_HOST,
  serverPort: SERVER_PORT,
  startedAt: SERVER_STARTED_AT,
  databaseFilename: DATABASE_FILENAME,
  getDataDir: () => DATA_DIR,
  getRuntimeDataDir: () => serverRuntime?.runtimeDataDir || FORART_DATA_DIR,
  getDatabaseDir: () => serverRuntime?.databaseDir || "",
  getDatabasePath: () => DATABASE_PATH,
  getStorageRoot: () => STORAGE_ROOT,
  getCanvasStorageRoot: () => CANVAS_STORAGE_ROOT,
  getRepository: () => serverRuntime?.repository,
  getDatabaseDriver: () => serverRuntime?.driver,
  checkDatabase: () => serverRuntime?.checkDatabase(),
  getAuthRuntime: () => authRuntime,
  getCanvasSummary: () => ({
    canvasProjects: canvasExchangeContext.store.listProjects().length,
    canvases: canvasExchangeContext.store.listCanvases().length,
  }),
});

const handleAdminRoute = createAdminRouter({
  adminRoot: ADMIN_ROOT,
  context: adminContext,
});

const canvasExchangeContext = createCanvasExchangeContext({
  getStorageRoot: () => CANVAS_STORAGE_ROOT,
  getAuthRuntime: () => authRuntime,
});

const handleCanvasExchangeRoute = createCanvasExchangeRouter({
  context: canvasExchangeContext,
});

function ensureStorageConfigured(res) {
  if (db) return true;
  sendJson(res, 409, { detail: "Asset library storage is unavailable. Check FORART_LIBRARY_DIR or default library directory permissions.", code: "MODEL_LIBRARY_STORAGE_NOT_CONFIGURED" });
  return false;
}

function actionImportRuntime() {
  return serverRuntime;
}

function getActionImportService() {
  if (activeActionImportService && activeActionImportRuntime?.db === db && activeActionImportRuntime?.storageRoot === STORAGE_ROOT) {
    return activeActionImportService;
  }
  activeActionImportRuntime = actionImportRuntime();
  const actionService = createActionLibraryService(activeActionImportRuntime);
  activeActionImportService = createActionFolderImportService(activeActionImportRuntime, actionService);
  return activeActionImportService;
}

function getActionLibraryService() {
  return createActionLibraryService(actionImportRuntime());
}

function getOutfitLibraryService() {
  return createOutfitLibraryService(actionImportRuntime());
}

function getModelLibraryService() {
  return createModelLibraryService(actionImportRuntime());
}

async function ensureRequestPermissions(req, res, permissionKeys) {
  if (AUTH_DISABLED) return true;
  const session = await authRuntime.requireSession(req);
  if (session && await Promise.all(permissionKeys.map((key) => authRuntime.authorization.hasPermission(session.user, key))).then((results) => results.every(Boolean))) return true;
  sendJson(res, 403, { detail: "Permission denied", code: "PERMISSION_DENIED", required: permissionKeys });
  return false;
}

async function ensureProjectUpdatePermissions(req, res, module, patch) {
  const required = [];
  if (Object.prototype.hasOwnProperty.call(patch, "sort_order")) required.push(`${module}.project_reorder`);
  if (Object.prototype.hasOwnProperty.call(patch, "name") || Object.prototype.hasOwnProperty.call(patch, "cover_asset_id")) required.push(`${module}.project_edit`);
  return !required.length || ensureRequestPermissions(req, res, required);
}

async function loadAsset(assetId) {
  return serverRuntime?.repository.getAsset(assetId) || null;
}

function assetAbsolutePath(value) {
  const text = String(typeof value === "object" ? value?.storage_key || "" : value || "");
  return path.isAbsolute(text) ? text : path.join(STORAGE_ROOT, text);
}
async function handleServiceBulkEntriesApi(req, res, service, module) {
  parseJsonBody(req)
    .then(async (payload) => {
      const parsed = parseRequest(libraryBulkEntriesPayloadSchema, payload || {});
      if (!parsed.ok) return sendJson(res, parsed.status, parsed.body);
      const permission = parsed.value.operation === "delete" ? `${module}.entry_delete` : `${module}.entry_edit`;
      if (!await ensureRequestPermissions(req, res, [permission])) return;
      return service.bulkEntries(parsed.value).then((result) => {
        if (!result) return sendJson(res, 404, { detail: "Project not found" });
        sendJson(res, 200, result);
      });
    })
    .catch((error) => sendOperationError(res, error));
  return true;
}

async function handleServiceTagApi(req, res, { service, projectId, tagId }) {
  const parsedQuery = parseRequest(libraryTagProjectQuerySchema, { project_id: projectId });
  if (!parsedQuery.ok) {
    sendJson(res, parsedQuery.status, parsedQuery.body);
    return true;
  }
  const parsedProjectId = parsedQuery.value.project_id;
  if (!await service.projectExists(parsedProjectId)) {
    sendJson(res, 404, { detail: "Project not found" });
    return true;
  }
  const method = String(req.method || "GET").toUpperCase();
  if (method === "GET" && !tagId) {
    sendJson(res, 200, { tags: await service.listTags(parsedProjectId) });
    return true;
  }
  if (method === "POST" && !tagId) {
    parseJsonBody(req)
      .then(async (payload) => {
        const parsedBody = parseRequest(libraryCreateTagPayloadSchema, payload || {});
        if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
        sendJson(res, 200, await service.createTag(parsedProjectId, parsedBody.value));
      })
      .catch((error) => sendOperationError(res, error));
    return true;
  }
  if (method === "PATCH" && tagId) {
    const parsedParams = parseRequest(libraryTagRouteParamsSchema, { project_id: parsedProjectId, tag_id: tagId });
    if (!parsedParams.ok) {
      sendJson(res, parsedParams.status, parsedParams.body);
      return true;
    }
    parseJsonBody(req)
      .then(async (payload) => {
        const parsedBody = parseRequest(libraryUpdateTagPayloadSchema, payload || {});
        if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
        const next = await service.updateTag(parsedProjectId, tagId, parsedBody.value);
        if (!next) return sendJson(res, 404, { detail: "Tag not found" });
        sendJson(res, 200, next);
      })
      .catch((error) => sendOperationError(res, error));
    return true;
  }
  if (method === "DELETE" && tagId) {
    const parsedParams = parseRequest(libraryTagRouteParamsSchema, { project_id: parsedProjectId, tag_id: tagId });
    if (!parsedParams.ok) {
      sendJson(res, parsedParams.status, parsedParams.body);
      return true;
    }
    sendJson(res, 200, await service.deleteTag(parsedProjectId, tagId));
    return true;
  }
  return false;
}

async function handleModelLibraryApi(req, res, url) {
  const method = String(req.method || "GET").toUpperCase();
  const pathname = url.pathname;

  if (method === "GET" && pathname === "/api/health") {
    try {
      await serverRuntime.checkDatabase();
      sendJson(res, 200, { ok: true, database: "ready" });
    } catch {
      sendJson(res, 503, { ok: false, database: "unavailable", code: "DATABASE_UNAVAILABLE" });
    }
    return true;
  }

  if (pathname === "/api/settings/storage") {
    if (method === "GET") {
      sendJson(res, 200, storageSettingsPayload());
      return true;
    }
  }

  if (!ensureStorageConfigured(res)) return true;

  if (method === "GET" && pathname === "/api/outfit-projects") {
    sendJson(res, 200, await getOutfitLibraryService().listProjects());
    return true;
  }

  if (method === "POST" && pathname === "/api/outfit-projects") {
    parseJsonBody(req)
      .then(async (payload) => {
        const parsedBody = parseRequest(libraryCreateProjectPayloadSchema, payload || {});
        if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
        sendJson(res, 200, await getOutfitLibraryService().createProject(parsedBody.value));
      })
      .catch((error) => sendOperationError(res, error));
    return true;
  }

  const outfitImportEntriesMatch = pathname.match(/^\/api\/outfit-projects\/([^/]+)\/outfits\/import-entries$/);
  if (outfitImportEntriesMatch && method === "POST") {
    parseJsonBody(req)
      .then(async (payload) => {
        const parsedBody = parseRequest(libraryImportEntriesPayloadSchema, payload || {});
        if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
        const projectId = decodeURIComponent(outfitImportEntriesMatch[1]);
        const result = await getOutfitLibraryService().importEntries(projectId, parsedBody.value);
        if (!result) return sendJson(res, 404, { detail: "Outfit project not found" });
        sendJson(res, 200, result);
      })
      .catch((error) => sendOperationError(res, error));
    return true;
  }

  const outfitProjectMatch = pathname.match(/^\/api\/outfit-projects\/([^/]+)(?:\/(cover\/upload|outfits))?$/);
  if (outfitProjectMatch) {
    const projectId = decodeURIComponent(outfitProjectMatch[1]);
    const tail = outfitProjectMatch[2] || "";
    if (tail === "" && method === "PATCH") {
      parseJsonBody(req)
        .then(async (payload) => {
          const parsedBody = parseRequest(libraryUpdateProjectPayloadSchema, payload || {});
          if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
          if (!await ensureProjectUpdatePermissions(req, res, "outfit_library", parsedBody.value)) return;
          const nextProject = await getOutfitLibraryService().updateProject(projectId, parsedBody.value);
          if (!nextProject) return sendJson(res, 404, { detail: "Outfit project not found" });
          sendJson(res, 200, nextProject);
        })
        .catch((error) => sendOperationError(res, error));
      return true;
    }
    if (tail === "" && method === "DELETE") {
      const result = await getOutfitLibraryService().deleteProject(projectId);
      if (!result) {
        sendJson(res, 404, { detail: "Outfit project not found" });
        return true;
      }
      sendJson(res, 200, result);
      return true;
    }
    if (tail === "cover/upload" && method === "POST") {
      parseJsonBody(req)
        .then(async (payload) => {
          const parsedBody = parseRequest(libraryAssetUploadPayloadSchema, payload || {});
          if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
          const nextProject = await getOutfitLibraryService().uploadProjectCover(projectId, parsedBody.value);
          if (!nextProject) return sendJson(res, 404, { detail: "Outfit project not found" });
          sendJson(res, 200, nextProject);
        })
        .catch((error) => sendOperationError(res, error));
      return true;
    }
    if (tail === "outfits" && method === "GET") {
      const result = await getOutfitLibraryService().listOutfits(projectId, {
        tag_id: url.searchParams.getAll("tag_id"),
        exclude_tag_id: url.searchParams.getAll("exclude_tag_id"),
        untagged: url.searchParams.get("untagged") || "",
      });
      if (!result) {
        sendJson(res, 404, { detail: "Outfit project not found" });
        return true;
      }
      sendJson(res, 200, result);
      return true;
    }
  }

  const outfitMatch = pathname.match(/^\/api\/outfits\/([^/]+)(?:\/image\/upload)?$/);
  if (outfitMatch) {
    const outfitId = decodeURIComponent(outfitMatch[1]);
    const isImageUpload = pathname.endsWith("/image/upload");
    if (!isImageUpload && method === "PATCH") {
      parseJsonBody(req)
        .then(async (payload) => {
          const parsedBody = parseRequest(libraryUpdateOutfitPayloadSchema, payload || {});
          if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
          const nextOutfit = await getOutfitLibraryService().updateOutfit(outfitId, parsedBody.value);
          if (!nextOutfit) return sendJson(res, 404, { detail: "Outfit not found" });
          sendJson(res, 200, nextOutfit);
        })
        .catch((error) => sendOperationError(res, error));
      return true;
    }
    if (!isImageUpload && method === "DELETE") {
      const result = await getOutfitLibraryService().deleteOutfit(outfitId);
      if (!result) {
        sendJson(res, 404, { detail: "Outfit not found" });
        return true;
      }
      sendJson(res, 200, result);
      return true;
    }
    if (isImageUpload && method === "POST") {
      parseJsonBody(req)
        .then(async (payload) => {
          const parsedBody = parseRequest(libraryAssetUploadPayloadSchema, payload || {});
          if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
          const nextOutfit = await getOutfitLibraryService().replaceOutfitImage(outfitId, parsedBody.value);
          if (!nextOutfit) return sendJson(res, 404, { detail: "Outfit not found" });
          sendJson(res, 200, nextOutfit);
        })
        .catch((error) => sendOperationError(res, error));
      return true;
    }
  }

  const outfitTagMatch = pathname.match(/^\/api\/libraries\/outfit\/tags(?:\/([^/]+))?$/);
  if (outfitTagMatch) {
    const tagId = outfitTagMatch[1] ? decodeURIComponent(outfitTagMatch[1]) : "";
    const projectId = url.searchParams.get("project_id") || "";
    if (await handleServiceTagApi(req, res, { service: getOutfitLibraryService(), projectId, tagId })) return true;
  }

  if (pathname === "/api/libraries/outfit/entries/bulk" && method === "POST") {
    return handleServiceBulkEntriesApi(req, res, getOutfitLibraryService(), "outfit_library");
  }

  if (method === "GET" && pathname === "/api/action-projects") {
    sendJson(res, 200, await getActionLibraryService().listProjects());
    return true;
  }

  if (method === "POST" && pathname === "/api/action-projects") {
    parseJsonBody(req)
      .then(async (payload) => {
        const parsedBody = parseRequest(libraryCreateProjectPayloadSchema, payload || {});
        if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
        sendJson(res, 200, await getActionLibraryService().createProject(parsedBody.value));
      })
      .catch((error) => sendOperationError(res, error));
    return true;
  }

  const actionProjectMatch = pathname.match(/^\/api\/action-projects\/([^/]+)(?:\/(cover\/upload|actions))?$/);
  if (actionProjectMatch) {
    const projectId = decodeURIComponent(actionProjectMatch[1]);
    const tail = actionProjectMatch[2] || "";
    if (tail === "" && method === "PATCH") {
      parseJsonBody(req)
        .then(async (payload) => {
          const parsedBody = parseRequest(libraryUpdateProjectPayloadSchema, payload || {});
          if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
          if (!await ensureProjectUpdatePermissions(req, res, "action_library", parsedBody.value)) return;
          const nextProject = await getActionLibraryService().updateProject(projectId, parsedBody.value);
          if (!nextProject) return sendJson(res, 404, { detail: "Action project not found" });
          sendJson(res, 200, nextProject);
        })
        .catch((error) => sendOperationError(res, error));
      return true;
    }
    if (tail === "" && method === "DELETE") {
      const result = await getActionLibraryService().deleteProject(projectId);
      if (!result) {
        sendJson(res, 404, { detail: "Action project not found" });
        return true;
      }
      sendJson(res, 200, result);
      return true;
    }
    if (tail === "cover/upload" && method === "POST") {
      parseJsonBody(req)
        .then(async (payload) => {
          const parsedBody = parseRequest(libraryAssetUploadPayloadSchema, payload || {});
          if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
          const nextProject = await getActionLibraryService().uploadProjectCover(projectId, parsedBody.value);
          if (!nextProject) return sendJson(res, 404, { detail: "Action project not found" });
          sendJson(res, 200, nextProject);
        })
        .catch((error) => sendOperationError(res, error));
      return true;
    }
    if (tail === "actions" && method === "GET") {
      const result = await getActionLibraryService().listActions(projectId, {
        tag_id: url.searchParams.getAll("tag_id"),
        exclude_tag_id: url.searchParams.getAll("exclude_tag_id"),
        untagged: url.searchParams.get("untagged") || "",
      });
      if (!result) {
        sendJson(res, 404, { detail: "Action project not found" });
        return true;
      }
      sendJson(res, 200, result);
      return true;
    }
  }

  const actionImportEntriesMatch = pathname.match(/^\/api\/action-projects\/([^/]+)\/actions\/import-entries$/);
  if (actionImportEntriesMatch && method === "POST") {
    parseJsonBody(req)
      .then(async (payload) => {
        const parsedBody = parseRequest(libraryImportEntriesPayloadSchema, payload || {});
        if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
        const projectId = decodeURIComponent(actionImportEntriesMatch[1]);
        const result = await getActionImportService().importActionEntries(projectId, parsedBody.value);
        if (!result) return sendJson(res, 404, { detail: "Action project not found" });
        sendJson(res, 200, result);
      })
      .catch((error) => sendOperationError(res, error));
    return true;
  }

  const actionMatch = pathname.match(/^\/api\/actions\/([^/]+)(?:\/image\/upload)?$/);
  if (actionMatch) {
    const actionId = decodeURIComponent(actionMatch[1]);
    const isImageUpload = pathname.endsWith("/image/upload");
    if (!isImageUpload && method === "PATCH") {
      parseJsonBody(req)
        .then(async (payload) => {
          const parsedBody = parseRequest(libraryUpdateActionPayloadSchema, payload || {});
          if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
          const nextAction = await getActionLibraryService().updateAction(actionId, parsedBody.value);
          if (!nextAction) return sendJson(res, 404, { detail: "Action not found" });
          sendJson(res, 200, nextAction);
        })
        .catch((error) => sendOperationError(res, error));
      return true;
    }
    if (!isImageUpload && method === "DELETE") {
      const result = await getActionLibraryService().deleteAction(actionId);
      if (!result) {
        sendJson(res, 404, { detail: "Action not found" });
        return true;
      }
      sendJson(res, 200, result);
      return true;
    }
    if (isImageUpload && method === "POST") {
      parseJsonBody(req)
        .then(async (payload) => {
          const parsedBody = parseRequest(libraryAssetUploadPayloadSchema, payload || {});
          if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
          const nextAction = await getActionLibraryService().replaceActionImage(actionId, parsedBody.value);
          if (!nextAction) return sendJson(res, 404, { detail: "Action not found" });
          sendJson(res, 200, nextAction);
        })
        .catch((error) => sendOperationError(res, error));
      return true;
    }
  }

  const actionTagMatch = pathname.match(/^\/api\/libraries\/action\/tags(?:\/([^/]+))?$/);
  if (actionTagMatch) {
    const tagId = actionTagMatch[1] ? decodeURIComponent(actionTagMatch[1]) : "";
    const projectId = url.searchParams.get("project_id") || "";
    if (await handleServiceTagApi(req, res, { service: getActionLibraryService(), projectId, tagId })) return true;
  }

  if (pathname === "/api/libraries/action/entries/bulk" && method === "POST") {
    return handleServiceBulkEntriesApi(req, res, getActionLibraryService(), "action_library");
  }

  if (method === "GET" && pathname === "/api/model-projects") {
    sendJson(res, 200, await getModelLibraryService().listProjects());
    return true;
  }

  if (method === "POST" && pathname === "/api/model-projects") {
    parseJsonBody(req)
      .then(async (payload) => {
        const parsedBody = parseRequest(libraryCreateProjectPayloadSchema, payload || {});
        if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
        sendJson(res, 200, await getModelLibraryService().createProject(parsedBody.value));
      })
      .catch((error) => sendOperationError(res, error));
    return true;
  }

  const modelImportEntriesMatch = pathname.match(/^\/api\/model-projects\/([^/]+)\/models\/import-entries$/);
  if (modelImportEntriesMatch && method === "POST") {
    parseJsonBody(req)
      .then(async (payload) => {
        const parsedBody = parseRequest(libraryImportEntriesPayloadSchema, payload || {});
        if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
        const projectId = decodeURIComponent(modelImportEntriesMatch[1]);
        const result = await getModelLibraryService().importEntries(projectId, parsedBody.value);
        if (!result) return sendJson(res, 404, { detail: "Model project not found" });
        sendJson(res, 200, result);
      })
      .catch((error) => sendOperationError(res, error));
    return true;
  }

  const projectMatch = pathname.match(/^\/api\/model-projects\/([^/]+)(?:\/(cover\/upload|models))?$/);
  if (projectMatch) {
    const projectId = decodeURIComponent(projectMatch[1]);
    const tail = projectMatch[2] || "";
    if (tail === "" && method === "PATCH") {
      parseJsonBody(req)
        .then(async (payload) => {
          const parsedBody = parseRequest(libraryUpdateProjectPayloadSchema, payload || {});
          if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
          if (!await ensureProjectUpdatePermissions(req, res, "model_library", parsedBody.value)) return;
          const nextProject = await getModelLibraryService().updateProject(projectId, parsedBody.value);
          if (!nextProject) return sendJson(res, 404, { detail: "Model project not found" });
          sendJson(res, 200, nextProject);
        })
        .catch((error) => sendOperationError(res, error));
      return true;
    }
    if (tail === "" && method === "DELETE") {
      const result = await getModelLibraryService().deleteProject(projectId);
      if (!result) {
        sendJson(res, 404, { detail: "Model project not found" });
        return true;
      }
      sendJson(res, 200, result);
      return true;
    }
    if (tail === "cover/upload" && method === "POST") {
      parseJsonBody(req)
        .then(async (payload) => {
          const parsedBody = parseRequest(libraryAssetUploadPayloadSchema, payload || {});
          if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
          const nextProject = await getModelLibraryService().uploadProjectCover(projectId, parsedBody.value);
          if (!nextProject) return sendJson(res, 404, { detail: "Model project not found" });
          sendJson(res, 200, nextProject);
        })
        .catch((error) => sendOperationError(res, error));
      return true;
    }
    if (tail === "models" && method === "GET") {
      const result = await getModelLibraryService().listModels(projectId, {
        tag_id: url.searchParams.getAll("tag_id"),
        exclude_tag_id: url.searchParams.getAll("exclude_tag_id"),
        untagged: url.searchParams.get("untagged") || "",
        gender: url.searchParams.get("gender") || "",
      });
      if (!result) {
        sendJson(res, 404, { detail: "Model project not found" });
        return true;
      }
      sendJson(res, 200, result);
      return true;
    }
    if (tail === "models" && method === "POST") {
      parseJsonBody(req)
        .then(async (payload) => {
          const parsedBody = parseRequest(libraryCreateModelPayloadSchema, payload || {});
          if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
          const model = await getModelLibraryService().createModel(projectId, parsedBody.value);
          if (!model) return sendJson(res, 404, { detail: "Model project not found" });
          sendJson(res, 200, model);
        })
        .catch((error) => sendOperationError(res, error));
      return true;
    }
  }

  const modelMatch = pathname.match(/^\/api\/models\/([^/]+)(?:\/(images|images\/upload))?$/);
  if (modelMatch) {
    const modelId = decodeURIComponent(modelMatch[1]);
    const tail = modelMatch[2] || "";
    if (tail === "" && method === "PATCH") {
      parseJsonBody(req)
        .then(async (payload) => {
          const parsedBody = parseRequest(libraryUpdateModelPayloadSchema, payload || {});
          if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
          const nextModel = await getModelLibraryService().updateModel(modelId, parsedBody.value);
          if (!nextModel) return sendJson(res, 404, { detail: "Model not found" });
          sendJson(res, 200, nextModel);
        })
        .catch((error) => sendOperationError(res, error));
      return true;
    }
    if (tail === "" && method === "DELETE") {
      const result = await getModelLibraryService().deleteModel(modelId);
      if (!result) {
        sendJson(res, 404, { detail: "Model not found" });
        return true;
      }
      sendJson(res, 200, result);
      return true;
    }
    if (tail === "images" && method === "GET") {
      const result = await getModelLibraryService().listImages(modelId);
      if (!result) {
        sendJson(res, 404, { detail: "Model not found" });
        return true;
      }
      sendJson(res, 200, result);
      return true;
    }
    if (tail === "images" && method === "POST") {
      parseJsonBody(req)
        .then(async (payload) => {
          const parsedBody = parseRequest(libraryAddModelImagePayloadSchema, payload || {});
          if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
          const image = await getModelLibraryService().addImage(modelId, parsedBody.value);
          if (!image) return sendJson(res, 404, { detail: "Model not found" });
          sendJson(res, 200, image);
        })
        .catch((error) => {
          const detail = error instanceof Error ? error.message : String(error);
          sendOperationError(res, error, detail === "Asset not found" ? 404 : 400);
        });
      return true;
    }
    if (tail === "images/upload" && method === "POST") {
      parseJsonBody(req)
        .then(async (payload) => {
          const parsedBody = parseRequest(libraryAssetUploadPayloadSchema, payload || {});
          if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
          const result = await getModelLibraryService().uploadImage(modelId, parsedBody.value);
          if (!result) return sendJson(res, 404, { detail: "Model not found" });
          sendJson(res, 200, result);
        })
        .catch((error) => sendOperationError(res, error));
      return true;
    }
  }

  const imageMatch = pathname.match(/^\/api\/model-images\/([^/]+)$/);
  if (imageMatch && method === "DELETE") {
    const imageId = decodeURIComponent(imageMatch[1]);
    const result = await getModelLibraryService().deleteImage(imageId);
    if (!result) {
      sendJson(res, 404, { detail: "Model image not found" });
      return true;
    }
    sendJson(res, 200, result);
    return true;
  }

  const tagMatch = pathname.match(/^\/api\/libraries\/model\/tags(?:\/([^/]+))?$/);
  if (tagMatch) {
    const tagId = tagMatch[1] ? decodeURIComponent(tagMatch[1]) : "";
    const projectId = url.searchParams.get("project_id") || "";
    if (await handleServiceTagApi(req, res, { service: getModelLibraryService(), projectId, tagId })) return true;
  }

  if (pathname === "/api/libraries/model/entries/bulk" && method === "POST") {
    return handleServiceBulkEntriesApi(req, res, getModelLibraryService(), "model_library");
  }

  const assetMatch = pathname.match(/^\/api\/assets\/([^/]+)\/(file|download)$/);
  if (assetMatch && (method === "GET" || method === "HEAD")) {
    const assetId = decodeURIComponent(assetMatch[1]);
    const disposition = assetMatch[2] === "download" ? "attachment" : "inline";
    const asset = await loadAsset(assetId);
    if (!asset) {
      sendText(res, 404, "Asset not found");
      return true;
    }
    try {
      const data = readFileSync(assetAbsolutePath(asset));
      res.writeHead(200, withCorsHeaders({
        "content-type": asset.mime_type || "application/octet-stream",
        "content-disposition": `${disposition}; filename="${encodeURIComponent(asset.filename)}"`,
      }));
      res.end(method === "HEAD" ? undefined : data);
    } catch (error) {
      sendText(res, 404, error instanceof Error ? error.message : String(error));
    }
    return true;
  }

  const assetThumbMatch = pathname.match(/^\/api\/assets\/([^/]+)\/thumb$/);
  if (assetThumbMatch && (method === "GET" || method === "HEAD")) {
    const assetId = decodeURIComponent(assetThumbMatch[1]);
    const asset = await loadAsset(assetId);
    if (!asset) {
      sendText(res, 404, "Asset not found");
      return true;
    }
    const sourcePath = assetAbsolutePath(asset);
    ensureLibraryAssetThumbnail(actionImportRuntime(), asset, sourcePath)
      .then((thumbnail) => {
        const filePath = thumbnail?.filePath && existsSync(thumbnail.filePath) ? thumbnail.filePath : sourcePath;
        const contentType = thumbnail?.filePath && existsSync(thumbnail.filePath)
          ? "image/webp"
          : asset.mime_type || "application/octet-stream";
        try {
          const data = readFileSync(filePath);
          res.writeHead(200, withCorsHeaders({
            "content-type": contentType,
            "content-disposition": `inline; filename="${encodeURIComponent(path.basename(filePath))}"`,
          }));
          res.end(method === "HEAD" ? undefined : data);
        } catch (error) {
          sendText(res, 404, error instanceof Error ? error.message : String(error));
        }
      })
      .catch((error) => {
        console.warn(`[library-thumbnail] Failed to serve thumbnail for ${assetId}: ${error instanceof Error ? error.message : String(error)}`);
        try {
          const data = readFileSync(sourcePath);
          res.writeHead(200, withCorsHeaders({
            "content-type": asset.mime_type || "application/octet-stream",
            "content-disposition": `inline; filename="${encodeURIComponent(asset.filename)}"`,
          }));
          res.end(method === "HEAD" ? undefined : data);
        } catch (readError) {
          sendText(res, 404, readError instanceof Error ? readError.message : String(readError));
        }
      });
    return true;
  }

  return false;
}

async function handleRequest(req, res) {
  if (String(req.method || "").toUpperCase() === "OPTIONS") {
    res.writeHead(204, withCorsHeaders());
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  const resourceToken = url.searchParams.get("forart_token");
  if (resourceToken && !req.headers.authorization
    && (/^\/api\/assets\//.test(url.pathname) || /^\/api\/canvas-exchange\/canvases\/[^/]+\/assets\//.test(url.pathname))) {
    req.headers.authorization = `Bearer ${resourceToken}`;
  }
  if (url.pathname.startsWith("/api/auth/")) {
    await handleAuthHttp(req, res, url, authRuntime);
    return;
  }
  if (url.pathname === "/api/me") {
    await handleMeApi(req, res, authRuntime);
    return;
  }
  if (url.pathname === "/api/me/permissions") {
    await handleMyPermissionsApi(req, res, authRuntime);
    return;
  }
  if (await handleAdminRoute(req, res, url)) return;
  if (!AUTH_DISABLED && url.pathname !== "/api/health" && url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/admin/")) {
    if (!await authorizeApiRequest(req, res, url.pathname, authRuntime)) return;
  }
  if (await handleCanvasExchangeRoute(req, res, url)) return;
  if (await handleModelLibraryApi(req, res, url)) return;
  sendJson(res, 404, { detail: "API route not found" });
}

function handleServerError(error) {
  if (error?.code === "EADDRINUSE") {
    console.error(`Forart Server API port is already in use: http://127.0.0.1:${SERVER_PORT}`);
    process.exit(0);
  }
  console.error(error);
  process.exit(1);
}

const DATABASE_UNAVAILABLE_CODES = new Set([
  "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "EAI_AGAIN",
  "57P01", "57P02", "57P03", "08000", "08003", "08006", "53300",
]);

function isDatabaseUnavailable(error) {
  const candidates = [error, error?.cause, error?.originalError];
  if (candidates.some((candidate) => DATABASE_UNAVAILABLE_CODES.has(String(candidate?.code || "").toUpperCase()))) {
    return true;
  }
  const message = candidates
    .map((candidate) => String(candidate?.message || ""))
    .join(" ")
    .toLowerCase();
  return message.includes("connection terminated unexpectedly")
    || message.includes("terminating connection due to administrator command")
    || message.includes("the database system is starting up")
    || message.includes("the database system is shutting down");
}

function handleRequestError(error, res) {
  if (res.headersSent) {
    console.error(error);
    res.destroy(error instanceof Error ? error : undefined);
    return;
  }
  if (isDatabaseUnavailable(error)) {
    console.warn(`[database] Request could not reach PostgreSQL: ${String(error?.code || error?.cause?.code || "unavailable")}`);
    sendJson(res, 503, { detail: "Database is temporarily unavailable", code: "DATABASE_UNAVAILABLE" });
    return;
  }
  console.error(error);
  sendJson(res, 500, { detail: "Internal server error", code: "INTERNAL_SERVER_ERROR" });
}

const appServer = createForartServer({
  handleRequest: (req, res) => {
    handleRequest(req, res).catch((error) => handleRequestError(error, res));
  },
  onError: handleServerError,
});

let shutdownPromise = null;

function shutdown(signal) {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    console.log(`Forart Server received ${signal}; shutting down.`);
    await appServer.close();
    await serverRuntime?.close?.();
  })().catch((error) => {
    console.error("Forart Server shutdown failed:", error);
    process.exitCode = 1;
  });
  return shutdownPromise;
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => {
    void shutdown(signal);
  });
}

function sendOperationError(res, error, defaultStatus = 400) {
  if (isDatabaseUnavailable(error)) {
    sendJson(res, 503, { detail: "Database is temporarily unavailable", code: "DATABASE_UNAVAILABLE" });
    return;
  }
  sendJson(res, defaultStatus, { detail: error instanceof Error ? error.message : String(error) });
}

appServer.start({ port: SERVER_PORT, host: SERVER_HOST }).then(() => {
  console.log(`Forart Server API running at http://127.0.0.1:${SERVER_PORT}`);
  const urls = localNetworkUrls(SERVER_PORT);
  if (urls.length) {
    console.log("LAN access:");
    for (const url of urls) console.log(`  ${url}`);
  }
}).catch(handleServerError);
