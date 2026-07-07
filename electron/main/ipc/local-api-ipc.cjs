const fs = require('fs');
const nodePath = require('path');

function normalizeMethod(value) {
  return String(value || 'GET').trim().toUpperCase() || 'GET';
}

function parseRequestUrl(value) {
  const raw = String(value || '').trim() || '/';
  try {
    return new URL(raw, 'http://127.0.0.1');
  } catch {
    return new URL(raw.startsWith('/') ? raw : `/${raw}`, 'http://127.0.0.1');
  }
}

function notMigrated(path) {
  return {
    ok: false,
    status: 501,
    body: {
      detail: `Local IPC route is not migrated yet: ${path}`,
      code: 'LOCAL_IPC_ROUTE_NOT_MIGRATED',
    },
  };
}

let runtimeModulePromise = null;
let modelLibraryModulePromise = null;
let outfitLibraryModulePromise = null;
let actionLibraryModulePromise = null;
let actionFolderImportModulePromise = null;
let libraryAssetThumbnailModulePromise = null;
let validationModulePromise = null;
let libraryRouteSchemasModulePromise = null;
let activeRuntime = null;
let activeRuntimeKey = '';
let activeModelService = null;
let activeModelServiceKey = '';
let activeOutfitService = null;
let activeOutfitServiceKey = '';
let activeActionService = null;
let activeActionServiceKey = '';
let activeActionFolderImportService = null;
let activeActionFolderImportServiceKey = '';
let activeActionImportPreview = null;

function libraryRuntimeModule() {
  if (!runtimeModulePromise) {
    runtimeModulePromise = import('../../../server/src/library/library-runtime.mjs');
  }
  return runtimeModulePromise;
}

function modelLibraryModule() {
  if (!modelLibraryModulePromise) {
    modelLibraryModulePromise = import('../../../server/src/library/model-library-service.mjs');
  }
  return modelLibraryModulePromise;
}

function outfitLibraryModule() {
  if (!outfitLibraryModulePromise) {
    outfitLibraryModulePromise = import('../../../server/src/library/outfit-library-service.mjs');
  }
  return outfitLibraryModulePromise;
}

function actionLibraryModule() {
  if (!actionLibraryModulePromise) {
    actionLibraryModulePromise = import('../../../server/src/library/action-library-service.mjs');
  }
  return actionLibraryModulePromise;
}

function actionFolderImportModule() {
  if (!actionFolderImportModulePromise) {
    actionFolderImportModulePromise = import('../../../server/src/library/action-folder-import-service.mjs');
  }
  return actionFolderImportModulePromise;
}

function libraryAssetThumbnailModule() {
  if (!libraryAssetThumbnailModulePromise) {
    libraryAssetThumbnailModulePromise = import('../../../server/src/library/library-asset-thumbnails.mjs');
  }
  return libraryAssetThumbnailModulePromise;
}

function validationModule() {
  if (!validationModulePromise) {
    validationModulePromise = import('../../../server/src/shared/validation.mjs');
  }
  return validationModulePromise;
}

function libraryRouteSchemasModule() {
  if (!libraryRouteSchemasModulePromise) {
    libraryRouteSchemasModulePromise = import('../../../server/src/library/library-route-schemas.mjs');
  }
  return libraryRouteSchemasModulePromise;
}

async function getLibraryRuntime({ configStore, app, dataRoot }) {
  const config = configStore.load();
  const localLibraryPath = String(config?.localLibraryPath || '').trim();
  if (!localLibraryPath) return { config, runtime: null };

  const language = config?.language === 'en-US' ? 'en-US' : 'zh-CN';
  const databaseDir = nodePath.join(localLibraryPath, '.forart', 'database');
  const runtimeKey = [localLibraryPath, databaseDir, dataRoot, language].join('|');
  if (activeRuntime && activeRuntimeKey === runtimeKey) return { config, runtime: activeRuntime };

  activeRuntime?.close?.();
  activeModelService = null;
  activeModelServiceKey = '';
  activeOutfitService = null;
  activeOutfitServiceKey = '';
  activeActionService = null;
  activeActionServiceKey = '';
  activeActionFolderImportService = null;
  activeActionFolderImportServiceKey = '';
  activeActionImportPreview = null;
  const { createLibraryRuntime } = await libraryRuntimeModule();
  activeRuntime = createLibraryRuntime({
    dataDir: localLibraryPath,
    databaseDir,
    canvasStorageRoot: dataRoot,
    language,
  });
  activeRuntimeKey = runtimeKey;
  return { config, runtime: activeRuntime };
}

