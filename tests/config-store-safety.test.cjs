const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createConfigStore } = require('../electron/main/modules/config-store.cjs');
const { registerConfigIpc } = require('../electron/main/ipc/config-ipc.cjs');
const { createLibtvWorkspaceName, normalizeLibtvMachineId } = require('../electron/main/modules/libtv-workspace.cjs');

test('LibTV machine ids stay alphanumeric and select an isolated workspace', () => {
  assert.equal(normalizeLibtvMachineId(' PC-01_中文A '), 'PC01A');
  assert.equal(createLibtvWorkspaceName(''), 'LibtvImage');
  assert.equal(createLibtvWorkspaceName('PC01'), 'LibtvImage-PC01');
});

test('infinite canvas settings use stable defaults for old config files', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-infinite-canvas-settings-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const store = createConfigStore({ app: { isPackaged: false }, rootDir: tempRoot });
  assert.deepEqual(store.loadInfiniteCanvasSettings(), {
    connectionsVisible: true,
    minimapOpen: false,
    snapToGrid: false,
    actionFissionViewer: { referenceComparisonEnabled: false, referencePanelPercent: 50 },
  });
});

test('config sections preserve sibling data and use atomic replacement', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-config-store-'));
  const configPath = path.join(tempRoot, 'forart-config.json');
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  fs.writeFileSync(configPath, JSON.stringify({
    mode: 'local',
    localLibraryPath: 'D:/Library',
    language: 'zh-CN',
    legacyField: { keep: true },
    imageReview: { modelFolders: '旧模特图', detailFolders: '旧详情图' },
    apiSettings: {
      providers: [{ id: 'custom', name: 'Custom', baseUrl: 'https://example.com/v1', apiKey: 'secret', imageModels: ['image-1'] }],
      defaultImageProviderId: 'custom',
      providerOrder: ['custom'],
      libtvMachineId: 'PC01',
    },
    infiniteCanvas: {
      connectionsVisible: false,
      minimapOpen: true,
      snapToGrid: true,
      actionFissionViewer: { referenceComparisonEnabled: true, referencePanelPercent: 64 },
    },
  }), 'utf8');

  const store = createConfigStore({ app: { isPackaged: false }, rootDir: tempRoot });
  const savedApiSettings = store.saveApiSettings({
    ...store.loadApiSettings(),
    libtvMachineId: ' PC-02_中文 ',
  });
  assert.equal(savedApiSettings.libtvMachineId, 'PC02');
  store.saveImageReviewSettings({ modelFolders: '模特图', detailFolders: '详情图' });
  let persisted = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.deepEqual(persisted.legacyField, { keep: true });
  assert.equal(persisted.apiSettings.providers.find((provider) => provider.id === 'custom').apiKey, 'secret');
  assert.equal(store.loadApiSettings().libtvMachineId, 'PC02');
  assert.deepEqual(persisted.imageReview, { modelFolders: '模特图', detailFolders: '详情图' });

  const savedInfiniteCanvas = store.saveInfiniteCanvasSettings({
    connectionsVisible: true,
    minimapOpen: false,
    snapToGrid: true,
    actionFissionViewer: { referenceComparisonEnabled: true, referencePanelPercent: 92.4 },
  });
  assert.equal(savedInfiniteCanvas.actionFissionViewer.referencePanelPercent, 80);
  assert.deepEqual(store.loadInfiniteCanvasSettings(), savedInfiniteCanvas);

  store.save({
    mode: 'remote',
    localLibraryPath: 'D:/Library',
    serverUrl: 'http://127.0.0.1:6980/',
    imageDownloadPath: 'D:/Downloads',
    language: 'en-US',
  });
  persisted = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(persisted.serverUrl, 'http://127.0.0.1:6980');
  assert.equal(persisted.apiSettings.providers.find((provider) => provider.id === 'custom').apiKey, 'secret');
  assert.equal(persisted.apiSettings.libtvMachineId, 'PC02');
  assert.deepEqual(persisted.infiniteCanvas, savedInfiniteCanvas);
  assert.deepEqual(persisted.legacyField, { keep: true });
  assert.deepEqual(fs.readdirSync(tempRoot).filter((name) => name.endsWith('.tmp')), []);
});

test('local status checks that the configured IPC library path is accessible', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-local-status-'));
  const libraryPath = path.join(tempRoot, 'library');
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const handlers = new Map();
  registerConfigIpc({
    ipcMain: { handle(channel, handler) { handlers.set(channel, handler); } },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    configStore: {
      load: () => ({ mode: 'local', localLibraryPath: libraryPath }),
      loadApiSettings: () => ({}),
      loadImageReviewSettings: () => ({}),
      loadInfiniteCanvasSettings: () => ({}),
      save: (value) => value,
      saveApiSettings: (value) => value,
      saveImageReviewSettings: (value) => value,
      saveInfiniteCanvasSettings: (value) => value,
    },
    app: { getPath: () => tempRoot },
    net: { fetch: async () => ({ ok: true, json: async () => ({ ok: true }) }) },
  });
  const status = handlers.get('server:local-status');
  assert.equal(typeof handlers.get('config:load-infinite-canvas-settings'), 'function');
  assert.equal(typeof handlers.get('config:save-infinite-canvas-settings'), 'function');
  const missing = await status();
  assert.equal(missing.ok, false);
  fs.mkdirSync(libraryPath, { recursive: true });
  const available = await status();
  assert.equal(available.ok, true);
  assert.equal(available.transport, 'ipc');
});
