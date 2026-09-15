const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createConfigStore, TUDOU_IMAGE_MODELS } = require('../electron/main/modules/config-store.cjs');
const { registerConfigIpc } = require('../electron/main/ipc/config-ipc.cjs');
const { createLibtvWorkspaceName, normalizeLibtvMachineId } = require('../electron/main/modules/libtv-workspace.cjs');

function testSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(String(value), 'utf8'),
    decryptString: (value) => Buffer.from(value).toString('utf8'),
  };
}

test('LibTV machine ids stay alphanumeric and select an isolated workspace', () => {
  assert.equal(normalizeLibtvMachineId(' PC-01_中文A '), 'PC01A');
  assert.equal(createLibtvWorkspaceName(''), 'LibtvImage');
  assert.equal(createLibtvWorkspaceName('PC01'), 'LibtvImage-PC01');
});

test('infinite canvas settings use stable defaults for old config files', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-infinite-canvas-settings-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const store = createConfigStore({ app: { isPackaged: false }, rootDir: tempRoot, safeStorage: testSafeStorage() });
  assert.deepEqual(store.loadInfiniteCanvasSettings(), {
    connectionsVisible: true,
    minimapOpen: false,
    snapToGrid: false,
    promptEditorsExpanded: false,
    referenceComparisonViewer: { referenceComparisonEnabled: false, referencePanelPercent: 50 },
  });
});

test('task history retention defaults to 15 days and only accepts supported options', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-task-retention-settings-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const store = createConfigStore({ app: { isPackaged: false }, rootDir: tempRoot, safeStorage: testSafeStorage() });
  const baseConfig = { mode: 'local', localLibraryPath: 'D:/Library' };

  assert.equal(store.save(baseConfig).taskHistoryRetentionDays, 15);
  for (const days of [1, 3, 7, 15, 30]) {
    assert.equal(store.save({ ...baseConfig, taskHistoryRetentionDays: days }).taskHistoryRetentionDays, days);
  }
  assert.equal(store.save({ ...baseConfig, taskHistoryRetentionDays: 14 }).taskHistoryRetentionDays, 15);
});

test('Agent settings preserve OpenAI reasoning effort values and default thinking off', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-agent-settings-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const store = createConfigStore({ app: { isPackaged: false }, rootDir: tempRoot, safeStorage: testSafeStorage() });

  assert.deepEqual(store.loadAgentSettings(), {
    backgroundRemovalEnabled: false,
    promptOptimizationEnabled: false,
    thinkingMode: false,
    reasoningLevel: 'medium',
    imageGeneratorPromptOptimization: null,
  });

  for (const reasoningLevel of ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']) {
    const saved = store.saveAgentSettings({
      backgroundRemovalEnabled: true,
      promptOptimizationEnabled: true,
      thinkingMode: true,
      reasoningLevel,
      imageGeneratorPromptOptimization: { providerId: 'provider-1', model: 'model-1' },
    });
    assert.equal(saved.reasoningLevel, reasoningLevel);
    assert.equal(saved.backgroundRemovalEnabled, true);
    assert.equal(saved.promptOptimizationEnabled, true);
  }

  const normalized = store.saveAgentSettings({ thinkingMode: false, reasoningLevel: 'none' });
  assert.equal(normalized.thinkingMode, false);
  assert.equal(normalized.reasoningLevel, 'medium');
});

