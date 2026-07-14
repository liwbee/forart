const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadGenerationHookLifecycle() {
  const filePath = path.join(
    __dirname,
    '..',
    'renderer',
    'src',
    'features',
    'infinite-canvas',
    'generation',
    'generationHookLifecycle.ts',
  );
  const source = fs.readFileSync(filePath, 'utf8');
  const output = ts.transpileModule(source, {
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

test('generation hooks remain mounted after the React StrictMode setup-cleanup-setup probe', () => {
  const { activateGenerationHook } = loadGenerationHookLifecycle();
  const mountedRef = { current: true };
  let cleanupCount = 0;

  const firstCleanup = activateGenerationHook(mountedRef, () => { cleanupCount += 1; });
  firstCleanup();
  assert.equal(mountedRef.current, false);

  const finalCleanup = activateGenerationHook(mountedRef, () => { cleanupCount += 1; });
  assert.equal(mountedRef.current, true);

  finalCleanup();
  assert.equal(mountedRef.current, false);
  assert.equal(cleanupCount, 2);
});

test('every renderer-owned generation hook uses the StrictMode-safe lifecycle', () => {
  const hookPaths = [
    path.join('generation', 'useNativeImageGeneration.ts'),
    path.join('generation', 'useNativeActionFissionGeneration.ts'),
    path.join('libtv-generation', 'useNativeLibtvGeneration.ts'),
  ];

  for (const hookPath of hookPaths) {
    const source = fs.readFileSync(path.join(
      __dirname,
      '..',
      'renderer',
      'src',
      'features',
      'infinite-canvas',
      hookPath,
    ), 'utf8');
    assert.match(source, /useEffect\(\(\) => activateGenerationHook\(mountedRef,/);
  }
});
