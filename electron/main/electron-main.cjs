const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const { createWindow } = require('./app-window.cjs');
const { registerCanvasIpc } = require('./ipc/canvas-ipc.cjs');
const { registerConfigIpc } = require('./ipc/config-ipc.cjs');
const { registerImageReviewIpc } = require('./ipc/image-review-ipc.cjs');
const { registerLocalApiIpc } = require('./ipc/local-api-ipc.cjs');
const { registerLibtvIpc } = require('./ipc/libtv-ipc.cjs');
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

const isDev = !app.isPackaged;
const appRootDir = isDev ? path.resolve(__dirname, '..', '..') : path.join(process.resourcesPath, 'app');
const portableRootDir = isDev ? appRootDir : path.dirname(app.getPath('exe'));
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
const generationTaskStore = createGenerationTaskStore({ rootDir: portableRootDir });
const imageGenerationRunner = createImageGenerationRunner({ net, assetStore, generationTaskStore });
const imageReviewStore = createImageReviewStore();
const libtv = createLibtvAdapter({ rootDir: appRootDir });
const libtvGenerationRunner = createLibtvGenerationRunner({ libtv, assetStore });
let localApi = null;
let mainWindow = null;

function registerCanvasAssetProtocol() {
  protocol.handle('forart-asset', async (request) => {
    const target = assetStore.resolveAssetUrl(request.url) || await localApi?.resolveAssetUrl?.(request.url);
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

registerCanvasIpc({ ipcMain, app, canvasStore, assetStore, canvasPackageStore, generationTaskStore, imageGenerationRunner });
ipcMain.handle('canvas-cache:scan', async () => canvasCacheStore.scan());
ipcMain.handle('canvas-cache:delete', async (_event, payload) => canvasCacheStore.deleteAssets(payload));
ipcMain.handle('canvas-cache:reveal', async (_event, payload) => canvasCacheStore.revealAsset(payload));
ipcMain.handle('canvas-cache:open-root', async () => canvasCacheStore.openRoot());
registerImageReviewIpc({ ipcMain, imageReviewStore });
registerLibtvIpc({ ipcMain, libtv, libtvGenerationRunner });
localApi = registerLocalApiIpc({ ipcMain, configStore, app, dataRoot: portableRootDir });
registerConfigIpc({ ipcMain, dialog, configStore, app, rootDir: appRootDir, dataRoot: portableRootDir, net });
ipcMain.handle('window:minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.minimize();
  return { ok: true };
});
ipcMain.handle('window:toggle-maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { ok: false };
  if (win.isMaximized()) {
    win.unmaximize();
  } else {
    win.maximize();
  }
  return { ok: true, maximized: win.isMaximized() };
});
ipcMain.handle('window:close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.close();
  return { ok: true };
});
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

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
