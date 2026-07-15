const { app, ipcMain, dialog, protocol, net, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const { createWindow, registerAppWindowIpc } = require('./app-window.cjs');
const { registerCanvasIpc } = require('./ipc/canvas-ipc.cjs');
const { registerConfigIpc } = require('./ipc/config-ipc.cjs');
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
const { createGenerationTaskStore } = require('./modules/generation-task-store.cjs');
const { createImageGenerationRunner } = require('./modules/image-generation-runner.cjs');
const { createImageReviewStore } = require('./modules/image-review-store.cjs');
const { createLibtvAdapter } = require('./modules/libtv-adapter.cjs');
const { createLibtvGenerationRunner } = require('./modules/libtv-generation-runner.cjs');
const { createLibtvGenerationTaskStore } = require('./modules/libtv-generation-task-store.cjs');
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
const canvasCacheStore = createCanvasCacheStore({ rootDir: portableRootDir, assetStore, canvasStore, shell });
const canvasPackageStore = createCanvasPackageStore({ rootDir: appRootDir, dialog, canvasStore, assetStore });
const configStore = createConfigStore({ app, rootDir: portableRootDir });
const generationTaskStore = createGenerationTaskStore();
const actionFolderImportStore = createActionFolderImportStore();
const imageGenerationRunner = createImageGenerationRunner({ net, assetStore, canvasStore, generationTaskStore });
const imageReviewStore = createImageReviewStore();
const libtv = createLibtvAdapter({ rootDir: appRootDir });
const libtvGenerationTaskStore = createLibtvGenerationTaskStore();
const libtvGenerationRunner = createLibtvGenerationRunner({
  libtv,
  assetStore,
  canvasStore,
  taskStore: libtvGenerationTaskStore,
  resolveWorkspaceName: () => createLibtvWorkspaceName(configStore.loadApiSettings().libtvMachineId),
  resolveActionFissionConcurrency: () => configStore.loadApiSettings().libtvActionFissionConcurrency,
});
const portableUpdater = createPortableUpdater({ app, rootDir: appRootDir, dataRoot: portableRootDir, net });
let localApi = null;
let mainWindow = null;

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

registerCanvasIpc({ ipcMain, app, canvasStore, assetStore, canvasPackageStore, generationTaskStore, imageGenerationRunner, libtvGenerationRunner });
ipcMain.handle('canvas-cache:scan', async () => canvasCacheStore.scan());
ipcMain.handle('canvas-cache:delete', async (_event, payload) => canvasCacheStore.deleteAssets(payload));
ipcMain.handle('canvas-cache:reveal', async (_event, payload) => canvasCacheStore.revealAsset(payload));
ipcMain.handle('canvas-cache:open-root', async () => canvasCacheStore.openRoot());
registerImageReviewIpc({ ipcMain, dialog, imageReviewStore });
registerLibtvIpc({ ipcMain, libtv, libtvGenerationRunner });
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
  mainWindow = await createWindow({ rootDir: appRootDir, isDev });
});

app.on('before-quit', () => localApi?.close?.());

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