function localLibraryAssetUrl(assetId) {
  return `forart-asset://library/${encodeURIComponent(assetId)}`;
}

function localLibraryAssetThumbnailUrl(assetId) {
  return `forart-asset://library-thumb/${encodeURIComponent(assetId)}`;
}

async function getModelLibraryService(runtime) {
  if (activeModelService && activeModelServiceKey === activeRuntimeKey) return activeModelService;
  const { createModelLibraryService } = await modelLibraryModule();
  activeModelService = createModelLibraryService(runtime, {
    localAssetUrl: localLibraryAssetUrl,
    localAssetThumbnailUrl: localLibraryAssetThumbnailUrl,
  });
  activeModelServiceKey = activeRuntimeKey;
  return activeModelService;
}

async function getOutfitLibraryService(runtime) {
  if (activeOutfitService && activeOutfitServiceKey === activeRuntimeKey) return activeOutfitService;
  const { createOutfitLibraryService } = await outfitLibraryModule();
  activeOutfitService = createOutfitLibraryService(runtime, {
    localAssetUrl: localLibraryAssetUrl,
    localAssetThumbnailUrl: localLibraryAssetThumbnailUrl,
  });
  activeOutfitServiceKey = activeRuntimeKey;
  return activeOutfitService;
}

async function getActionLibraryService(runtime) {
  if (activeActionService && activeActionServiceKey === activeRuntimeKey) return activeActionService;
  const { createActionLibraryService } = await actionLibraryModule();
  activeActionService = createActionLibraryService(runtime, {
    localAssetUrl: localLibraryAssetUrl,
    localAssetThumbnailUrl: localLibraryAssetThumbnailUrl,
  });
  activeActionServiceKey = activeRuntimeKey;
  return activeActionService;
}

async function getActionFolderImportService(runtime) {
  if (activeActionFolderImportService && activeActionFolderImportServiceKey === activeRuntimeKey) return activeActionFolderImportService;
  const { createActionFolderImportService } = await actionFolderImportModule();
  const actionService = await getActionLibraryService(runtime);
  activeActionFolderImportService = createActionFolderImportService(runtime, actionService);
  activeActionFolderImportServiceKey = activeRuntimeKey;
  return activeActionFolderImportService;
}

function registerActionImportPreview(preview) {
  if (!preview) return null;
  const rows = new Map();
  for (const row of preview?.rows || []) {
    if (row?.id && row.image_path) rows.set(String(row.id), row.image_path);
  }
  activeActionImportPreview = {
    id: String(preview?.preview_id || ''),
    rows,
  };
  return {
    ...preview,
    rows: (preview?.rows || []).map((row) => ({
      ...row,
      thumbnail_url: row.image_path && preview?.preview_id
        ? `forart-asset://action-import-preview/${encodeURIComponent(preview.preview_id)}/${encodeURIComponent(row.id)}`
        : '',
    })),
  };
}

function success(body, status = 200) {
  return { ok: true, status, body };
}

function failure(status, detail, extra = {}) {
  return { ok: false, status, body: { detail, ...extra } };
}

function searchValues(url, key) {
  return url.searchParams.getAll(key);
}

function searchObject(url) {
  return {
    tag_id: searchValues(url, 'tag_id'),
    exclude_tag_id: searchValues(url, 'exclude_tag_id'),
    untagged: url.searchParams.get('untagged') || '',
    gender: url.searchParams.get('gender') || '',
  };
}

function notFoundIfNull(result, detail) {
  return result ? success(result) : failure(404, detail);
}

async function parseLibraryRoutePayload(schemaName, input) {
  const [{ parseRequest }, schemas] = await Promise.all([
    validationModule(),
    libraryRouteSchemasModule(),
  ]);
  return parseRequest(schemas[schemaName], input || {});
}

