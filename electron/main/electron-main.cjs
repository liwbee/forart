const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const rootDir = path.resolve(__dirname, '..', '..');
const bundledServerDir = path.join(rootDir, 'server');
const bundledServerEntry = path.join(bundledServerDir, 'forart-server.mjs');
const serverNodeExe = process.env.FORART_SERVER_NODE || 'node';
const LOCAL_SERVER_PORT = 5175;
const isDev = !app.isPackaged;
let serverProcess = null;
let activeLocalServerConfig = null;

function configPath() {
  return path.join(app.getPath('userData'), 'forart-config.json');
}

function normalizeConfig(payload = {}) {
  const mode = payload.mode === 'remote' ? 'remote' : 'local';
  return {
    mode,
    localLibraryPath: String(payload.localLibraryPath || '').trim(),
    serverUrl: String(payload.serverUrl || '').trim().replace(/\/+$/, ''),
    accessToken: String(payload.accessToken || '').trim(),
  };
}

function localServerEnv(config) {
  const libraryRoot = path.resolve(config.localLibraryPath || path.join(app.getPath('userData'), 'library'));
  return {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(LOCAL_SERVER_PORT),
    FORART_CONFIG_DIR: path.join(libraryRoot, '.forart', 'config'),
    FORART_DATA_DIR: path.join(libraryRoot, 'library'),
    FORART_REVIEW_DIR: path.join(libraryRoot, 'review'),
  };
}

async function checkHttpHealth(baseUrl) {
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/health`);
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, payload: await response.json() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function waitForLocalServer() {
  const baseUrl = `http://127.0.0.1:${LOCAL_SERVER_PORT}`;
  for (let i = 0; i < 30; i += 1) {
    const health = await checkHttpHealth(baseUrl);
    if (health.ok) return health;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { ok: false, error: 'Local server did not become ready in time' };
}

async function ensureLocalServer(config) {
  if (config.mode !== 'local' || !config.localLibraryPath) {
    stopLocalServer();
    return { ok: false, skipped: true };
  }

  const currentHealth = await checkHttpHealth(`http://127.0.0.1:${LOCAL_SERVER_PORT}`);
  if (currentHealth.ok && serverProcess) return currentHealth;
  if (currentHealth.ok && !serverProcess) return { ...currentHealth, external: true };

  if (!fs.existsSync(bundledServerEntry)) {
    return { ok: false, error: `Bundled server not found: ${bundledServerEntry}` };
  }

  fs.mkdirSync(config.localLibraryPath, { recursive: true });
  activeLocalServerConfig = config;
  serverProcess = spawn(serverNodeExe, [bundledServerEntry], {
    cwd: bundledServerDir,
    env: localServerEnv(config),
    windowsHide: true,
  });

  serverProcess.stdout.on('data', (data) => console.log(`[forart-server] ${data}`));
  serverProcess.stderr.on('data', (data) => console.error(`[forart-server] ${data}`));
  serverProcess.on('exit', (code) => {
    console.log(`[forart-server] exited ${code}`);
    serverProcess = null;
  });

  return waitForLocalServer();
}

function stopLocalServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  activeLocalServerConfig = null;
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 940,
    minHeight: 620,
    backgroundColor: '#f5f7fb',
    title: 'Forart',
    webPreferences: {
      preload: path.join(rootDir, 'electron', 'preload', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    await win.loadURL('http://127.0.0.1:5174');
  } else {
    await win.loadFile(path.join(rootDir, 'dist', 'index.html'));
  }
}

ipcMain.handle('save-result', async (_event, payload) => {
  const result = await dialog.showSaveDialog({
    title: 'Save transparent PNG',
    defaultPath: payload.defaultName || 'cutout.png',
    filters: [{ name: 'PNG Image', extensions: ['png'] }],
  });

  if (result.canceled || !result.filePath) return { canceled: true };

  const base64 = payload.dataUrl.replace(/^data:image\/png;base64,/, '');
  fs.writeFileSync(result.filePath, Buffer.from(base64, 'base64'));
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle('config:load', async () => {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    const config = normalizeConfig(JSON.parse(raw));
    if (config.mode === 'local') await ensureLocalServer(config);
    return config;
  } catch {
    return null;
  }
});

ipcMain.handle('config:save', async (_event, payload) => {
  const config = normalizeConfig(payload);
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  if (config.mode === 'local') {
    await ensureLocalServer(config);
  } else {
    stopLocalServer();
  }
  return { ok: true, config };
});

ipcMain.handle('dialog:choose-directory', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Choose Forart asset library folder',
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
  return checkHttpHealth(baseUrl);
});

ipcMain.handle('server:local-status', async () => {
  const health = await checkHttpHealth(`http://127.0.0.1:${LOCAL_SERVER_PORT}`);
  return {
    ...health,
    managed: Boolean(serverProcess),
    localLibraryPath: activeLocalServerConfig?.localLibraryPath || '',
  };
});

app.whenReady().then(() => {
  createWindow();
});

app.on('window-all-closed', () => {
  stopLocalServer();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopLocalServer();
});
