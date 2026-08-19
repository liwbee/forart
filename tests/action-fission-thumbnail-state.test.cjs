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

test('action rows restore the canonical API thumbnail from the original asset URL', () => {
  const relative = normalizeActionFissionRow({
    id: 'row-relative',
    categoryGroups: [],
    selectedActionAssetUrl: '/api/assets/asset-1/file',
  });
  const absolute = normalizeActionFissionRow({
    id: 'row-absolute',
    categoryGroups: [],
    selectedActionAssetUrl: 'https://example.com/api/assets/asset-2/file?forart_token=token',
  });

  assert.equal(relative.selectedActionThumbUrl, '/api/assets/asset-1/thumb');
  assert.equal(
    absolute.selectedActionThumbUrl,
    'https://example.com/api/assets/asset-2/thumb?forart_token=token',
  );
});

test('compact single-group rows restore their durable category configuration', () => {
  const normalized = normalizeActionFissionRow({
    id: 'row-compact',
    actionProjectId: 'project-1',
    includeActionTagIds: ['tag-a', 'tag-a', ''],
    excludeActionTagIds: ['tag-b'],
    selectedActionId: 'action-1',
    selectedActionPrompt: 'Offline prompt',
  });

  assert.deepEqual(normalized.categoryGroups, [{
    id: 'row-compact_group_1',
    name: undefined,
    actionProjectId: 'project-1',
    includeActionTagIds: ['tag-a'],
    excludeActionTagIds: ['tag-b'],
  }]);
  assert.equal(normalized.selectedCategoryGroupId, 'row-compact_group_1');
  assert.equal(normalized.selectedActionId, 'action-1');
  assert.equal(normalized.selectedActionPrompt, 'Offline prompt');
  assert.equal('actionProjectId' in normalized, false);
  assert.equal('includeActionTagIds' in normalized, false);
  assert.equal('excludeActionTagIds' in normalized, false);
});
