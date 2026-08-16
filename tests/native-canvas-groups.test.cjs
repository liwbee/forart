const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadGroups() {
  const filePath = path.join(__dirname, '..', 'renderer', 'src', 'features', 'infinite-canvas', 'nativeCanvasGroups.ts');
  const source = fs.readFileSync(filePath, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filePath,
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', '__filename', '__dirname', output)(
    require,
    loaded,
    loaded.exports,
    filePath,
    path.dirname(filePath),
  );
  return loaded.exports;
}

function groupFixture() {
  return [{
    id: 'group-1',
    type: 'groupNode',
    position: { x: 100, y: 200 },
    style: { width: 500, height: 400 },
    data: { kind: 'group', label: 'Group' },
    selected: true,
  }, {
    id: 'child-1',
    type: 'canvasNode',
    parentId: 'group-1',
    extent: 'parent',
    position: { x: 40, y: 60 },
    style: { width: 100, height: 80 },
    data: { kind: 'prompt', label: 'Prompt' },
  }];
}

test('a child remains grouped while its center is inside the parent', () => {
  const { detachNativeCanvasChildrenOutsideParents } = loadGroups();
  const nodes = groupFixture();
  assert.equal(detachNativeCanvasChildrenOutsideParents(nodes, new Set(['child-1'])), nodes);
});

test('a child becomes a root node after its center leaves the parent', () => {
  const { detachNativeCanvasChildrenOutsideParents } = loadGroups();
  const nodes = groupFixture();
  nodes[1].dragging = true;
  nodes[1].position = { x: 510, y: 60 };
  const detached = detachNativeCanvasChildrenOutsideParents(nodes, new Set(['child-1']));
  assert.equal(detached[1].parentId, undefined);
  assert.equal(detached[1].extent, undefined);
  assert.equal(detached[1].dragging, false);
  assert.deepEqual(detached[1].position, { x: 610, y: 260 });
});

test('ungroup removes the parent and preserves every child absolute position', () => {
  const { ungroupNativeCanvasNodes } = loadGroups();
  const ungrouped = ungroupNativeCanvasNodes(groupFixture(), 'group-1');
  assert.equal(ungrouped.length, 1);
  assert.equal(ungrouped[0].parentId, undefined);
  assert.deepEqual(ungrouped[0].position, { x: 140, y: 260 });
  assert.equal(ungrouped[0].selected, true);
});

test('copying one grouped child prepares an independent root position', () => {
  const { prepareNativeCanvasNodesForClipboard } = loadGroups();
  const nodes = groupFixture();
  const [prepared] = prepareNativeCanvasNodesForClipboard([nodes[1]], nodes);
  assert.equal(prepared.parentId, undefined);
  assert.deepEqual(prepared.position, { x: 140, y: 260 });
});

test('copying a complete group keeps native parent-relative coordinates', () => {
  const { prepareNativeCanvasNodesForClipboard } = loadGroups();
  const nodes = groupFixture();
  const prepared = prepareNativeCanvasNodesForClipboard(nodes, nodes);
  assert.equal(prepared[1].parentId, 'group-1');
  assert.deepEqual(prepared[1].position, { x: 40, y: 60 });
});

test('copying a group collects its complete native parent subtree', () => {
  const { collectNativeCanvasSubtree } = loadGroups();
  const nodes = groupFixture();
  assert.deepEqual(
    collectNativeCanvasSubtree('group-1', nodes).map((node) => node.id),
    ['group-1', 'child-1'],
  );
});

test('marquee selection expands a selected group to its ordinary descendants', () => {
  const { expandNativeCanvasGroupSelection } = loadGroups();
  const nodes = groupFixture().map((node) => ({ ...node, selected: true }));
  const expanded = expandNativeCanvasGroupSelection(nodes);
  assert.deepEqual(expanded.groupIds, []);
  assert.equal(expanded.nodes[0].selected, false);
  assert.equal(expanded.nodes[1].selected, true);
});

test('regrouping grouped children removes the old empty group and avoids nesting', () => {
  const { groupNativeCanvasNodes } = loadGroups();
  const source = groupFixture().map((node) => ({ ...node, selected: node.id === 'child-1' }));
  const group = {
    id: 'group-2',
    type: 'groupNode',
    position: { x: 80, y: 180 },
    style: { width: 500, height: 400 },
    data: { kind: 'group', label: 'New group' },
  };
  const grouped = groupNativeCanvasNodes(source, new Set(['child-1']), group);
  assert.deepEqual(grouped.map((node) => node.id), ['group-2', 'child-1']);
  assert.equal(grouped[1].parentId, 'group-2');
  assert.deepEqual(grouped[1].position, { x: 60, y: 80 });
});

test('grouping clears the multi-selection and selects only the new group', () => {
  const { groupNativeCanvasNodes } = loadGroups();
  const source = [{
    id: 'child-1',
    type: 'canvasNode',
    position: { x: 140, y: 260 },
    data: { kind: 'prompt', label: 'Prompt' },
    selected: true,
  }];
  const group = groupFixture()[0];
  const grouped = groupNativeCanvasNodes(source, new Set(['child-1']), group);
  assert.equal(grouped[0].selected, true);
  assert.equal(grouped[1].selected, false);
  assert.equal(grouped[1].parentId, 'group-1');
  assert.deepEqual(grouped[1].position, { x: 40, y: 60 });
});