async function dispatchTagRoute({ method, url, tagMatch, service, projectNotFoundDetail }) {
  const tagId = tagMatch[1] ? decodeURIComponent(tagMatch[1]) : '';
  const parsedQuery = await parseLibraryRoutePayload('libraryTagProjectQuerySchema', {
    project_id: url.searchParams.get('project_id') || '',
  });
  if (!parsedQuery.ok) return parsedQuery;
  const projectId = parsedQuery.value.project_id;
  if (!service.projectExists(projectId)) return failure(404, projectNotFoundDetail);
  if (!tagId && (method === 'GET' || method === 'HEAD')) return success({ tags: service.listTags(projectId) });
  if (!tagId && method === 'POST') {
    const parsedBody = await parseLibraryRoutePayload('libraryCreateTagPayloadSchema', url.body || {});
    if (!parsedBody.ok) return parsedBody;
    return notFoundIfNull(service.createTag(projectId, parsedBody.value), projectNotFoundDetail);
  }
  if (tagId && (method === 'PATCH' || method === 'DELETE')) {
    const parsedParams = await parseLibraryRoutePayload('libraryTagRouteParamsSchema', {
      project_id: projectId,
      tag_id: tagId,
    });
    if (!parsedParams.ok) return parsedParams;
  }
  if (tagId && method === 'PATCH') {
    const parsedBody = await parseLibraryRoutePayload('libraryUpdateTagPayloadSchema', url.body || {});
    if (!parsedBody.ok) return parsedBody;
    return notFoundIfNull(service.updateTag(projectId, tagId, parsedBody.value), 'Tag not found');
  }
  if (tagId && method === 'DELETE') return success(service.deleteTag(projectId, tagId));
  return null;
}

async function dispatchModelLibraryRoute({ method, url, body, runtime }) {
  const service = await getModelLibraryService(runtime);
  const pathname = url.pathname;

  try {
    if (pathname === '/api/model-projects') {
      if (method === 'GET' || method === 'HEAD') return success(service.listProjects());
      if (method === 'POST') {
        const parsed = await parseLibraryRoutePayload('libraryCreateProjectPayloadSchema', body || {});
        if (!parsed.ok) return parsed;
        return success(service.createProject(parsed.value));
      }
    }

    const importEntriesMatch = pathname.match(/^\/api\/model-projects\/([^/]+)\/models\/import-entries$/);
    if (importEntriesMatch && method === 'POST') {
      const projectId = decodeURIComponent(importEntriesMatch[1]);
      const parsed = await parseLibraryRoutePayload('libraryImportEntriesPayloadSchema', body || {});
      if (!parsed.ok) return parsed;
      return notFoundIfNull(await service.importEntries(projectId, parsed.value), 'Model project not found');
    }

    const projectMatch = pathname.match(/^\/api\/model-projects\/([^/]+)(?:\/(cover\/upload|models))?$/);
    if (projectMatch) {
      const projectId = decodeURIComponent(projectMatch[1]);
      const tail = projectMatch[2] || '';
      if (tail === '' && method === 'PATCH') {
        const parsed = await parseLibraryRoutePayload('libraryUpdateProjectPayloadSchema', body || {});
        if (!parsed.ok) return parsed;
        return notFoundIfNull(service.updateProject(projectId, parsed.value), 'Model project not found');
      }
      if (tail === '' && method === 'DELETE') return notFoundIfNull(service.deleteProject(projectId), 'Model project not found');
      if (tail === 'cover/upload' && method === 'POST') {
        const parsed = await parseLibraryRoutePayload('libraryAssetUploadPayloadSchema', body || {});
        if (!parsed.ok) return parsed;
        return notFoundIfNull(await service.uploadProjectCover(projectId, parsed.value), 'Model project not found');
      }
      if (tail === 'models' && (method === 'GET' || method === 'HEAD')) {
        return notFoundIfNull(service.listModels(projectId, searchObject(url)), 'Model project not found');
      }
      if (tail === 'models' && method === 'POST') {
        const parsed = await parseLibraryRoutePayload('libraryCreateModelPayloadSchema', body || {});
        if (!parsed.ok) return parsed;
        return notFoundIfNull(service.createModel(projectId, parsed.value), 'Model project not found');
      }
    }

    const modelMatch = pathname.match(/^\/api\/models\/([^/]+)(?:\/(images|images\/upload))?$/);
    if (modelMatch) {
      const modelId = decodeURIComponent(modelMatch[1]);
      const tail = modelMatch[2] || '';
      if (tail === '' && method === 'PATCH') {
        const parsed = await parseLibraryRoutePayload('libraryUpdateModelPayloadSchema', body || {});
        if (!parsed.ok) return parsed;
        return notFoundIfNull(service.updateModel(modelId, parsed.value), 'Model not found');
      }
      if (tail === '' && method === 'DELETE') return notFoundIfNull(service.deleteModel(modelId), 'Model not found');
      if (tail === 'images' && (method === 'GET' || method === 'HEAD')) return notFoundIfNull(service.listImages(modelId), 'Model not found');
      if (tail === 'images' && method === 'POST') {
        const parsed = await parseLibraryRoutePayload('libraryAddModelImagePayloadSchema', body || {});
        if (!parsed.ok) return parsed;
        return notFoundIfNull(service.addImage(modelId, parsed.value), 'Model not found');
      }
      if (tail === 'images/upload' && method === 'POST') {
        const parsed = await parseLibraryRoutePayload('libraryAssetUploadPayloadSchema', body || {});
        if (!parsed.ok) return parsed;
        return notFoundIfNull(await service.uploadImage(modelId, parsed.value), 'Model not found');
      }
    }

    const imageMatch = pathname.match(/^\/api\/model-images\/([^/]+)$/);
    if (imageMatch && method === 'DELETE') {
      return notFoundIfNull(service.deleteImage(decodeURIComponent(imageMatch[1])), 'Model image not found');
    }

    const tagMatch = pathname.match(/^\/api\/libraries\/model\/tags(?:\/([^/]+))?$/);
    if (tagMatch) {
      url.body = body;
      return await dispatchTagRoute({ method, url, tagMatch, service, projectNotFoundDetail: 'Model project not found' });
    }

    if (pathname === '/api/libraries/model/entries/bulk' && method === 'POST') {
      const parsed = await parseLibraryRoutePayload('libraryBulkEntriesPayloadSchema', body || {});
      if (!parsed.ok) return parsed;
      return notFoundIfNull(service.bulkEntries(parsed.value), 'Model project not found');
    }

    return null;
  } catch (error) {
    return failure(400, error instanceof Error ? error.message : String(error));
  }
}

