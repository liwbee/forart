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
let activeRuntime = null;
let activeRuntimeKey = '';
let activeModelService = null;
let activeModelServiceKey = '';
let activeOutfitService = null;
let activeOutfitServiceKey = '';
let activeActionService = null;
let activeActionServiceKey = '';

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

async function getModelLibraryService(runtime) {
  if (activeModelService && activeModelServiceKey === activeRuntimeKey) return activeModelService;
  const { createModelLibraryService } = await modelLibraryModule();
  activeModelService = createModelLibraryService(runtime, { localAssetUrl: localLibraryAssetUrl });
  activeModelServiceKey = activeRuntimeKey;
  return activeModelService;
}

async function getOutfitLibraryService(runtime) {
  if (activeOutfitService && activeOutfitServiceKey === activeRuntimeKey) return activeOutfitService;
  const { createOutfitLibraryService } = await outfitLibraryModule();
  activeOutfitService = createOutfitLibraryService(runtime, { localAssetUrl: localLibraryAssetUrl });
  activeOutfitServiceKey = activeRuntimeKey;
  return activeOutfitService;
}

async function getActionLibraryService(runtime) {
  if (activeActionService && activeActionServiceKey === activeRuntimeKey) return activeActionService;
  const { createActionLibraryService } = await actionLibraryModule();
  activeActionService = createActionLibraryService(runtime, { localAssetUrl: localLibraryAssetUrl });
  activeActionServiceKey = activeRuntimeKey;
  return activeActionService;
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
    gender: url.searchParams.get('gender') || '',
  };
}

function notFoundIfNull(result, detail) {
  return result ? success(result) : failure(404, detail);
}

function dispatchTagRoute({ method, url, tagMatch, service, projectNotFoundDetail }) {
  const tagId = tagMatch[1] ? decodeURIComponent(tagMatch[1]) : '';
  const projectId = url.searchParams.get('project_id') || '';
  if (!projectId) return failure(400, 'project_id is required');
  if (!service.projectExists(projectId)) return failure(404, projectNotFoundDetail);
  if (!tagId && (method === 'GET' || method === 'HEAD')) return success({ tags: service.listTags(projectId) });
  if (!tagId && method === 'POST') return notFoundIfNull(service.createTag(projectId, url.body || {}), projectNotFoundDetail);
  if (tagId && method === 'PATCH') return notFoundIfNull(service.updateTag(projectId, tagId, url.body || {}), 'Tag not found');
  if (tagId && method === 'DELETE') return success(service.deleteTag(projectId, tagId));
  return null;
}