test('fresh API settings do not install recommended providers', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-api-provider-defaults-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const store = createConfigStore({ app: { isPackaged: false }, rootDir: tempRoot, safeStorage: testSafeStorage() });

  const fresh = store.loadApiSettings();
  assert.deepEqual(fresh.providers, []);
  assert.deepEqual(fresh.providerOrder, []);

  const customOnly = store.saveApiSettings({
    providers: [{ id: 'custom', name: 'Custom', baseUrl: '', apiKey: '' }],
    providerOrder: ['custom'],
  });
  assert.deepEqual(customOnly.providers.map((provider) => provider.id), ['custom']);
  assert.deepEqual(customOnly.providerOrder, ['custom']);

  const tudou = store.saveApiSettings({
    providers: [{
      id: 'tudou-api',
      name: 'Custom name',
      baseUrl: 'https://example.invalid/v1',
      protocol: 'openai',
      apiKey: 'secret',
      imageModels: ['model-b'],
      modelCatalogOrder: { image: ['model-b', 'model-a'] },
    }],
    providerOrder: ['tudou-api'],
  });
  assert.deepEqual(tudou.providers.map((provider) => ({ id: provider.id, name: provider.name, baseUrl: provider.baseUrl, protocol: provider.protocol })), [{
    id: 'tudou-api',
    name: '土豆API',
    baseUrl: 'https://api.ai-tudou.net/v1',
    protocol: 'gemini',
  }]);
  assert.deepEqual(tudou.providers[0].imageModels, ['model-b']);
  assert.deepEqual(tudou.providers[0].modelCatalogOrder, {
    image: ['model-b', 'model-a', ...TUDOU_IMAGE_MODELS],
  });
});

test('tudou catalog order keeps user ranking first and appends all official models', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-api-tudou-catalog-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const store = createConfigStore({ app: { isPackaged: false }, rootDir: tempRoot, safeStorage: testSafeStorage() });

  const saved = store.saveApiSettings({
    providers: [{
      id: 'tudou-api',
      apiKey: 'secret',
      imageModels: ['grok-imagine-image', 'gpt-image-2-1k'],
      modelCatalogOrder: { image: ['grok-imagine-image', 'custom-image-model', 'gpt-image-2-1k'] },
    }],
  });
  const tudou = saved.providers[0];
  assert.deepEqual(tudou.imageModels, ['grok-imagine-image', 'gpt-image-2-1k']);
  assert.deepEqual(
    tudou.modelCatalogOrder.image.slice(0, 3),
    ['grok-imagine-image', 'custom-image-model', 'gpt-image-2-1k'],
  );
  for (const model of TUDOU_IMAGE_MODELS) {
    assert.ok(tudou.modelCatalogOrder.image.includes(model), `catalog should include ${model}`);
  }
  const reloaded = store.loadApiSettings();
  assert.deepEqual(reloaded.providers[0].modelCatalogOrder, tudou.modelCatalogOrder);
});

test('api settings normalization keeps same-host custom providers separate and generates unique ids', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-api-normalize-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const store = createConfigStore({ app: { isPackaged: false }, rootDir: tempRoot, safeStorage: testSafeStorage() });

  const saved = store.saveApiSettings({
    providers: [
      { id: 'apimart', name: 'APImart', baseUrl: 'https://api.apib.ai/v1', apiKey: 'key-1', imageModels: ['model-a'] },
      { name: 'APImart Alt', baseUrl: 'https://api.apimart.ai/v1', apiKey: 'key-2', imageModels: ['model-b'] },
      { name: 'My Relay', imageModels: [' model-a ', 'model-a', 'model-c'] },
      { name: 'My Relay' },
    ],
    defaultImageProviderId: 'apimart',
    providerOrder: ['apimart'],
    libtvActionFissionConcurrency: 42,
  });
  assert.deepEqual(saved.providers.map((provider) => provider.id), ['apimart', 'apimart-alt', 'my-relay', 'my-relay-2']);
  const apimart = saved.providers[0];
  assert.equal(apimart.baseUrl, 'https://api.apib.ai/v1');
  assert.deepEqual(apimart.imageModels, ['model-a']);
  assert.equal(store.getApiProvider('apimart').apiKey, 'key-1');
  assert.equal(saved.providers[1].baseUrl, 'https://api.apimart.ai/v1');
  assert.deepEqual(saved.providers[1].imageModels, ['model-b']);
  assert.deepEqual(saved.providers[2].imageModels, ['model-a', 'model-c']);
  assert.equal(saved.defaultImageProviderId, 'apimart');
  assert.equal(saved.libtvActionFissionConcurrency, 1);
  assert.deepEqual(saved.providerOrder, ['apimart', 'apimart-alt', 'my-relay', 'my-relay-2']);

  const clamped = store.saveApiSettings({ ...saved, libtvActionFissionConcurrency: 3 });
  assert.equal(clamped.libtvActionFissionConcurrency, 3);
});