async function dispatchOutfitLibraryRoute({ method, url, body, runtime }) {
  const service = await getOutfitLibraryService(runtime);
  const pathname = url.pathname;

  try {
    if (pathname === '/api/outfit-projects') {
      if (method === 'GET' || method === 'HEAD') return success(service.listProjects());
      if (method === 'POST') {
        const parsed = await parseLibraryRoutePayload('libraryCreateProjectPayloadSchema', body || {});
        if (!parsed.ok) return parsed;
        return success(service.createProject(parsed.value));
      }
    }

    const importEntriesMatch = pathname.match(/^\/api\/outfit-projects\/([^/]+)\/outfits\/import-entries$/);
    if (importEntriesMatch && method === 'POST') {
      const projectId = decodeURIComponent(importEntriesMatch[1]);
      const parsed = await parseLibraryRoutePayload('libraryImportEntriesPayloadSchema', body || {});
      if (!parsed.ok) return parsed;
      return notFoundIfNull(await service.importEntries(projectId, parsed.value), 'Outfit project not found');
    }

    const projectMatch = pathname.match(/^\/api\/outfit-projects\/([^/]+)(?:\/(cover\/upload|outfits))?$/);
    if (projectMatch) {
      const projectId = decodeURIComponent(projectMatch[1]);
      const tail = projectMatch[2] || '';
      if (tail === '' && method === 'PATCH') {
        const parsed = await parseLibraryRoutePayload('libraryUpdateProjectPayloadSchema', body || {});
        if (!parsed.ok) return parsed;
        return notFoundIfNull(service.updateProject(projectId, parsed.value), 'Outfit project not found');
      }
      if (tail === '' && method === 'DELETE') return notFoundIfNull(service.deleteProject(projectId), 'Outfit project not found');
      if (tail === 'cover/upload' && method === 'POST') {
        const parsed = await parseLibraryRoutePayload('libraryAssetUploadPayloadSchema', body || {});
        if (!parsed.ok) return parsed;
        return notFoundIfNull(await service.uploadProjectCover(projectId, parsed.value), 'Outfit project not found');
      }
      if (tail === 'outfits' && (method === 'GET' || method === 'HEAD')) {
        return notFoundIfNull(service.listOutfits(projectId, searchObject(url)), 'Outfit project not found');
      }
    }

    const outfitMatch = pathname.match(/^\/api\/outfits\/([^/]+)(?:\/image\/upload)?$/);
    if (outfitMatch) {
      const outfitId = decodeURIComponent(outfitMatch[1]);
      const isImageUpload = pathname.endsWith('/image/upload');
      if (!isImageUpload && method === 'PATCH') {
        const parsed = await parseLibraryRoutePayload('libraryUpdateOutfitPayloadSchema', body || {});
        if (!parsed.ok) return parsed;
        return notFoundIfNull(service.updateOutfit(outfitId, parsed.value), 'Outfit not found');
      }
      if (!isImageUpload && method === 'DELETE') return notFoundIfNull(service.deleteOutfit(outfitId), 'Outfit not found');
      if (isImageUpload && method === 'POST') {
        const parsed = await parseLibraryRoutePayload('libraryAssetUploadPayloadSchema', body || {});
        if (!parsed.ok) return parsed;
        return notFoundIfNull(await service.replaceOutfitImage(outfitId, parsed.value), 'Outfit not found');
      }
    }

    const tagMatch = pathname.match(/^\/api\/libraries\/outfit\/tags(?:\/([^/]+))?$/);
    if (tagMatch) {
      url.body = body;
      return await dispatchTagRoute({ method, url, tagMatch, service, projectNotFoundDetail: 'Outfit project not found' });
    }

    if (pathname === '/api/libraries/outfit/entries/bulk' && method === 'POST') {
      const parsed = await parseLibraryRoutePayload('libraryBulkEntriesPayloadSchema', body || {});
      if (!parsed.ok) return parsed;
      return notFoundIfNull(service.bulkEntries(parsed.value), 'Outfit project not found');
    }

    return null;
  } catch (error) {
    return failure(400, error instanceof Error ? error.message : String(error));
  }
}

