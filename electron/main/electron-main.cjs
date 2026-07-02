const { app, ipcMain, dialog, protocol, net, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const { createWindow } = require('./app-window.cjs');
const { registerCanvasIpc } = require('./ipc/canvas-ipc.cjs');
const { registerConfigIpc } = require('./ipc/config-ipc.cjs');
const { registerImageReviewIpc } = require('./ipc/image-review-ipc.cjs');
const { registerLibtvIpc } = require('./ipc/libtv-ipc.cjs');
const { createAssetStore } = require('./modules/asset-store.cjs');
const { createCanvasCacheStore } = require('./modules/canvas-cache-store.cjs');
const { createCanvasStore } = require('./modules/canvas-store.cjs');
const { createConfigStore } = require('./modules/config-store.cjs');
const { createGenerationTaskStore } = require('./modules/generation-task-store.cjs');
const { createImageGenerationRunner } = require('./modules/image-generation-runner.cjs');
const { createImageReviewStore } = require('./modules/image-review-store.cjs');
const { createLibtvAdapter } = require('./modules/libtv-adapter.cjs');
const { createLibtvGenerationRunner } = require('./modules/libtv-generation-runner.cjs');
const { createLocalServerManager } = require('./modules/local-server-manager.cjs');

const rootDir = path.resolve(__dirname, '..', '..');
const isDev = !app.isPackaged;
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

const assetStore = createAssetStore({ rootDir, net });
const canvasStore = createCanvasStore({ rootDir });
const canvasCacheStore = createCanvasCacheStore({ rootDir, assetStore, canvasStore, shell });
const configStore = createConfigStore({ app, rootDir });
const generationTaskStore = createGenerationTaskStore({ rootDir });
const imageGenerationRunner = createImageGenerationRunner({ net, assetStore, generationTaskStore });
const imageReviewStore = createImageReviewStore();
const localServer = createLocalServerManager({ app, rootDir });
const libtv = createLibtvAdapter({ rootDir });
const libtvGenerationRunner = createLibtvGenerationRunner({ libtv, assetStore });
let mainWindow = null;

function registerCanvasAssetProtocol() {
  protocol.handle('forart-asset', (request) => {
    const target = assetStore.resolveAssetUrl(request.url);
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
    return new Response(fs.readFileSync(target), {
      headers: { 'content-type': imageReviewStore.imageMimeType(target) },
    });
  });
}

registerCanvasIpc({ ipcMain, app, canvasStore, assetStore, generationTaskStore, imageGenerationRunner });
ipcMain.handle('canvas-cache:scan', async () => canvasCacheStore.scan());
ipcMain.handle('canvas-cache:delete', async (_event, payload) => canvasCacheStore.deleteAssets(payload));
ipcMain.handle('canvas-cache:reveal', async (_event, payload) => canvasCacheStore.revealAsset(payload));
ipcMain.handle('canvas-cache:open-root', async () => canvasCacheStore.openRoot());
registerImageReviewIpc({ ipcMain, imageReviewStore });
registerLibtvIpc({ ipcMain, libtv, libtvGenerationRunner });
registerConfigIpc({ ipcMain, dialog, configStore, localServer, app, rootDir, net, shell });
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
  mainWindow = await createWindow({ rootDir, isDev });
});

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.on('window-all-closed', () => {
  localServer.stop();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  localServer.stop();
});
