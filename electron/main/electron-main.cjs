const { app, ipcMain, dialog, protocol, net, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const { createWindow } = require('./app-window.cjs');
const { registerCanvasIpc } = require('./ipc/canvas-ipc.cjs');
const { registerConfigIpc } = require('./ipc/config-ipc.cjs');
const { registerLibtvIpc } = require('./ipc/libtv-ipc.cjs');
const { createAssetStore } = require('./modules/asset-store.cjs');
const { createCanvasStore } = require('./modules/canvas-store.cjs');
const { createConfigStore } = require('./modules/config-store.cjs');
const { createLibtvAdapter } = require('./modules/libtv-adapter.cjs');
const { createLocalServerManager } = require('./modules/local-server-manager.cjs');

const rootDir = path.resolve(__dirname, '..', '..');
const isDev = !app.isPackaged;

protocol.registerSchemesAsPrivileged([
  { scheme: 'forart-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

const assetStore = createAssetStore({ rootDir, net });
const canvasStore = createCanvasStore({ rootDir });
const configStore = createConfigStore({ app });
const localServer = createLocalServerManager({ app, rootDir });
const libtv = createLibtvAdapter({ rootDir });

function registerCanvasAssetProtocol() {
  protocol.handle('forart-asset', (request) => {
    const target = assetStore.resolveAssetUrl(request.url);
    if (!target || !fs.existsSync(target)) {
      return new Response('Asset not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(target).toString());
  });
}

registerCanvasIpc({ ipcMain, app, canvasStore, assetStore });
registerLibtvIpc({ ipcMain, libtv });
registerConfigIpc({ ipcMain, dialog, configStore, localServer, app, rootDir, net, shell });

app.whenReady().then(() => {
  registerCanvasAssetProtocol();
  createWindow({ rootDir, isDev });
});

app.on('window-all-closed', () => {
  localServer.stop();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  localServer.stop();
});
