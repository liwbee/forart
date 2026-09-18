const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadBatchNodeSizing() {
  const filePath = path.join(__dirname, '..', 'renderer', 'src', 'features', 'infinite-canvas', 'batchNodeSizing.ts');
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  const localRequire = (specifier) => {
    if (specifier === './imageNodeSizing') {
      return { ASSET_LOADER_DEFAULT_SIZE: { width: 240, height: 320 } };
    }
    return require(specifier);
  };
  new Function('module', 'exports', 'require', output.outputText)(module, module.exports, localRequire);
  return module.exports;
}

const sizing = loadBatchNodeSizing();
const canvasCss = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'src', 'styles', 'infinite-canvas.css'), 'utf8');

test('batch nodes default to the height of four visible rows', () => {
  assert.equal(sizing.BATCH_NODE_DEFAULT_VISIBLE_ROWS, 4);
  assert.equal(sizing.BATCH_NODE_ROW_HEIGHT, 86);
  assert.equal(sizing.BATCH_NODE_ROW_GAP, 14);
  assert.equal(sizing.BATCH_NODE_HEIGHT_STEP, 100);
  assert.equal(sizing.BATCH_NODE_DEFAULT_HEIGHT, 478);
  assert.equal(sizing.batchNodeHeightForRows(5) - sizing.batchNodeHeightForRows(4), 100);
});

test('batch grid previews use the regular 3:4 asset size above an auto-height toolbar', () => {
  assert.equal(sizing.BATCH_NODE_GRID_PREVIEW_WIDTH, 240);
  assert.equal(sizing.BATCH_NODE_GRID_PREVIEW_HEIGHT, 320);
  assert.equal(sizing.BATCH_NODE_GRID_CARD_WIDTH, 240);
  assert.equal(sizing.BATCH_NODE_WIDTH_STEP, 248);
  assert.equal(sizing.BATCH_NODE_MIN_WIDTH, 762);
  assert.equal(sizing.BATCH_NODE_DEFAULT_WIDTH, 1010);
  assert.equal(sizing.batchNodeWidthForGridColumns(5) - sizing.batchNodeWidthForGridColumns(4), 248);
  assert.match(canvasCss, /grid-template-columns:\s*repeat\(auto-fill, 240px\)/);
  assert.match(canvasCss, /\.rf-action-fission-grid-card\s*\{[^}]*width:\s*240px;[^}]*height:\s*auto;[^}]*grid-template-rows:\s*320px auto;/s);
});

test('batch nodes no longer ship the removed list layout', () => {
  assert.doesNotMatch(canvasCss, /\.rf-action-fission-list-card/);
  assert.doesNotMatch(canvasCss, /\.rf-action-fission-layout-toggle/);
  assert.doesNotMatch(canvasCss, /data-layout="list"/);
});

test('batch node resize snaps width by one grid card and height by one row step', () => {
  assert.deepEqual(sizing.snapBatchNodeSize(1125, 529), { width: 1010, height: 578 });
  assert.deepEqual(sizing.snapBatchNodeSize(1135, 527), { width: 1258, height: 478 });
  assert.deepEqual(sizing.snapBatchNodeSize(300, 200), { width: 762, height: 478 });
});
