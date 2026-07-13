const fs = require('fs');

async function checkServerHealth(net, baseUrl) {
  try {
    const response = await net.fetch(baseUrl.replace(/\/+$/, '') + '/api/health');
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, payload: await response.json() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function registerConfigIpc({ ipcMain, dialog, configStore, app, net }) {
  let activeAppConfig = null;

  ipcMain.handle('config:load', async () => {
    try {
      const config = configStore.load();
      if (!config) return null;
      activeAppConfig = config;
      return config;
    } catch {
      return null;
    }
  });

  ipcMain.handle('config:save', async (_event, payload) => {
    const config = configStore.save(payload);
    activeAppConfig = config;
    return { ok: true, config };
  });

  ipcMain.handle('config:load-api-settings', async () => configStore.loadApiSettings());

  ipcMain.handle('config:save-api-settings', async (_event, payload) => {
    const apiSettings = configStore.saveApiSettings(payload);
    return { ok: true, apiSettings };
  });

  ipcMain.handle('config:load-image-review-settings', async () => configStore.loadImageReviewSettings());

  ipcMain.handle('config:save-image-review-settings', async (_event, payload) => {
    const imageReview = configStore.saveImageReviewSettings(payload);
    return { ok: true, imageReview };
  });

  ipcMain.handle('config:default-paths', async () => ({
    imageDownloadPath: app.getPath('downloads'),
  }));

  ipcMain.handle('dialog:choose-directory', async (_event, payload = {}) => {
    const result = await dialog.showOpenDialog({
      title: String(payload?.title || 'Choose Forart asset library folder'),
      properties: ['openDirectory', 'createDirectory'],
    });

    return {
      canceled: result.canceled,
      path: result.filePaths[0] || '',
    };
  });

  ipcMain.handle('server:test-remote', async (_event, serverUrl) => {
    const baseUrl = String(serverUrl || '').trim();
    if (!baseUrl) return { ok: false, error: 'Server URL is required' };
    return checkServerHealth(net, baseUrl);
  });

  ipcMain.handle('server:local-status', async () => {
    const config = activeAppConfig || configStore.load();
    if (!config?.localLibraryPath) {
      return { ok: false, managed: false, localLibraryPath: '', error: 'Local library path is not configured.' };
    }
    try {
      if (!fs.statSync(config.localLibraryPath).isDirectory()) throw new Error('Local library path is not a directory.');
      fs.accessSync(config.localLibraryPath, fs.constants.R_OK | fs.constants.W_OK);
    } catch (error) {
      return {
        ok: false,
        managed: false,
        transport: 'ipc',
        localLibraryPath: config.localLibraryPath,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    return {
      ok: true,
      managed: false,
      transport: 'ipc',
      localLibraryPath: config.localLibraryPath,
      payload: { ok: true, transport: 'ipc' },
    };
  });

  return { getActiveConfig: () => activeAppConfig };
}

module.exports = { registerConfigIpc };
