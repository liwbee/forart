const { app, BrowserWindow, ipcMain, dialog, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const rootDir = path.resolve(__dirname, '..', '..');
const bundledServerDir = path.join(rootDir, 'server');
const bundledServerEntry = path.join(bundledServerDir, 'forart-server.mjs');
const serverNodeExe = process.env.FORART_SERVER_NODE || 'node';
const LOCAL_SERVER_PORT = 5175;
const isDev = !app.isPackaged;
let serverProcess = null;
let activeLocalServerConfig = null;
let activeAppConfig = null;

protocol.registerSchemesAsPrivileged([
  { scheme: 'forart-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

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
    imageDownloadPath: String(payload.imageDownloadPath || '').trim(),
  };
}

function normalizeApiProvider(input = {}, providers = []) {
  const name = String(input.name || 'API').trim() || 'API';
  const base = (String(input.id || name || 'custom-api')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'custom-api');
  let id = String(input.id || base).trim() || base;
  let index = 2;
  while (providers.some((provider) => provider.id === id)) {
    id = `${base}-${index}`;
    index += 1;
  }
  return {
    id,
    name,
    baseUrl: String(input.baseUrl || '').trim(),
    apiKey: String(input.apiKey || ''),
    protocol: input.protocol === 'async' || input.protocol === 'gemini' ? input.protocol : 'openai',
    imageModels: Array.isArray(input.imageModels) ? input.imageModels.map(String).filter(Boolean) : [],
    chatModels: Array.isArray(input.chatModels) ? input.chatModels.map(String).filter(Boolean) : [],
    videoModels: Array.isArray(input.videoModels) ? input.videoModels.map(String).filter(Boolean) : [],
  };
}

function normalizeApiSettings(payload = {}) {
  const providers = Array.isArray(payload.providers)
    ? payload.providers.reduce((result, item) => {
      const provider = normalizeApiProvider(item, result);
      return result.some((current) => current.id === provider.id) ? result : [...result, provider];
    }, [])
    : [];
  const defaultImageProviderId = providers.some((provider) => provider.id === payload.defaultImageProviderId)
    ? String(payload.defaultImageProviderId)
    : '';
  return { providers, defaultImageProviderId };
}

function readConfigFile() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeConfigFile(payload) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), `${JSON.stringify(payload || {}, null, 2)}\n`, 'utf8');
}

function uniqueFilePath(directory, fileName) {
  const parsed = path.parse(fileName || 'generated-image.png');
  const safeBase = (parsed.name || 'generated-image').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  const ext = parsed.ext || '.png';
  let candidate = path.join(directory, `${safeBase}${ext}`);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(directory, `${safeBase}-${index}${ext}`);
    index += 1;
  }
  return candidate;
}

