const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createConfigStore } = require('../electron/main/modules/config-store.cjs');
const { registerConfigIpc } = require('../electron/main/ipc/config-ipc.cjs');

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
    },
  }), 'utf8');

  const store = createConfigStore({ app: { isPackaged: false }, rootDir: tempRoot });
  store.saveImageReviewSettings({ modelFolders: '模特图', detailFolders: '详情图' });
  let persisted = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.deepEqual(persisted.legacyField, { keep: true });
  assert.equal(persisted.apiSettings.providers.find((provider) => provider.id === 'custom').apiKey, 'secret');
  assert.deepEqual(persisted.imageReview, { modelFolders: '模特图', detailFolders: '详情图' });

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
      save: (value) => value,
      saveApiSettings: (value) => value,
      saveImageReviewSettings: (value) => value,
    },
    app: { getPath: () => tempRoot },
    net: { fetch: async () => ({ ok: true, json: async () => ({ ok: true }) }) },
  });
  const status = handlers.get('server:local-status');
  const missing = await status();
  assert.equal(missing.ok, false);
  fs.mkdirSync(libraryPath, { recursive: true });
  const available = await status();
  assert.equal(available.ok, true);
  assert.equal(available.transport, 'ipc');
});
