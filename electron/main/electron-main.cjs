const { app, ipcMain, dialog, protocol, net, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const { createWindow, registerAppWindowIpc } = require('./app-window.cjs');
const { registerCanvasIpc } = require('./ipc/canvas-ipc.cjs');
const { registerConfigIpc } = require('./ipc/config-ipc.cjs');
const { registerGenerationTaskIpc } = require('./ipc/generation-task-ipc.cjs');
const { registerImageReviewIpc } = require('./ipc/image-review-ipc.cjs');
const { registerLocalApiIpc } = require('./ipc/local-api-ipc.cjs');
const { registerLibtvIpc } = require('./ipc/libtv-ipc.cjs');
const { registerUpdaterIpc } = require('./ipc/updater-ipc.cjs');
const { createActionFolderImportStore } = require('./modules/action-folder-import-store.cjs');
const { createAssetStore } = require('./modules/asset-store.cjs');
const { createCanvasCacheStore } = require('./modules/canvas-cache-store.cjs');
const { createCanvasPackageStore } = require('./modules/canvas-package-store.cjs');
const { createCanvasStore } = require('./modules/canvas-store.cjs');
const { createConfigStore } = require('./modules/config-store.cjs');
const { createGenerationTaskRepository } = require('./modules/generation/generation-task-repository.cjs');
const { createGenerationResultCommitter } = require('./modules/generation/generation-result-committer.cjs');
const { createGenerationTaskCleanup } = require('./modules/generation/generation-task-cleanup.cjs');
const { createGenerationTaskService } = require('./modules/generation/generation-task-service.cjs');
const { createImageGenerationRunner } = require('./modules/image-generation-runner.cjs');
const { createImageReviewStore } = require('./modules/image-review-store.cjs');
const { createLibtvAdapter } = require('./modules/libtv-adapter.cjs');
const { createLibtvGenerationRunner } = require('./modules/libtv-generation-runner.cjs');
const { createLibtvWorkspaceName } = require('./modules/libtv-workspace.cjs');
const { createPortableUpdater } = require('./modules/portable-updater.cjs');

const isDev = !app.isPackaged;
const appRootDir = isDev ? path.resolve(__dirname, '..', '..') : path.join(process.resourcesPath, 'app');
const configuredDataRoot = String(process.env.FORART_DATA_ROOT || '').trim();
const portableRootDir = configuredDataRoot
  ? path.resolve(configuredDataRoot)
  : isDev ? appRootDir : path.dirname(app.getPath('exe'));
const gotSingleInstanceLock = app.requestSingleInstanceLock();
const CANVAS_NODES_CLIPBOARD_KIND = 'forart.canvas.nodes';

if (!gotSingleInstanceLock) {
  app.quit();
  return;
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'forart-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'forart-review', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

const assetStore = createAssetStore({ rootDir: portableRootDir, net });
const canvasStore = createCanvasStore({ rootDir: portableRootDir });
const generationTaskRepository = createGenerationTaskRepository({ rootDir: portableRootDir });
const canvasCacheStore = createCanvasCacheStore({ assetStore, canvasStore, generationTaskRepository, shell });
const canvasPackageStore = createCanvasPackageStore({ rootDir: appRootDir, dialog, canvasStore, assetStore });
const configStore = createConfigStore({ app, rootDir: portableRootDir });
const generationResultCommitter = createGenerationResultCommitter({ repository: generationTaskRepository, canvasStore });
const generationTaskService = createGenerationTaskService({ repository: generationTaskRepository });
const generationTaskStore = generationTaskService.createStoreAdapter('api');
const libtvGenerationTaskStore = generationTaskService.createStoreAdapter('libtv');
const generationTaskCleanup = createGenerationTaskCleanup({
  repository: generationTaskRepository,
  findMissingTargets: (heads) => canvasStore.findMissingGenerationTargets(heads),
  onTasksDeleted: (taskIds) => generationTaskService.removeTasks(taskIds),
});
const actionFolderImportStore = createActionFolderImportStore();
const imageGenerationRunner = createImageGenerationRunner({ net, assetStore, canvasStore, generationTaskStore, resultCommitter: generationResultCommitter });
const imageReviewStore = createImageReviewStore();
const libtv = createLibtvAdapter({ rootDir: appRootDir });
const libtvGenerationRunner = createLibtvGenerationRunner({
  libtv,
  assetStore,
  canvasStore,
  taskStore: libtvGenerationTaskStore,
  resultCommitter: generationResultCommitter,
  resolveWorkspaceName: () => createLibtvWorkspaceName(configStore.loadApiSettings().libtvMachineId),
  resolveActionFissionConcurrency: () => configStore.loadApiSettings().libtvActionFissionConcurrency,
});
generationTaskService.registerExecutor('api', {
  startTask: imageGenerationRunner.startTask,
  startTasks: imageGenerationRunner.startTasks,
  stopTask: imageGenerationRunner.stopTask,
  recoverPersistedTasks: imageGenerationRunner.recoverPersistedTasks,
});
generationTaskService.registerExecutor('libtv', {
  startTask: libtvGenerationRunner.startImageTask,
  startTasks: libtvGenerationRunner.startImageTasks,
  stopTask: libtvGenerationRunner.stopImageTask,
  recoverPersistedTasks: libtvGenerationRunner.recoverPersistedTasks,
});
const portableUpdater = createPortableUpdater({ app, rootDir: appRootDir, dataRoot: portableRootDir, net });
let localApi = null;
let mainWindow = null;
const disposeGenerationTaskIpc = registerGenerationTaskIpc({
  ipcMain,
  generationTaskService,
  getWebContents: () => mainWindow?.webContents,
});

function registerCanvasAssetProtocol() {
  protocol.handle('forart-asset', async (request) => {
    const target = assetStore.resolveAssetUrl(request.url)
      || await localApi?.resolveAssetUrl?.(request.url)
      || await localApi?.resolveAssetThumbnailUrl?.(request.url)
      || actionFolderImportStore.resolvePreviewUrl(request.url);
    if (!target || !fs.existsSync(target)) {
      return new Response('Asset not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(target).toString());
  });
}

function registerImageReviewProtocol() {
  protocol.handle('forart-review', (request) => {
    const target = imageReviewStore.resolveImageUrl(request.url);
    if (!target || !fs.existsSync(target)) {
      return new Response('Image not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(target).toString());
  });
}

registerCanvasIpc({ ipcMain, app, canvasStore, assetStore, canvasPackageStore, generationTaskService });
ipcMain.handle('canvas-cache:scan', async () => canvasCacheStore.scan());
ipcMain.handle('canvas-cache:delete', async (_event, payload) => {
  const result = await canvasCacheStore.deleteAssets(payload);
  try {
    generationTaskCleanup.run({ force: true });
  } catch (error) {
    console.error('Generation task cleanup after cache deletion failed:', error);
  }
  return result;
});
ipcMain.handle('canvas-cache:reveal', async (_event, payload) => canvasCacheStore.revealAsset(payload));
ipcMain.handle('canvas-cache:open-root', async () => canvasCacheStore.openRoot());
registerImageReviewIpc({ ipcMain, dialog, imageReviewStore });
registerLibtvIpc({ ipcMain, libtv });
localApi = registerLocalApiIpc({ ipcMain, configStore, app, dataRoot: portableRootDir });
registerConfigIpc({ ipcMain, dialog, configStore, app, net });
registerUpdaterIpc({ ipcMain, updater: portableUpdater });
registerAppWindowIpc({ ipcMain });
ipcMain.handle('action-import:choose-folder', async (_event, payload = {}) => actionFolderImportStore.chooseFolder(payload));
ipcMain.handle('action-import:scan', async (_event, payload = {}) => actionFolderImportStore.scan(payload));
ipcMain.handle('action-import:start-scan', async (event, payload = {}) => actionFolderImportStore.startScan(event.sender, payload));
ipcMain.handle('action-import:cancel-scan', async (_event, payload = {}) => actionFolderImportStore.cancelScan(payload));
ipcMain.handle('action-import:read-entry', async (_event, payload = {}) => actionFolderImportStore.readEntry(payload));
ipcMain.handle('action-import:clear-preview', async () => actionFolderImportStore.clearPreview());
ipcMain.handle('canvas:write-clipboard', async (_event, payload = {}) => {
  clipboard.writeText(JSON.stringify({
    kind: CANVAS_NODES_CLIPBOARD_KIND,
    version: 1,
    ...payload,
  }));
  return { ok: true };
});

app.whenReady().then(async () => {
  registerCanvasAssetProtocol();
  registerImageReviewProtocol();
  try {
    const commitRecovery = generationResultCommitter.recoverPending();
    if (commitRecovery.errors.length) {
      console.error('Generation result commit recovery completed with errors:', commitRecovery.errors);
    }
  } catch (error) {
    console.error('Generation result commit recovery failed:', error);
  }
  try {
    await generationTaskService.recoverActiveTasks({
      api: { providers: configStore.loadApiSettings().providers },
    });
  } catch (error) {
    console.error('Generation active task recovery failed:', error);
  }
  try {
    generationTaskCleanup.run();
  } catch (error) {
    console.error('Generation task startup cleanup failed:', error);
  }
  generationTaskCleanup.start();
  mainWindow = await createWindow({ rootDir: appRootDir, isDev });
});

app.on('before-quit', () => {
  localApi?.close?.();
});
app.on('will-quit', () => {
  generationTaskCleanup.stop();
  disposeGenerationTaskIpc();
  generationTaskRepository.close();
});

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
