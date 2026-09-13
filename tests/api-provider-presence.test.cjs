const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadApiProviders() {
  const filePath = path.join(
    __dirname,
    '..',
    'renderer',
    'src',
    'features',
    'settings',
    'apiProviders.ts',
  );
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;
  const loaded = { exports: {} };
  const execute = new Function('require', 'module', 'exports', '__filename', '__dirname', output);
  execute(require, loaded, loaded.exports, filePath, path.dirname(filePath));
  return loaded.exports;
}

test('fixed provider templates expose documented defaults without schema logic', () => {
  const providers = loadApiProviders();

  const apimart = providers.createApimartProvider();
  assert.equal(apimart.id, 'apimart');
  assert.equal(apimart.name, 'APImart');
  assert.equal(apimart.baseUrl, providers.APIMART_BASE_URLS[0]);
  assert.equal(apimart.protocol, 'apimart');
  assert.deepEqual(apimart.imageModels, []);
  assert.equal(apimart.hasApiKey, false);

  const tudou = providers.createTudouProvider();
  assert.equal(tudou.id, 'tudou-api');
  assert.equal(tudou.name, '土豆API');
  assert.equal(tudou.baseUrl, providers.TUDOU_BASE_URL);
  assert.equal(tudou.protocol, 'gemini');
  assert.deepEqual(tudou.imageModels, []);
  assert.deepEqual(tudou.modelCatalogOrder.image, [...providers.TUDOU_IMAGE_MODELS]);
  assert.equal(tudou.hasApiKey, false);

  // 归一化规则已收敛到主进程，renderer 模块不再导出这些实现。
  assert.equal(providers.normalizeApiSettings, undefined);
  assert.equal(providers.normalizeApiProvider, undefined);
});

test('provider ordering helpers drive the settings sidebar and generation pickers', () => {
  const providers = loadApiProviders();
  const apimart = providers.createApimartProvider();
  const tudou = providers.createTudouProvider();
  const custom = providers.createApiProvider([apimart, tudou]);
  const all = [apimart, tudou, custom];

  assert.deepEqual(
    providers.orderedApiProviderItems(all, ['custom-api', 'libtv', 'tudou-api', 'apimart']).map((item) => item.type),
    ['provider', 'libtv', 'tudou', 'apimart'],
  );
  assert.deepEqual(
    providers.orderedApiProviders(all, [custom.id, tudou.id]).map((provider) => provider.id),
    ['custom-api', 'tudou-api', 'apimart'],
  );
  assert.deepEqual(
    providers.normalizeApiProviderOrder(['custom-api', 'libtv', 'ghost', 'libtv'], all),
    ['custom-api', 'libtv', 'apimart', 'tudou-api'],
  );

  assert.equal(providers.isImageProviderConfigured({ ...custom, baseUrl: '', imageModels: ['m'] }), false);
  assert.equal(providers.isImageProviderConfigured({
    ...custom, baseUrl: 'https://example.com/v1', apiKey: 'k', imageModels: ['m'],
  }), true);
});

test('coerceApiProviderDraft only cleans user input and defers schema rules to main', () => {
  const providers = loadApiProviders();
  const base = providers.createApiProvider([]);

  const coerced = providers.coerceApiProviderDraft({
    ...base,
    name: '  My Relay  ',
    baseUrl: ' https://example.com/v1 ',
    protocol: 'weird',
    imageModels: [' model-a ', 'model-a', 'model-b'],
    hasApiKey: true,
  });
  assert.equal(coerced.name, 'My Relay');
  assert.equal(coerced.baseUrl, 'https://example.com/v1');
  assert.equal(coerced.protocol, 'openai');
  assert.deepEqual(coerced.imageModels, ['model-a', 'model-b']);
  assert.equal(coerced.hasApiKey, true);
  assert.equal(coerced.id, base.id);
});