async function dispatchModelLibraryRoute({ method, url, body, runtime }) {
  const service = await getModelLibraryService(runtime);
  const pathname = url.pathname;

  try {
    if (pathname === '/api/model-projects') {
      if (method === 'GET' || method === 'HEAD') return success(service.listProjects());
      if (method === 'POST') return success(service.createProject(body || {}));
    }

    const projectMatch = pathname.match(/^\/api\/model-projects\/([^/]+)(?:\/(cover\/upload|models))?$/);
    if (projectMatch) {
      const projectId = decodeURIComponent(projectMatch[1]);
      const tail = projectMatch[2] || '';
      if (tail === '' && method === 'PATCH') return notFoundIfNull(service.updateProject(projectId, body || {}), 'Model project not found');
      if (tail === '' && method === 'DELETE') return notFoundIfNull(service.deleteProject(projectId), 'Model project not found');
      if (tail === 'cover/upload' && method === 'POST') return notFoundIfNull(service.uploadProjectCover(projectId, body || {}), 'Model project not found');
      if (tail === 'models' && (method === 'GET' || method === 'HEAD')) {
        return notFoundIfNull(service.listModels(projectId, searchObject(url)), 'Model project not found');
      }
      if (tail === 'models' && method === 'POST') return notFoundIfNull(service.createModel(projectId, body || {}), 'Model project not found');
    }

    const modelMatch = pathname.match(/^\/api\/models\/([^/]+)(?:\/(images|images\/upload))?$/);
    if (modelMatch) {
      const modelId = decodeURIComponent(modelMatch[1]);
      const tail = modelMatch[2] || '';
      if (tail === '' && method === 'PATCH') return notFoundIfNull(service.updateModel(modelId, body || {}), 'Model not found');
      if (tail === '' && method === 'DELETE') return notFoundIfNull(service.deleteModel(modelId), 'Model not found');
      if (tail === 'images' && (method === 'GET' || method === 'HEAD')) return notFoundIfNull(service.listImages(modelId), 'Model not found');
      if (tail === 'images' && method === 'POST') return notFoundIfNull(service.addImage(modelId, body || {}), 'Model not found');
      if (tail === 'images/upload' && method === 'POST') return notFoundIfNull(service.uploadImage(modelId, body || {}), 'Model not found');
    }

    const imageMatch = pathname.match(/^\/api\/model-images\/([^/]+)$/);
    if (imageMatch && method === 'DELETE') {
      return notFoundIfNull(service.deleteImage(decodeURIComponent(imageMatch[1])), 'Model image not found');
    }

    const tagMatch = pathname.match(/^\/api\/libraries\/model\/tags(?:\/([^/]+))?$/);
    if (tagMatch) {
      url.body = body;
      return dispatchTagRoute({ method, url, tagMatch, service, projectNotFoundDetail: 'Model project not found' });
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
      if (method === 'POST') return success(service.createProject(body || {}));
    }

    const projectMatch = pathname.match(/^\/api\/outfit-projects\/([^/]+)(?:\/(cover\/upload|outfits))?$/);
    if (projectMatch) {
      const projectId = decodeURIComponent(projectMatch[1]);
      const tail = projectMatch[2] || '';
      if (tail === '' && method === 'PATCH') return notFoundIfNull(service.updateProject(projectId, body || {}), 'Outfit project not found');
      if (tail === '' && method === 'DELETE') return notFoundIfNull(service.deleteProject(projectId), 'Outfit project not found');
      if (tail === 'cover/upload' && method === 'POST') return notFoundIfNull(service.uploadProjectCover(projectId, body || {}), 'Outfit project not found');
      if (tail === 'outfits' && (method === 'GET' || method === 'HEAD')) {
        return notFoundIfNull(service.listOutfits(projectId, searchObject(url)), 'Outfit project not found');
      }
      if (tail === 'outfits' && method === 'POST') return notFoundIfNull(service.createOutfit(projectId, body || {}), 'Outfit project not found');
    }

    const outfitMatch = pathname.match(/^\/api\/outfits\/([^/]+)(?:\/image\/upload)?$/);
    if (outfitMatch) {
      const outfitId = decodeURIComponent(outfitMatch[1]);
      const isImageUpload = pathname.endsWith('/image/upload');
      if (!isImageUpload && method === 'PATCH') return notFoundIfNull(service.updateOutfit(outfitId, body || {}), 'Outfit not found');
      if (!isImageUpload && method === 'DELETE') return notFoundIfNull(service.deleteOutfit(outfitId), 'Outfit not found');
      if (isImageUpload && method === 'POST') return notFoundIfNull(service.replaceOutfitImage(outfitId, body || {}), 'Outfit not found');
    }

    const tagMatch = pathname.match(/^\/api\/libraries\/outfit\/tags(?:\/([^/]+))?$/);
    if (tagMatch) {
      url.body = body;
      return dispatchTagRoute({ method, url, tagMatch, service, projectNotFoundDetail: 'Outfit project not found' });
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
      if (method === 'POST') return success(service.createProject(body || {}));
    }

    const projectMatch = pathname.match(/^\/api\/action-projects\/([^/]+)(?:\/(cover\/upload|actions))?$/);
    if (projectMatch) {
      const projectId = decodeURIComponent(projectMatch[1]);
      const tail = projectMatch[2] || '';
      if (tail === '' && method === 'PATCH') return notFoundIfNull(service.updateProject(projectId, body || {}), 'Action project not found');
      if (tail === '' && method === 'DELETE') return notFoundIfNull(service.deleteProject(projectId), 'Action project not found');
      if (tail === 'cover/upload' && method === 'POST') return notFoundIfNull(service.uploadProjectCover(projectId, body || {}), 'Action project not found');
      if (tail === 'actions' && (method === 'GET' || method === 'HEAD')) {
        return notFoundIfNull(service.listActions(projectId, searchObject(url)), 'Action project not found');
      }
      if (tail === 'actions' && method === 'POST') return notFoundIfNull(service.createAction(projectId, body || {}), 'Action project not found');
    }

    const actionMatch = pathname.match(/^\/api\/actions\/([^/]+)(?:\/image\/upload)?$/);
    if (actionMatch) {
      const actionId = decodeURIComponent(actionMatch[1]);
      const isImageUpload = pathname.endsWith('/image/upload');
      if (!isImageUpload && method === 'PATCH') return notFoundIfNull(service.updateAction(actionId, body || {}), 'Action not found');
      if (!isImageUpload && method === 'DELETE') return notFoundIfNull(service.deleteAction(actionId), 'Action not found');
      if (isImageUpload && method === 'POST') return notFoundIfNull(service.replaceActionImage(actionId, body || {}), 'Action not found');
    }

    const tagMatch = pathname.match(/^\/api\/libraries\/action\/tags(?:\/([^/]+))?$/);
    if (tagMatch) {
      url.body = body;
      return dispatchTagRoute({ method, url, tagMatch, service, projectNotFoundDetail: 'Action project not found' });
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
  };
}

module.exports = { registerLocalApiIpc };
