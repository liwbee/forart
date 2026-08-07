const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadLocationStorage() {
  const filePath = path.join(
    __dirname,
    '..',
    'renderer',
    'src',
    'features',
    'image-review',
    'imageReviewLocationStorage.ts',
  );
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filePath,
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', output)(require, loaded, loaded.exports);
  return loaded.exports;
}

const {
  IMAGE_REVIEW_LOCATION_STORAGE_KEY,
  readImageReviewLocation,
  saveImageReviewLocation,
} = loadLocationStorage();

function memoryStorage(initialValue = null) {
  let value = initialValue;
  return {
    getItem(key) {
      return key === IMAGE_REVIEW_LOCATION_STORAGE_KEY ? value : null;
    },
    setItem(key, nextValue) {
      if (key === IMAGE_REVIEW_LOCATION_STORAGE_KEY) value = nextValue;
    },
  };
}

test('persists and restores the last image review root and product', () => {
  const storage = memoryStorage();
  saveImageReviewLocation({ rootPath: 'G:\\reviews', productId: 'SKU-002' }, storage);
  assert.deepEqual(readImageReviewLocation(storage), {
    rootPath: 'G:\\reviews',
    productId: 'SKU-002',
  });
});

test('ignores malformed image review location data', () => {
  assert.deepEqual(readImageReviewLocation(memoryStorage('{broken')), {
    rootPath: '',
    productId: '',
  });
});
