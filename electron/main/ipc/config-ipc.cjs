const fs = require('fs');

async function checkServerHealth(net, baseUrl) {
  try {
    const response = await net.fetch(baseUrl.replace(/\/+$/, '') + '/api/health', { credentials: 'omit' });
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

  ipcMain.handle('config:load-infinite-canvas-settings', async () => configStore.loadInfiniteCanvasSettings());

  ipcMain.handle('config:save-infinite-canvas-settings', async (_event, payload) => {
    const infiniteCanvas = configStore.saveInfiniteCanvasSettings(payload);
    return { ok: true, infiniteCanvas };
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

  ipcMain.handle('dialog:choose-file', async (_event, payload = {}) => {
    const extensions = Array.isArray(payload.extensions)
      ? payload.extensions.map((extension) => String(extension).replace(/^\./, '').trim()).filter(Boolean)
      : [];
    const result = await dialog.showOpenDialog({
      title: String(payload?.title || 'Choose file'),
      properties: ['openFile'],
      filters: extensions.length
        ? [{ name: String(payload?.filterName || 'Files'), extensions }]
        : undefined,
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

  ipcMain.handle('server:login', async (_event, payload = {}) => {
    const baseUrl = String(payload.serverUrl || '').trim().replace(/\/+$/, '');
    const username = String(payload.username || '').trim();
    const password = String(payload.password || '');
    if (!baseUrl || !username || !password) return { ok: false, error: 'Server URL, username and password are required.' };
    try {
      const response = await net.fetch(`${baseUrl}/api/auth/sign-in/username`, {
        method: 'POST',
        credentials: 'omit',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          origin: new URL(baseUrl).origin,
        },
        body: JSON.stringify({ username, password, rememberMe: true }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) return { ok: false, status: response.status, error: body.message || body.detail || 'Login failed.' };
      const token = response.headers.get('set-auth-token') || body.token || '';
      if (!token) return { ok: false, status: 502, error: 'Login succeeded but no session token was returned.' };
      const current = configStore.load() || {};
      const config = configStore.save({
        ...current,
        mode: 'remote',
        serverUrl: baseUrl,
        serverAuthUsername: username,
        serverAuthToken: token,
      });
      activeAppConfig = config;
      return { ok: true, user: body.user, config };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('server:logout', async () => {
    const current = configStore.load() || {};
    const config = configStore.save({ ...current, serverAuthToken: '' });
    activeAppConfig = config;
    return { ok: true, config };
  });

  ipcMain.handle('server:session', async (_event, payload = {}) => {
    const current = configStore.load() || {};
    const baseUrl = String(payload.serverUrl || current.serverUrl || '').trim().replace(/\/+$/, '');
    const token = String(payload.token || current.serverAuthToken || '').trim();
    if (!baseUrl || !token) return { ok: false, status: 401, error: 'Not logged in.' };
    try {
      const response = await net.fetch(`${baseUrl}/api/me`, {
        credentials: 'omit',
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) return { ok: false, status: response.status, error: body.detail || 'Session is invalid.' };
      return { ok: true, user: body.user, permissions: body.permissions || [] };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
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
