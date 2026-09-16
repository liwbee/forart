const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

// Loads a renderer TS module and resolves its relative TS imports, so the rules can be
// unit tested without a bundler.
function loadTsModule(filePath, cache = new Map()) {
  if (cache.has(filePath)) return cache.get(filePath).exports;
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filePath,
  }).outputText;
  const loaded = { exports: {} };
  cache.set(filePath, loaded);
  const localRequire = (specifier) => {
    if (!specifier.startsWith('.')) return require(specifier);
    const resolved = path.resolve(path.dirname(filePath), specifier);
    const target = fs.existsSync(resolved) && fs.statSync(resolved).isFile() ? resolved : `${resolved}.ts`;
    return target.endsWith('.ts') ? loadTsModule(target, cache) : require(target);
  };
  new Function('require', 'module', 'exports', output)(localRequire, loaded, loaded.exports);
  return loaded.exports;
}

function loadRules() {
  return loadTsModule(path.join(
    __dirname,
    '..',
    'renderer',
    'src',
    'features',
    'infinite-canvas',
    'action-fission',
    'actionFissionRules.ts',
  ));
}

function row(id) {
  return {
    id,
    categoryGroups: [{
      id: `${id}_group_1`,
      actionProjectId: 'project-1',
      includeActionTagIds: [],
      excludeActionTagIds: [],
    }],
    selectedCategoryGroupId: `${id}_group_1`,
  };
}

function candidatesFor(rowId, actions) {
  return [[rowId, [{ group: { id: `${rowId}_group_1`, actionProjectId: 'project-1', includeActionTagIds: [], excludeActionTagIds: [] }, actions }]]];
}

// Regression guard: this effect used to write node data even when the action library
// could not fill a row, republishing the canvas on every render until React aborted with
// "Maximum update depth exceeded" (seen on older canvases whose stored filters no longer
// match any action). An assignment that changes nothing must be reported as "no change".
test('an unfillable row reports no change instead of republishing the node', () => {
  const rules = loadRules();
  const rows = [row('row-1')];
  const unfillable = new Map(candidatesFor('row-1', []));

  assert.equal(rules.assignPendingActionFissionRows(rows, unfillable, new Set(['row-1'])), null);
  assert.equal(rules.assignPendingActionFissionRows(rows, new Map([[ 'row-1', [] ]]), new Set(['row-1'])), null);
  assert.equal(rules.assignPendingActionFissionRows(rows, new Map(), new Set(['row-1'])), null);
});

test('a fillable row is assigned and reported as a change', () => {
  const rules = loadRules();
  const rows = [row('row-1')];
  const fillable = new Map(candidatesFor('row-1', [{ id: 'action-1', name: 'Action 1', prompt: 'p', tags: [] }]));

  const next = rules.assignPendingActionFissionRows(rows, fillable, new Set(['row-1']));
  assert.ok(Array.isArray(next));
  assert.equal(next[0].selectedActionId, 'action-1');
  assert.notEqual(next[0], rows[0]);
});

// Documents the flip side: a shared candidate is not a stuck row. pickRandomAction falls
// back to a taken action rather than leaving the row empty, so only rows with no usable
// candidate at all can be reported as "no change".
test('a row still gets assigned when another row already took its only candidate', () => {
  const rules = loadRules();
  const taken = { ...row('row-2'), selectedActionId: 'action-1' };
  const rows = [row('row-1'), taken];
  const candidates = new Map(candidatesFor('row-1', [{ id: 'action-1', name: 'Action 1', prompt: 'p', tags: [] }]));

  const next = rules.assignPendingActionFissionRows(rows, candidates, new Set(['row-1']));
  assert.ok(Array.isArray(next));
  assert.equal(next[0].selectedActionId, 'action-1');
  assert.equal(next[1], taken);
});

test('rowIds outside the request are left untouched', () => {
  const rules = loadRules();
  const rows = [row('row-1'), row('row-2')];
  const fillable = new Map(candidatesFor('row-2', [{ id: 'action-2', name: 'Action 2', prompt: 'p', tags: [] }]));

  assert.equal(rules.assignPendingActionFissionRows(rows, fillable, new Set(['row-1'])), null);
  const next = rules.assignPendingActionFissionRows(rows, fillable, new Set(['row-2']));
  assert.ok(Array.isArray(next));
  assert.equal(next[0], rows[0]);
  assert.equal(next[1].selectedActionId, 'action-2');
});
