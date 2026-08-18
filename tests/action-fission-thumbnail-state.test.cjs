const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const moduleCache = new Map();

function loadTypeScriptModule(filePath) {
  const resolvedPath = path.resolve(filePath);
  if (moduleCache.has(resolvedPath)) return moduleCache.get(resolvedPath).exports;
  const loaded = { exports: {} };
  moduleCache.set(resolvedPath, loaded);
  const output = ts.transpileModule(fs.readFileSync(resolvedPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: resolvedPath,
  }).outputText;
  const localRequire = (request) => {
    if (!request.startsWith('.')) return require(request);
    const dependency = path.resolve(path.dirname(resolvedPath), request);
    return loadTypeScriptModule(path.extname(dependency) ? dependency : `${dependency}.ts`);
  };
  new Function('require', 'module', 'exports', '__filename', '__dirname', output)(
    localRequire,
    loaded,
    loaded.exports,
    resolvedPath,
    path.dirname(resolvedPath),
  );
  return loaded.exports;
}

const { actionPatchFromEntry, normalizeActionFissionRow } = loadTypeScriptModule(path.join(
  __dirname,
  '..',
  'renderer',
  'src',
  'features',
  'infinite-canvas',
  'action-fission',
  'actionFissionState.ts',
));

test('action rows keep original and thumbnail URLs semantically separate', () => {
  const withoutThumbnail = actionPatchFromEntry({
    id: 'action-1',
    name: 'Action 1',
    prompt: '',
    tags: [],
    asset_url: 'action-original.png',
    thumbnail_url: '',
  });
  const withThumbnail = actionPatchFromEntry({
    id: 'action-2',
    name: 'Action 2',
    prompt: '',
    tags: [],
    asset_url: 'action-original-2.png',
    thumbnail_url: 'action-thumb-2.webp',
  });

  assert.equal(withoutThumbnail.selectedActionAssetUrl, 'action-original.png');
  assert.equal(withoutThumbnail.selectedActionThumbUrl, undefined);
  assert.equal(withThumbnail.selectedActionThumbUrl, 'action-thumb-2.webp');
});

test('legacy action rows stop treating the original URL as a completed thumbnail', () => {
  const normalized = normalizeActionFissionRow({
    id: 'row-1',
    categoryGroups: [{
      id: 'group-1',
      actionProjectId: 'project-1',
      includeActionTagIds: [],
      excludeActionTagIds: [],
    }],
    selectedCategoryGroupId: 'group-1',
    selectedActionAssetUrl: 'legacy-original.png',
    selectedActionThumbUrl: 'legacy-original.png',
  });

  assert.equal(normalized.selectedActionThumbUrl, undefined);
});
