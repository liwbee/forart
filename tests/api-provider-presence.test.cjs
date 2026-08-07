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

test('recommended API providers remain absent until explicitly added', () => {
  const providers = loadApiProviders();
  const empty = providers.normalizeApiSettings({});

  assert.deepEqual(empty.providers, []);
  assert.deepEqual(empty.providerOrder, []);
  assert.deepEqual(providers.orderedApiProviderItems([], []), []);

  const apimart = providers.createApimartProvider();
  const apimartOnly = providers.normalizeApiSettings({ providers: [apimart] });
  assert.deepEqual(apimartOnly.providers.map((provider) => provider.id), ['apimart']);
  assert.deepEqual(apimartOnly.providerOrder, ['apimart']);
  assert.deepEqual(
    providers.orderedApiProviderItems(apimartOnly.providers, apimartOnly.providerOrder).map((item) => item.id),
    ['apimart'],
  );

  const tudou = providers.createTudouProvider({ baseUrl: 'https://example.invalid/v1', protocol: 'openai', apiKey: 'secret' });
  assert.equal(tudou.id, 'tudou-api');
  assert.equal(tudou.name, '土豆API');
  assert.equal(tudou.baseUrl, 'https://api.ai-tudou.net/v1');
  assert.equal(tudou.protocol, 'gemini');
  assert.deepEqual(tudou.imageModels, []);
  assert.deepEqual(tudou.modelCatalogOrder.image, [...providers.TUDOU_IMAGE_MODELS]);
  const reorderedTudou = providers.createTudouProvider({
    imageModels: ['grok-imagine-image'],
    modelCatalogOrder: { image: ['grok-imagine-image', 'gpt-image-2-1k'] },
  });
  assert.deepEqual(reorderedTudou.imageModels, ['grok-imagine-image']);
  assert.deepEqual(reorderedTudou.modelCatalogOrder.image.slice(0, 2), ['grok-imagine-image', 'gpt-image-2-1k']);
  const tudouOnly = providers.normalizeApiSettings({ providers: [tudou] });
  assert.deepEqual(tudouOnly.providerOrder, ['tudou-api']);
  assert.deepEqual(
    providers.orderedApiProviderItems(tudouOnly.providers, tudouOnly.providerOrder).map((item) => item.type),
    ['tudou'],
  );

  const withLibtv = providers.normalizeApiSettings({
    providers: apimartOnly.providers,
    providerOrder: ['apimart', 'libtv'],
  });
  assert.deepEqual(withLibtv.providerOrder, ['apimart', 'libtv']);
  assert.deepEqual(
    providers.orderedApiProviderItems(withLibtv.providers, withLibtv.providerOrder).map((item) => item.id),
    ['apimart', 'libtv'],
  );
});