test('custom providers using recommended hosts are not converted into fixed providers', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-api-duplicate-host-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const store = createConfigStore({ app: { isPackaged: false }, rootDir: tempRoot, safeStorage: testSafeStorage() });
  const saved = store.saveApiSettings({
    providers: [
      { id: 'tudou-api', name: '土豆API', baseUrl: 'https://api.ai-tudou.net/v1', apiKey: 'fixed-key', imageModels: ['fixed-model'] },
      { id: 'relay', name: 'Tudou relay', baseUrl: 'https://api.ai-tudou.net/v1', apiKey: 'relay-key', imageModels: ['relay-model'] },
    ],
    providerOrder: ['tudou-api', 'relay'],
  });
  assert.deepEqual(saved.providers.map((provider) => provider.id), ['tudou-api', 'relay']);
  assert.deepEqual(saved.providers.map((provider) => provider.imageModels), [['fixed-model'], ['relay-model']]);
  assert.equal(saved.providers[1].baseUrl, 'https://api.ai-tudou.net/v1');
});

test('legacy compatible protocol values migrate to the explicit APIMart protocol', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-api-protocol-migration-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const store = createConfigStore({ app: { isPackaged: false }, rootDir: tempRoot, safeStorage: testSafeStorage() });

  const saved = store.saveApiSettings({
    providers: [{ id: 'legacy-relay', name: 'Legacy relay', baseUrl: 'https://example.com/v1', protocol: 'compatible' }],
    providerOrder: ['legacy-relay'],
  });

  assert.equal(saved.providers[0].protocol, 'apimart');
});

test('public API settings retain configured-key state for Agent and APIMart balance', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-api-public-state-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const store = createConfigStore({ app: { isPackaged: false }, rootDir: tempRoot, safeStorage: testSafeStorage() });
  store.saveApiSettings({
    providers: [{
      id: 'apimart',
      name: 'APImart',
      baseUrl: 'https://api.apimart.ai/v1',
      apiKey: 'persisted-secret',
      chatModels: ['gemini-3.5-flash-lite'],
    }],
    providerOrder: ['apimart'],
  });
  const publicSettings = store.loadPublicApiSettings();
  assert.equal(publicSettings.providers[0].hasApiKey, true);
  assert.equal(publicSettings.providers[0].apiKey, '');
  assert.deepEqual(publicSettings.providers[0].chatModels, ['gemini-3.5-flash-lite']);
  assert.equal(store.getApiProvider('apimart').apiKey, 'persisted-secret');
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

  const store = createConfigStore({ app: { isPackaged: false }, rootDir: tempRoot, safeStorage: testSafeStorage() });
  assert.equal(store.load()?.photoshopExecutablePath, '');
  assert.deepEqual(store.loadInfiniteCanvasSettings().referenceComparisonViewer, {
    referenceComparisonEnabled: true,
    referencePanelPercent: 64,
  });
  const savedApiSettings = store.saveApiSettings({
    ...store.loadApiSettings(),
    libtvMachineId: ' PC-02_中文 ',
  });
  assert.equal(savedApiSettings.libtvMachineId, 'PC02');
  store.saveImageReviewSettings({ modelFolders: '模特图', detailFolders: '详情图' });
  let persisted = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.deepEqual(persisted.legacyField, { keep: true });
  assert.equal(persisted.apiSettings.providers.find((provider) => provider.id === 'custom').apiKey, '');
  assert.ok(persisted.apiSecrets.custom);
  assert.equal(store.getApiProvider('custom').apiKey, 'secret');
  assert.equal(store.loadApiSettings().libtvMachineId, 'PC02');
  assert.deepEqual(persisted.imageReview, { modelFolders: '模特图', detailFolders: '详情图' });

  const savedInfiniteCanvas = store.saveInfiniteCanvasSettings({
    connectionsVisible: true,
    minimapOpen: false,
    snapToGrid: true,
    promptEditorsExpanded: true,
    referenceComparisonViewer: { referenceComparisonEnabled: true, referencePanelPercent: 92.4 },
  });
  assert.equal(savedInfiniteCanvas.referenceComparisonViewer.referencePanelPercent, 80);
  assert.equal(savedInfiniteCanvas.promptEditorsExpanded, true);
  assert.deepEqual(store.loadInfiniteCanvasSettings(), savedInfiniteCanvas);

  store.save({
    mode: 'remote',
    localLibraryPath: 'D:/Library',
    serverUrl: 'http://127.0.0.1:6980/',
    fileDownloadPath: 'D:/Downloads',
    photoshopExecutablePath: 'C:/Adobe/Photoshop.exe',
    language: 'en-US',
  });
  persisted = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(persisted.serverUrl, 'http://127.0.0.1:6980');
  assert.equal(persisted.fileDownloadPath, 'D:/Downloads');
  assert.equal('imageDownloadPath' in persisted, false);
  assert.equal(persisted.photoshopExecutablePath, 'C:/Adobe/Photoshop.exe');
  assert.equal(persisted.apiSettings.providers.find((provider) => provider.id === 'custom').apiKey, '');
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
  assert.equal(typeof handlers.get('dialog:choose-file'), 'function');
  assert.deepEqual(await handlers.get('dialog:choose-file')({}, { extensions: ['exe'] }), {
    canceled: true,
    path: '',
  });
  const missing = await status();
  assert.equal(missing.ok, false);
  fs.mkdirSync(libraryPath, { recursive: true });
  const available = await status();
  assert.equal(available.ok, true);
  assert.equal(available.transport, 'ipc');
});

