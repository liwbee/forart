const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadAssetNaming() {
  const filePath = path.join(
    __dirname,
    '..',
    'renderer',
    'src',
    'features',
    'infinite-canvas',
    'assetNaming.ts',
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

test('derived assets are named with their operation prefix', () => {
  const naming = loadAssetNaming();

  assert.deepEqual(naming.DERIVED_ASSET_PREFIXES, { crop: 'Crop', matting: 'Matting', frame: 'Frame', adjust: 'Adjust' });
  assert.equal(naming.derivedAssetName('crop', '模特图.jpg'), 'Crop-模特图.png');
  assert.equal(naming.derivedAssetName('matting', '模特图.png'), 'Matting-模特图.png');
  assert.equal(naming.derivedAssetName('frame', '视频.mp4'), 'Frame-视频.png');
  assert.equal(naming.derivedAssetName('adjust', '模特图.png'), 'Adjust-模特图.png');
});

test('derived names never stack prefixes and fall back to a readable base', () => {
  const naming = loadAssetNaming();

  assert.equal(naming.derivedAssetName('crop', 'Crop-模特图.png'), 'Crop-模特图.png');
  assert.equal(naming.derivedAssetName('matting', 'Crop-模特图.png'), 'Matting-模特图.png');
  assert.equal(naming.derivedAssetName('adjust', 'Crop-模特图.png'), 'Adjust-模特图.png');
  assert.equal(naming.derivedAssetName('crop', ''), 'Crop-image.png');
  assert.equal(naming.derivedAssetName('crop', '   '), 'Crop-image.png');
  assert.equal(naming.derivedAssetName('crop', 'no-extension'), 'Crop-no-extension.png');
});

test('downloads keep the stored asset name instead of renaming', () => {
  const naming = loadAssetNaming();

  assert.deepEqual(
    naming.storedImageDownloadTarget({ localUrl: 'forart-asset://output/asset_1.png', fileName: 'Crop-模特图.png' }),
    { imageUrl: 'forart-asset://output/asset_1.png', fileName: 'Crop-模特图.png' },
  );
  assert.deepEqual(
    naming.storedImageDownloadTarget({ url: 'forart-asset://output/asset_2.png', fileName: 'APImart-gpt-image-2-08220905.png' }),
    { imageUrl: 'forart-asset://output/asset_2.png', fileName: 'APImart-gpt-image-2-08220905.png' },
  );
  // 库内没有名字时才使用兜底名。
  assert.equal(
    naming.storedImageDownloadTarget({ localUrl: 'forart-asset://output/asset_3.png' }).fileName,
    naming.FALLBACK_DOWNLOAD_NAME,
  );
  // 没有图片地址时不应产生下载目标。
  assert.equal(naming.storedImageDownloadTarget({ fileName: 'a.png' }), null);
  assert.equal(naming.storedImageDownloadTarget(undefined), null);
});