async function dispatchActionLibraryRoute({ method, url, body, runtime }) {
  const service = await getActionLibraryService(runtime);
  const pathname = url.pathname;

  try {
    if (pathname === '/api/action-projects') {
      if (method === 'GET' || method === 'HEAD') return success(service.listProjects());
      if (method === 'POST') {
        const parsed = await parseLibraryRoutePayload('libraryCreateProjectPayloadSchema', body || {});
        if (!parsed.ok) return parsed;
        return success(service.createProject(parsed.value));
      }
    }

    const importEntriesMatch = pathname.match(/^\/api\/action-projects\/([^/]+)\/actions\/import-entries$/);
    if (importEntriesMatch && method === 'POST') {
      const projectId = decodeURIComponent(importEntriesMatch[1]);
      const importService = await getActionFolderImportService(runtime);
      const parsed = await parseLibraryRoutePayload('libraryImportEntriesPayloadSchema', body || {});
      if (!parsed.ok) return parsed;
      return notFoundIfNull(await importService.importActionEntries(projectId, parsed.value), 'Action project not found');
    }

    const importPreviewMatch = pathname.match(/^\/api\/action-projects\/([^/]+)\/actions\/import-folder\/preview$/);
    if (importPreviewMatch && method === 'POST') {
      const projectId = decodeURIComponent(importPreviewMatch[1]);
      const importService = await getActionFolderImportService(runtime);
      const parsed = await parseLibraryRoutePayload('libraryActionImportPreviewPayloadSchema', body || {});
      if (!parsed.ok) return parsed;
      return notFoundIfNull(registerActionImportPreview(importService.previewActionFolderImport(projectId, parsed.value)), 'Action project not found');
    }

    const projectMatch = pathname.match(/^\/api\/action-projects\/([^/]+)(?:\/(cover\/upload|actions))?$/);
    if (projectMatch) {
      const projectId = decodeURIComponent(projectMatch[1]);
      const tail = projectMatch[2] || '';
      if (tail === '' && method === 'PATCH') {
        const parsed = await parseLibraryRoutePayload('libraryUpdateProjectPayloadSchema', body || {});
        if (!parsed.ok) return parsed;
        return notFoundIfNull(service.updateProject(projectId, parsed.value), 'Action project not found');
      }
      if (tail === '' && method === 'DELETE') return notFoundIfNull(service.deleteProject(projectId), 'Action project not found');
      if (tail === 'cover/upload' && method === 'POST') {
        const parsed = await parseLibraryRoutePayload('libraryAssetUploadPayloadSchema', body || {});
        if (!parsed.ok) return parsed;
        return notFoundIfNull(await service.uploadProjectCover(projectId, parsed.value), 'Action project not found');
      }
      if (tail === 'actions' && (method === 'GET' || method === 'HEAD')) {
        return notFoundIfNull(service.listActions(projectId, searchObject(url)), 'Action project not found');
      }
    }

    const actionMatch = pathname.match(/^\/api\/actions\/([^/]+)(?:\/image\/upload)?$/);
    if (actionMatch) {
      const actionId = decodeURIComponent(actionMatch[1]);
      const isImageUpload = pathname.endsWith('/image/upload');
      if (!isImageUpload && method === 'PATCH') {
        const parsed = await parseLibraryRoutePayload('libraryUpdateActionPayloadSchema', body || {});
        if (!parsed.ok) return parsed;
        return notFoundIfNull(service.updateAction(actionId, parsed.value), 'Action not found');
      }
      if (!isImageUpload && method === 'DELETE') return notFoundIfNull(service.deleteAction(actionId), 'Action not found');
      if (isImageUpload && method === 'POST') {
        const parsed = await parseLibraryRoutePayload('libraryAssetUploadPayloadSchema', body || {});
        if (!parsed.ok) return parsed;
        return notFoundIfNull(await service.replaceActionImage(actionId, parsed.value), 'Action not found');
      }
    }

    const tagMatch = pathname.match(/^\/api\/libraries\/action\/tags(?:\/([^/]+))?$/);
    if (tagMatch) {
      url.body = body;
      return await dispatchTagRoute({ method, url, tagMatch, service, projectNotFoundDetail: 'Action project not found' });
    }

    if (pathname === '/api/libraries/action/entries/bulk' && method === 'POST') {
      const parsed = await parseLibraryRoutePayload('libraryBulkEntriesPayloadSchema', body || {});
      if (!parsed.ok) return parsed;
      return notFoundIfNull(service.bulkEntries(parsed.value), 'Action project not found');
    }

    return null;
  } catch (error) {
    return failure(400, error instanceof Error ? error.message : String(error));
  }
}

