const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadModule() {
  const filePath = path.join(
    __dirname,
    '..',
    'renderer',
    'src',
    'features',
    'infinite-canvas',
    'action-fission',
    'actionFissionSelection.ts',
  );
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filePath,
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', '__filename', '__dirname', output)(
    require, loaded, loaded.exports, filePath, path.dirname(filePath),
  );
  return loaded.exports;
}

function row(overrides = {}) {
  return {
    id: 'row-1',
    categoryGroups: [{ id: 'g1', actionProjectId: 'p1', includeActionTagIds: [], excludeActionTagIds: [] }],
    selectedCategoryGroupId: 'g1',
    selectedActionId: undefined,
    selectedActionName: undefined,
    selectedActionPrompt: undefined,
    selectedActionTags: undefined,
    selectedActionAssetUrl: undefined,
    selectedActionThumbUrl: undefined,
    ...overrides,
  };
}

// Regression guard: an earlier version kept the row whenever its *configuration* matched,
// which dropped the action the auto-assignment effect had just picked. The row stayed
// pending, the effect wrote again on the next render, and the canvas republished nodes
// until React aborted with "Maximum update depth exceeded".
test('a changed selection is applied', () => {
  const { withActionFissionSelection } = loadModule();
  const current = row();
  const source = row({ selectedActionId: 'action-1', selectedActionName: 'Action 1', selectedActionTags: ['a'] });

  const next = withActionFissionSelection(current, source);
  assert.notEqual(next, current);
  assert.equal(next.selectedActionId, 'action-1');
  assert.equal(next.selectedActionName, 'Action 1');
  assert.deepEqual(next.selectedActionTags, ['a']);
  assert.equal(next.selectedCategoryGroupId, 'g1');
});

test('an unchanged selection keeps the row identity so nothing is republished', () => {
  const { withActionFissionSelection } = loadModule();
  const current = row({ selectedActionId: 'action-1', selectedActionTags: ['a'] });
  const source = row({ selectedActionId: 'action-1', selectedActionTags: ['a'], selectedActionName: 'Action 1' });

  // Same selection values (array contents compared by value) → identical row.
  assert.equal(withActionFissionSelection(current, row({ selectedActionId: 'action-1', selectedActionTags: ['a'] })), current);
  // A genuinely different field still applies.
  assert.notEqual(withActionFissionSelection(current, source), current);
});

test('clearing a selection is applied as well', () => {
  const { withActionFissionSelection } = loadModule();
  const current = row({ selectedActionId: 'action-1' });
  const next = withActionFissionSelection(current, row());

  assert.notEqual(next, current);
  assert.equal(next.selectedActionId, undefined);
});