function canvasStorageRoot() {
  const root = path.join(rootDir, 'CanvasAssests');
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function legacyCanvasStorageRoot() {
  return activeAppConfig?.mode === 'local' && activeAppConfig.localLibraryPath
    ? path.resolve(activeAppConfig.localLibraryPath, '.forart', 'infinite-canvas')
    : path.join(app.getPath('userData'), 'infinite-canvas');
}

function canvasJsonRoot() {
  const directory = path.join(canvasStorageRoot(), 'json');
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function singleCanvasSnapshotPath() {
  return path.join(canvasJsonRoot(), 'canvas.json');
}

function sanitizeCanvasId(canvasId) {
  return String(canvasId || '').replace(/[^a-zA-Z0-9_-]/g, '');
}

function canvasProjectPath(canvasId) {
  const safeId = sanitizeCanvasId(canvasId);
  if (!safeId) return '';
  return path.join(canvasJsonRoot(), `${safeId}.json`);
}

function nowMs() {
  return Date.now();
}

function newCanvasId() {
  return `canvas_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function canvasRecord(canvas) {
  return {
    id: canvas.id,
    title: String(canvas.title || 'Untitled canvas'),
    icon: String(canvas.icon || 'layers'),
    color: String(canvas.color || ''),
    pinned: Boolean(canvas.pinned),
    createdAt: Number(canvas.createdAt || canvas.created_at || 0),
    updatedAt: Number(canvas.updatedAt || canvas.updated_at || 0),
    nodeCount: Array.isArray(canvas.nodes) ? canvas.nodes.length : 0,
  };
}

function normalizeCanvasProject(input, fallback = {}) {
  const timestamp = nowMs();
  const viewport = input?.viewport && typeof input.viewport === 'object' ? input.viewport : {};
  return {
    id: sanitizeCanvasId(input?.id || fallback.id || newCanvasId()),
    title: String(input?.title || fallback.title || 'Untitled canvas').slice(0, 80),
    icon: String(input?.icon || fallback.icon || 'layers').slice(0, 32),
    color: String(input?.color || fallback.color || ''),
    pinned: Boolean(input?.pinned || fallback.pinned),
    createdAt: Number(input?.createdAt || input?.created_at || fallback.createdAt || timestamp),
    updatedAt: Number(input?.updatedAt || input?.updated_at || fallback.updatedAt || timestamp),
    nodes: Array.isArray(input?.nodes) ? input.nodes : [],
    connections: Array.isArray(input?.connections) ? input.connections : [],
    viewport: {
      x: Number.isFinite(Number(viewport.x)) ? Number(viewport.x) : 0,
      y: Number.isFinite(Number(viewport.y)) ? Number(viewport.y) : 0,
      scale: Number.isFinite(Number(viewport.scale)) ? Number(viewport.scale) : 1,
    },
  };
}

function readCanvasProject(canvasId) {
  const filePath = canvasProjectPath(canvasId);
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return normalizeCanvasProject(JSON.parse(fs.readFileSync(filePath, 'utf8')), { id: canvasId });
  } catch {
    return null;
  }
}

function writeCanvasProject(canvas) {
  const normalized = normalizeCanvasProject(canvas);
  const filePath = canvasProjectPath(normalized.id);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return { canvas: normalized, filePath };
}

function listCanvasProjects() {
  migrateLegacyCanvasStorageIfNeeded();
  const records = [];
  for (const fileName of fs.readdirSync(canvasJsonRoot())) {
    if (!fileName.endsWith('.json') || fileName === 'canvas.json') continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(canvasJsonRoot(), fileName), 'utf8'));
      const canvas = normalizeCanvasProject(parsed, { id: path.basename(fileName, '.json') });
      if (!canvas.id) continue;
      records.push(canvasRecord(canvas));
    } catch {
      // Skip malformed project files so one bad JSON does not hide the rest.
    }
  }
  return records.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
  });
}

function canvasAssetsRoot() {
  const root = canvasStorageRoot();
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function canvasAssetDirectory(kind) {
  const safeKind = kind === 'output' ? 'output' : 'input';
  const directory = path.join(canvasAssetsRoot(), safeKind);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function isInside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function resolveCanvasAssetUrl(source) {
  try {
    const parsed = new URL(String(source || ''));
    if (parsed.protocol !== 'forart-asset:') return '';
    const rawPath = decodeURIComponent(`${parsed.host}${parsed.pathname}`.replace(/^canvas\/?/, ''));
    const assetRoot = canvasAssetsRoot();
    const target = path.resolve(assetRoot, rawPath.replace(/^\/+/, ''));
    if (!isInside(assetRoot, target)) return '';
    return target;
  } catch {
    return '';
  }
}

function canvasAssetUrl(filePath) {
  const assetRoot = canvasAssetsRoot();
  const relative = path.relative(assetRoot, filePath).replace(/\\/g, '/');
  return `forart-asset://canvas/${relative.split('/').map(encodeURIComponent).join('/')}`;
}

function copyDirectoryIfNeeded(source, target) {
  if (!fs.existsSync(source) || fs.existsSync(target)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
}

function migrateLegacyCanvasStorageIfNeeded() {
  const existingProjects = fs.existsSync(canvasJsonRoot())
    ? fs.readdirSync(canvasJsonRoot()).filter((fileName) => fileName.endsWith('.json') && fileName !== 'canvas.json')
    : [];
  if (existingProjects.length) return;
  const currentSnapshot = singleCanvasSnapshotPath();
  const legacyRoot = legacyCanvasStorageRoot();
  const legacySnapshot = path.join(legacyRoot, 'canvas.json');
  if (fs.existsSync(legacySnapshot)) {
    fs.mkdirSync(path.dirname(currentSnapshot), { recursive: true });
    fs.copyFileSync(legacySnapshot, currentSnapshot);
  }
  if (fs.existsSync(currentSnapshot)) {
    try {
      const snapshot = JSON.parse(fs.readFileSync(currentSnapshot, 'utf8'));
      writeCanvasProject(normalizeCanvasProject(snapshot, { title: 'Default canvas' }));
    } catch {
      // Keep the legacy snapshot in place if it cannot be migrated.
    }
  }
  copyDirectoryIfNeeded(path.join(legacyRoot, 'assets', 'input'), path.join(canvasStorageRoot(), 'input'));
  copyDirectoryIfNeeded(path.join(legacyRoot, 'assets', 'output'), path.join(canvasStorageRoot(), 'output'));
}

function extensionFromMime(mimeType) {
  const subtype = String(mimeType || '').split('/')[1] || '';
  if (!subtype) return '';
  return `.${subtype.replace('jpeg', 'jpg').replace(/[^a-z0-9.+-]/gi, '')}`;
}

async function readImageSource(payload) {
  const source = String(payload.dataUrl || payload.url || '');
  const dataMatch = source.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s);
  if (dataMatch) {
    return {
      buffer: Buffer.from(dataMatch[2], 'base64'),
      extension: extensionFromMime(dataMatch[1]) || '.png',
    };
  }

  const localAsset = resolveCanvasAssetUrl(source);
  if (localAsset && fs.existsSync(localAsset)) {
    return {
      buffer: fs.readFileSync(localAsset),
      extension: path.extname(localAsset) || '.png',
    };
  }

  const response = await fetch(source);
  if (!response.ok) throw new Error(`Failed to download image: ${response.status}`);
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    extension: extensionFromMime(response.headers.get('content-type')) || path.extname(new URL(source).pathname) || '.png',
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

function registerCanvasAssetProtocol() {
  protocol.handle('forart-asset', (request) => {
  const target = resolveCanvasAssetUrl(request.url);
  if (!target || !fs.existsSync(target)) {
    return new Response('Asset not found', { status: 404 });
  }
  return net.fetch(pathToFileURL(target).toString());
  });
}

ipcMain.handle('save-result', async (_event, payload) => {
  const source = await readImageSource(payload);
  const directory = path.resolve(String(payload.directory || '').trim() || app.getPath('downloads'));
  fs.mkdirSync(directory, { recursive: true });
  const filePath = uniqueFilePath(directory, payload.defaultName || `generated-image${source.extension || '.png'}`);
  fs.writeFileSync(filePath, source.buffer);
  return { canceled: false, filePath };
});

ipcMain.handle('canvas:load', async () => {
  try {
    migrateLegacyCanvasStorageIfNeeded();
    const projects = listCanvasProjects();
    if (!projects.length) return null;
    return readCanvasProject(projects[0].id);
  } catch {
    return null;
  }
});

ipcMain.handle('canvas:save', async (_event, payload) => {
  migrateLegacyCanvasStorageIfNeeded();
  const projects = listCanvasProjects();
  const canvasId = projects[0]?.id || newCanvasId();
  const existing = readCanvasProject(canvasId) || {};
  const result = writeCanvasProject({
    ...existing,
    ...(payload || {}),
    id: canvasId,
    updatedAt: nowMs(),
  });
  return { ok: true, filePath: result.filePath, canvas: result.canvas };
});

ipcMain.handle('canvas:list', async () => {
  migrateLegacyCanvasStorageIfNeeded();
  return { canvases: listCanvasProjects() };
});

ipcMain.handle('canvas:create', async (_event, payload) => {
  migrateLegacyCanvasStorageIfNeeded();
  const timestamp = nowMs();
  const result = writeCanvasProject({
    id: newCanvasId(),
    title: String(payload?.title || 'Untitled canvas').trim() || 'Untitled canvas',
    icon: payload?.icon || 'layers',
    color: '',
    pinned: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    nodes: Array.isArray(payload?.nodes) ? payload.nodes : [],
    connections: Array.isArray(payload?.connections) ? payload.connections : [],
    viewport: payload?.viewport || { x: 0, y: 0, scale: 1 },
  });
  return { ok: true, canvas: result.canvas, record: canvasRecord(result.canvas), filePath: result.filePath };
});

ipcMain.handle('canvas:load-project', async (_event, canvasId) => {
  migrateLegacyCanvasStorageIfNeeded();
  return readCanvasProject(canvasId);
});

ipcMain.handle('canvas:save-project', async (_event, canvasId, payload) => {
  migrateLegacyCanvasStorageIfNeeded();
  const existing = readCanvasProject(canvasId);
  if (!existing) throw new Error('Canvas project not found.');
  const result = writeCanvasProject({
    ...existing,
    ...(payload || {}),
    id: existing.id,
    createdAt: existing.createdAt,
    title: String(payload?.title || existing.title || 'Untitled canvas').slice(0, 80),
    icon: String(payload?.icon || existing.icon || 'layers').slice(0, 32),
    updatedAt: nowMs(),
  });
  return { ok: true, canvas: result.canvas, record: canvasRecord(result.canvas), filePath: result.filePath };
});

ipcMain.handle('canvas:update-meta', async (_event, canvasId, patch) => {
  migrateLegacyCanvasStorageIfNeeded();
  const existing = readCanvasProject(canvasId);
  if (!existing) throw new Error('Canvas project not found.');
  const result = writeCanvasProject({
    ...existing,
    title: patch?.title !== undefined ? String(patch.title || existing.title || 'Untitled canvas').slice(0, 80) : existing.title,
    icon: patch?.icon !== undefined ? String(patch.icon || 'layers').slice(0, 32) : existing.icon,
    color: patch?.color !== undefined ? String(patch.color || '') : existing.color,
    pinned: patch?.pinned !== undefined ? Boolean(patch.pinned) : existing.pinned,
    updatedAt: nowMs(),
  });
  return { ok: true, canvas: result.canvas, record: canvasRecord(result.canvas), filePath: result.filePath };
});

ipcMain.handle('canvas:delete-project', async (_event, canvasId) => {
  migrateLegacyCanvasStorageIfNeeded();
  const filePath = canvasProjectPath(canvasId);
  if (!filePath || !fs.existsSync(filePath)) return { ok: true };
  fs.unlinkSync(filePath);
  return { ok: true, filePath };
});

ipcMain.handle('canvas:save-asset', async (_event, payload) => {
  migrateLegacyCanvasStorageIfNeeded();
  const source = await readImageSource(payload);
  const directory = canvasAssetDirectory(payload.kind);
  const defaultName = payload.defaultName || `canvas-image${source.extension || '.png'}`;
  const filePath = uniqueFilePath(directory, defaultName);
  fs.writeFileSync(filePath, source.buffer);
  return {
    url: canvasAssetUrl(filePath),
    fileName: path.basename(filePath),
    filePath,
  };
});

ipcMain.handle('config:load', async () => {
  try {
    const config = normalizeConfig(readConfigFile());
    activeAppConfig = config;
    if (config.mode === 'local') await ensureLocalServer(config);
    return config;
  } catch {
    return null;
  }
});

ipcMain.handle('config:save', async (_event, payload) => {
  const config = normalizeConfig(payload);
  activeAppConfig = config;
  const current = readConfigFile();
  writeConfigFile({ ...current, ...config });
  if (config.mode === 'local') {
    await ensureLocalServer(config);
  } else {
    stopLocalServer();
  }
  return { ok: true, config };
});

ipcMain.handle('config:load-api-settings', async () => {
  const current = readConfigFile();
  return normalizeApiSettings(current.apiSettings || {});
});

ipcMain.handle('config:save-api-settings', async (_event, payload) => {
  const current = readConfigFile();
  const apiSettings = normalizeApiSettings(payload);
  writeConfigFile({ ...current, apiSettings });
  return { ok: true, apiSettings };
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
  registerCanvasAssetProtocol();
  createWindow();
});

app.on('window-all-closed', () => {
  stopLocalServer();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopLocalServer();
});