function isInside(parent, target) {
  const relative = nodePath.relative(nodePath.resolve(parent), nodePath.resolve(target));
  return Boolean(relative) && !relative.startsWith('..') && !nodePath.isAbsolute(relative);
}

function registerLocalApiIpc({ ipcMain, configStore, app, dataRoot }) {
  ipcMain.handle('local-api:request', async (_event, payload = {}) => {
    const method = normalizeMethod(payload.method);
    const url = parseRequestUrl(payload.path);
    const pathname = url.pathname;

    try {
      if ((method === 'GET' || method === 'HEAD') && pathname === '/api/health') {
        return success({ ok: true, transport: 'ipc' });
      }

      if ((method === 'GET' || method === 'HEAD') && pathname === '/api/settings/storage') {
        const { config, runtime } = await getLibraryRuntime({ configStore, app, dataRoot });
        return success(
          runtime
            ? runtime.storageSettingsPayload()
            : {
              configured: Boolean(config?.localLibraryPath),
            }
        );
      }

      if ((method === 'GET' || method === 'HEAD') && pathname === '/api/local-ipc/runtime') {
        const { runtime } = await getLibraryRuntime({ configStore, app, dataRoot });
        if (!runtime) {
          return failure(409, 'Local library path is not configured.');
        }
        return success({
          configured: true,
          dataDir: runtime.dataDir,
          databaseDir: runtime.databaseDir,
          databasePath: runtime.databasePath,
          storageRoot: runtime.storageRoot,
          canvasStorageRoot: runtime.canvasStorageRoot,
          transport: 'ipc',
        });
      }

      if (
        pathname === '/api/model-projects'
        || pathname.startsWith('/api/model-projects/')
        || pathname.startsWith('/api/models/')
        || pathname.startsWith('/api/model-images/')
        || pathname === '/api/libraries/model/tags'
        || pathname.startsWith('/api/libraries/model/tags/')
        || pathname === '/api/libraries/model/entries/bulk'
      ) {
        const { runtime } = await getLibraryRuntime({ configStore, app, dataRoot });
        if (!runtime) return failure(409, 'Local library path is not configured.');
        const result = await dispatchModelLibraryRoute({ method, url, body: payload.body, runtime });
        if (result) return result;
      }

      if (
        pathname === '/api/outfit-projects'
        || pathname.startsWith('/api/outfit-projects/')
        || pathname.startsWith('/api/outfits/')
        || pathname === '/api/libraries/outfit/tags'
        || pathname.startsWith('/api/libraries/outfit/tags/')
        || pathname === '/api/libraries/outfit/entries/bulk'
      ) {
        const { runtime } = await getLibraryRuntime({ configStore, app, dataRoot });
        if (!runtime) return failure(409, 'Local library path is not configured.');
        const result = await dispatchOutfitLibraryRoute({ method, url, body: payload.body, runtime });
        if (result) return result;
      }

      if (
        pathname === '/api/action-projects'
        || pathname.startsWith('/api/action-projects/')
        || pathname.startsWith('/api/actions/')
        || pathname === '/api/libraries/action/tags'
        || pathname.startsWith('/api/libraries/action/tags/')
        || pathname === '/api/libraries/action/entries/bulk'
      ) {
        const { runtime } = await getLibraryRuntime({ configStore, app, dataRoot });
        if (!runtime) return failure(409, 'Local library path is not configured.');
        const result = await dispatchActionLibraryRoute({ method, url, body: payload.body, runtime });
        if (result) return result;
      }

      return notMigrated(pathname);
    } catch (error) {
      return failure(500, error instanceof Error ? error.message : String(error));
    }
  });

  return {
    async resolveAssetUrl(source) {
      let parsed;
      try {
        parsed = new URL(String(source || ''));
      } catch {
        return '';
      }
      if (parsed.protocol !== 'forart-asset:' || parsed.host !== 'library') return '';
      const assetId = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
      if (!assetId) return '';
      const { runtime } = await getLibraryRuntime({ configStore, app, dataRoot });
      if (!runtime) return '';
      const asset = runtime.db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId);
      if (!asset?.path) return '';
      const target = nodePath.isAbsolute(asset.path) ? asset.path : nodePath.join(runtime.storageRoot, asset.path);
      if (!isInside(runtime.storageRoot, target) || !fs.existsSync(target)) return '';
      return target;
    },
    resolveActionImportPreviewUrl(source) {
      let parsed;
      try {
        parsed = new URL(String(source || ''));
      } catch {
        return '';
      }
      if (parsed.protocol !== 'forart-asset:' || parsed.host !== 'action-import-preview') return '';
      const parts = parsed.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
      const previewId = parts[0] || '';
      const rowId = parts[1] || '';
      if (!previewId || !rowId || previewId !== activeActionImportPreview?.id) return '';
      const target = activeActionImportPreview.rows.get(rowId) || '';
      if (!target || !fs.existsSync(target)) return '';
      return target;
    },
    async resolveAssetThumbnailUrl(source) {
      let parsed;
      try {
        parsed = new URL(String(source || ''));
      } catch {
        return '';
      }
      if (parsed.protocol !== 'forart-asset:' || parsed.host !== 'library-thumb') return '';
      const assetId = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
      if (!assetId) return '';
      const { runtime } = await getLibraryRuntime({ configStore, app, dataRoot });
      if (!runtime) return '';
      const asset = runtime.db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId);
      if (!asset?.path) return '';
      const target = nodePath.isAbsolute(asset.path) ? asset.path : nodePath.join(runtime.storageRoot, asset.path);
      if (!isInside(runtime.storageRoot, target) || !fs.existsSync(target)) return '';
      const { ensureLibraryAssetThumbnail } = await libraryAssetThumbnailModule();
      const generated = await ensureLibraryAssetThumbnail(runtime, asset, target);
      if (generated?.filePath && fs.existsSync(generated.filePath)) return generated.filePath;
      return target;
    },
  };
}

module.exports = { registerLocalApiIpc };