test('config save notifies task cleanup about retention changes', async () => {
  const handlers = new Map();
  const previousConfig = { mode: 'local', localLibraryPath: 'D:/Library', taskHistoryRetentionDays: 15 };
  const savedConfig = { ...previousConfig, taskHistoryRetentionDays: 3 };
  const notifications = [];
  registerConfigIpc({
    ipcMain: { handle(channel, handler) { handlers.set(channel, handler); } },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    configStore: {
      load: () => previousConfig,
      save: () => savedConfig,
    },
    app: { getPath: () => '' },
    net: { fetch: async () => ({ ok: true, json: async () => ({ ok: true }) }) },
    onConfigSaved: (next, previous) => notifications.push({ next, previous }),
  });

  const result = await handlers.get('config:save')({}, savedConfig);

  assert.equal(result.config.taskHistoryRetentionDays, 3);
  assert.deepEqual(notifications, [{ next: savedConfig, previous: previousConfig }]);
});

test('remote authentication uses bearer tokens without Electron cookies', async () => {
  const handlers = new Map();
  const requests = [];
  let savedConfig = { mode: 'local' };
  registerConfigIpc({
    ipcMain: { handle(channel, handler) { handlers.set(channel, handler); } },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    configStore: {
      load: () => savedConfig,
      loadApiSettings: () => ({}),
      loadImageReviewSettings: () => ({}),
      loadInfiniteCanvasSettings: () => ({}),
      save: (value) => { savedConfig = value; return value; },
      saveApiSettings: (value) => value,
      saveImageReviewSettings: (value) => value,
      saveInfiniteCanvasSettings: (value) => value,
    },
    app: { getPath: () => '' },
    net: {
      fetch: async (url, options) => {
        requests.push({ url, options });
        return {
          ok: true,
          headers: new Headers({ 'set-auth-token': 'token-1' }),
          json: async () => ({ user: { id: 'admin-1' } }),
        };
      },
    },
  });

  await handlers.get('server:login')({}, {
    serverUrl: 'https://forart.example.com/', username: 'admin', password: 'password123',
  });
  await handlers.get('server:login')({}, {
    serverUrl: 'https://forart.example.com/', username: 'admin', password: 'password123',
  });

  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.options.credentials, 'omit');
    assert.equal(request.options.headers.origin, 'https://forart.example.com');
    assert.equal(request.options.headers.cookie, undefined);
  }
});
