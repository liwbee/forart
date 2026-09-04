const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadModule() {
  const filePath = path.join(__dirname, '..', 'renderer', 'src', 'features', 'infinite-canvas', 'generation', 'imageReverseResult.ts');
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filePath,
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', '__filename', '__dirname', output)(require, loaded, loaded.exports, filePath, path.dirname(filePath));
  return loaded.exports;
}

test('smart reverse outputs are written as readable multi-line node text', () => {
  const { smartReverseResultText } = loadModule();
  assert.equal(smartReverseResultText({ outputs: [{ detailedPrompt: '主体细节' }] }), '主体细节');
  assert.equal(smartReverseResultText({ outputs: [{ detailedPrompt: '第一张' }, { detailedPrompt: '第二张' }] }), '图1\n第一张\n\n图2\n第二张');
  assert.equal(smartReverseResultText({ outputs: [{ detailedPrompt: 'First' }, { detailedPrompt: 'Second' }] }, 'en-US'), 'Image 1\nFirst\n\nImage 2\nSecond');
});
