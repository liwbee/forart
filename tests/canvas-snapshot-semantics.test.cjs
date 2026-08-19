const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadSnapshotSemantics() {
  const filePath = path.join(__dirname, '..', 'renderer', 'src', 'features', 'infinite-canvas', 'canvasSnapshotSemantics.ts');
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

function snapshot(overrides = {}) {
  return {
    nodes: [{
      id: 'node-1',
      type: 'canvasNode',
      position: { x: 10, y: 20 },
      data: { kind: 'prompt', label: 'Prompt', text: 'hello' },
      style: { width: 260, height: 160 },
    }],
    edges: [{ id: 'edge-1', type: 'default', source: 'node-1', target: 'node-2' }],
    viewport: { x: 0, y: 0, zoom: 1 },
    ...overrides,
  };
}

function persistenceState(module, value) {
  const stored = module.canvasSnapshotForStorage(value);
  return {
    stored,
    content: module.storedCanvasContentSignature(stored),
    document: module.serializeCanvasDocument({
      id: 'canvas-1',
      title: 'Test canvas',
      projectId: 'project-1',
      createdAt: 1,
      viewport: { x: 0, y: 0, zoom: 1 },
    }, stored),
  };
}

test('canvas snapshot semantics ignore React Flow interaction and measurement state', () => {
  const module = loadSnapshotSemantics();
  const base = snapshot();
  const transient = snapshot({
    nodes: [{
      ...base.nodes[0],
      selected: true,
      dragging: true,
      measured: { width: 260, height: 160 },
      width: 260,
      height: 160,
    }],
    edges: [{ ...base.edges[0], selected: true }],
  });

  assert.deepEqual(persistenceState(module, transient), persistenceState(module, base));
});

test('canvas snapshot semantics persist explicit React Flow resize dimensions in node style', () => {
  const module = loadSnapshotSemantics();
  const { canvasSnapshotForStorage } = module;
  const base = snapshot();
  const resized = snapshot({
    nodes: [{
      ...base.nodes[0],
      width: 420,
      height: 280,
      measured: { width: 420, height: 280 },
      resizing: false,
    }],
  });

  const stored = canvasSnapshotForStorage(resized);
  assert.deepEqual(stored.nodes[0].style, { width: 420, height: 280 });
  assert.equal('width' in stored.nodes[0], false);
  assert.equal('height' in stored.nodes[0], false);
  assert.notEqual(persistenceState(module, resized).content, persistenceState(module, base).content);
});

test('canvas snapshot semantics persist native parent groups and discard legacy group ids', () => {
  const { canvasSnapshotForStorage } = loadSnapshotSemantics();
  const grouped = snapshot({
    nodes: [{
      id: 'group-1',
      type: 'groupNode',
      position: { x: 40, y: 60 },
      data: { kind: 'group', label: 'Group' },
      width: 640,
      height: 420,
    }, {
      ...snapshot().nodes[0],
      parentId: 'group-1',
      extent: 'parent',
      position: { x: 28, y: 28 },
      data: { ...snapshot().nodes[0].data, groupId: 'legacy-group' },
    }],
  });

  const stored = canvasSnapshotForStorage(grouped);
  assert.equal(stored.nodes[0].type, 'groupNode');
  assert.deepEqual(stored.nodes[0].style, { width: 640, height: 420 });
  assert.equal(stored.nodes[1].parentId, 'group-1');
  assert.equal('extent' in stored.nodes[1], false);
  assert.equal('groupId' in stored.nodes[1].data, false);
});

test('canvas snapshot semantics persist unified task pointers silently', () => {
  const module = loadSnapshotSemantics();
  const plain = snapshot();
  const base = snapshot({
    nodes: [{
      ...plain.nodes[0],
      data: {
        ...plain.nodes[0].data,
        libtvImageGeneration: {},
        actionFission: { rows: [{ id: 'row-1' }] },
      },
    }],
  });
  const anchored = snapshot({
    nodes: [{
      ...base.nodes[0],
      data: {
        ...base.nodes[0].data,
        latestGenerationTaskId: 'task-anchor',
        actionFission: { rows: [{ id: 'row-1', latestGenerationTaskId: 'row-task-anchor' }] },
      },
    }],
  });

  assert.equal(persistenceState(module, anchored).content, persistenceState(module, base).content);
  assert.notEqual(persistenceState(module, anchored).document, persistenceState(module, base).document);
});

test('viewport changes stay outside canvas dirty signatures', () => {
  const module = loadSnapshotSemantics();
  const base = persistenceState(module, snapshot());
  const moved = persistenceState(module, snapshot({ viewport: { x: 20, y: -10, zoom: 1.25 } }));

  assert.equal(moved.content, base.content);
  assert.equal(moved.document, base.document);
});

test('download markers persist silently without making canvas content dirty', () => {
  const module = loadSnapshotSemantics();
  const plain = snapshot();
  const pending = snapshot({
    nodes: [{
      ...plain.nodes[0],
      data: {
        ...plain.nodes[0].data,
        generatedImages: [{ localUrl: '/result.png', downloadState: 'pending' }],
        actionFission: {
          rows: [{ id: 'row-1', resultUrl: '/row.png', resultDownloadState: 'pending' }],
        },
      },
    }],
  });
  const downloaded = snapshot({
    nodes: [{
      ...pending.nodes[0],
      data: {
        ...pending.nodes[0].data,
        generatedImages: [{
          localUrl: '/result.png',
          downloadState: 'downloaded',
          downloadedAt: 100,
        }],
        actionFission: {
          rows: [{
            id: 'row-1',
            resultUrl: '/row.png',
            resultDownloadState: 'downloaded',
            resultDownloadedAt: 100,
          }],
        },
      },
    }],
  });
  const pendingSignatures = persistenceState(module, pending);
  const downloadedSignatures = persistenceState(module, downloaded);

  assert.equal(downloadedSignatures.content, pendingSignatures.content);
  assert.notEqual(downloadedSignatures.document, pendingSignatures.document);
});

test('canvas snapshot storage removes unused action metadata but preserves reusable thumbnails', () => {
  const { canvasSnapshotForStorage } = loadSnapshotSemantics();
  const base = snapshot();
  const stored = canvasSnapshotForStorage(snapshot({
    nodes: [{
      ...base.nodes[0],
      data: {
        kind: 'actionFission',
        label: 'Fission',
        thumbUrl: 'forart-asset://canvas/input/thumb/node.webp',
        generatedImages: [{
          localUrl: 'forart-asset://canvas/output/result.png',
          thumbUrl: 'forart-asset://canvas/output/thumb/result.webp',
        }],
        actionFission: {
          rows: [{
            id: 'row-1',
            selectedActionId: 'action-1',
            selectedActionName: 'Pose 1',
            selectedActionPrompt: 'Keep this offline prompt',
            selectedActionTags: ['unused display cache'],
            selectedActionAssetUrl: '/api/assets/action-1/file',
            selectedActionThumbUrl: '/api/assets/action-1/thumb',
            resultUrl: 'forart-asset://canvas/output/result.png',
            resultThumbUrl: 'forart-asset://canvas/output/thumb/result.webp',
            resultFileName: 'result.png',
            resultWidth: 1024,
            resultHeight: 1365,
            resultDownloadState: 'downloaded',
            resultDownloadedAt: 100,
            useAdditionalReferences: false,
            categoryGroups: [{
              id: 'group-1',
              actionProjectId: 'project-1',
              includeActionTagIds: ['tag-1'],
              excludeActionTagIds: [],
            }],
            selectedCategoryGroupId: 'group-1',
          }],
        },
      },
    }],
  }));
  const data = stored.nodes[0].data;
  const image = data.generatedImages[0];
  const row = data.actionFission.rows[0];

  assert.equal(data.thumbUrl, 'forart-asset://canvas/input/thumb/node.webp');
  assert.equal(image.thumbUrl, 'forart-asset://canvas/output/thumb/result.webp');
  assert.equal('selectedActionTags' in row, false);
  assert.equal(row.selectedActionThumbUrl, '/api/assets/action-1/thumb');
  assert.equal(row.resultThumbUrl, 'forart-asset://canvas/output/thumb/result.webp');
  assert.equal('resultWidth' in row, false);
  assert.equal('resultHeight' in row, false);
  assert.equal('useAdditionalReferences' in row, false);
  assert.equal('categoryGroups' in row, false);
  assert.equal('selectedCategoryGroupId' in row, false);
  assert.equal(row.actionProjectId, 'project-1');
  assert.deepEqual(row.includeActionTagIds, ['tag-1']);
  assert.equal('excludeActionTagIds' in row, false);
  assert.equal(row.selectedActionPrompt, 'Keep this offline prompt');
  assert.equal(row.selectedActionAssetUrl, '/api/assets/action-1/file');
  assert.equal(row.resultUrl, 'forart-asset://canvas/output/result.png');
  assert.equal(row.resultFileName, 'result.png');
  assert.equal(row.resultDownloadState, 'downloaded');
});

test('canvas snapshot storage keeps named or multi-group action-fission configuration expanded', () => {
  const { canvasSnapshotForStorage } = loadSnapshotSemantics();
  const base = snapshot();
  const categoryGroups = [{
    id: 'group-1',
    name: 'Primary',
    actionProjectId: 'project-1',
    includeActionTagIds: [],
    excludeActionTagIds: [],
  }, {
    id: 'group-2',
    actionProjectId: 'project-2',
    includeActionTagIds: [],
    excludeActionTagIds: [],
  }];
  const stored = canvasSnapshotForStorage(snapshot({
    nodes: [{
      ...base.nodes[0],
      data: {
        kind: 'actionFission',
        label: 'Fission',
        actionFission: {
          rows: [{
            id: 'row-1',
            categoryGroups,
            selectedCategoryGroupId: 'group-2',
          }],
        },
      },
    }],
  }));
  const row = stored.nodes[0].data.actionFission.rows[0];

  assert.deepEqual(row.categoryGroups, categoryGroups);
  assert.equal(row.selectedCategoryGroupId, 'group-2');
});

test('durable canvas content changes alter both signatures', () => {
  const module = loadSnapshotSemantics();
  const base = snapshot();
  const changed = snapshot({
    nodes: [{ ...base.nodes[0], data: { ...base.nodes[0].data, text: 'changed' } }],
  });

  assert.notEqual(persistenceState(module, changed).content, persistenceState(module, base).content);
  assert.notEqual(persistenceState(module, changed).document, persistenceState(module, base).document);
});

test('persistence state ignores viewport changes and detects durable edits', () => {
  const module = loadSnapshotSemantics();
  const saved = persistenceState(module, snapshot());
  const viewportOnly = persistenceState(module, snapshot({ viewport: { x: 30, y: 40, zoom: 0.8 } }));
  const editedSnapshot = snapshot();
  editedSnapshot.nodes = [{
    ...editedSnapshot.nodes[0],
    data: { ...editedSnapshot.nodes[0].data, text: 'edited while saving' },
  }];
  const edited = persistenceState(module, editedSnapshot);

  assert.equal(viewportOnly.content, saved.content);
  assert.equal(viewportOnly.document, saved.document);
  assert.notEqual(edited.content, saved.content);
  assert.notEqual(edited.document, saved.document);
});

test('canvas document serializer emits the final schema-v2 JSON with one stringify', () => {
  const {
    CANVAS_SAVE_REVISION_PLACEHOLDER,
    CANVAS_SAVE_UPDATED_AT_PLACEHOLDER,
    canvasSnapshotForStorage,
    serializeCanvasDocument,
  } = loadSnapshotSemantics();
  const stored = canvasSnapshotForStorage(snapshot());
  const document = {
    id: 'canvas-1',
    title: 'Serializer test',
    icon: 'layers',
    projectId: 'project-1',
    color: '',
    pinned: false,
    createdAt: 100,
    viewport: { x: 15, y: 25, zoom: 0.75 },
  };
  const originalStringify = JSON.stringify;
  let stringifyCalls = 0;
  JSON.stringify = (...args) => {
    stringifyCalls += 1;
    return originalStringify(...args);
  };
  try {
    const jsonText = serializeCanvasDocument(document, stored);
    const parsed = JSON.parse(jsonText);
    assert.equal(stringifyCalls, 1);
    assert.equal(parsed.canvasSchemaVersion, 2);
    assert.equal(parsed.id, 'canvas-1');
    assert.equal('icon' in parsed, false);
    assert.equal('canvasType' in parsed, false);
    assert.equal('color' in parsed, false);
    assert.equal(parsed.updatedAt, CANVAS_SAVE_UPDATED_AT_PLACEHOLDER);
    assert.equal(parsed.revision, CANVAS_SAVE_REVISION_PLACEHOLDER);
    assert.deepEqual(parsed.connections, stored.connections);
    assert.deepEqual(parsed.viewport, { x: 15, y: 25, scale: 0.75 });
  } finally {
    JSON.stringify = originalStringify;
  }
});

test('canvas document serializer keeps non-default canvas metadata', () => {
  const { canvasSnapshotForStorage, serializeCanvasDocument } = loadSnapshotSemantics();
  const stored = canvasSnapshotForStorage(snapshot());
  const parsed = JSON.parse(serializeCanvasDocument({
    id: 'canvas-custom-meta',
    title: 'Custom metadata',
    icon: 'star',
    color: '#123456',
    projectId: 'project-1',
    createdAt: 100,
    viewport: { x: 0, y: 0, zoom: 1 },
  }, stored));

  assert.equal(parsed.icon, 'star');
  assert.equal(parsed.color, '#123456');
  assert.equal('canvasType' in parsed, false);
});

test('canvas document serializer handles a stress-sized snapshot without changing node data', () => {
  const { canvasSnapshotForStorage, serializeCanvasDocument } = loadSnapshotSemantics();
  const largeText = 'x'.repeat(8_000);
  const largeSnapshot = snapshot({
    nodes: Array.from({ length: 150 }, (_, index) => ({
      id: `node-${index}`,
      type: 'canvasNode',
      position: { x: index * 10, y: index * 5 },
      data: { kind: 'prompt', label: `Node ${index}`, text: largeText },
      style: { width: 260, height: 160 },
    })),
    edges: [],
  });
  const stored = canvasSnapshotForStorage(largeSnapshot);
  const jsonText = serializeCanvasDocument({
    id: 'canvas-stress',
    title: 'Stress fixture',
    projectId: 'project-1',
    createdAt: 100,
    viewport: largeSnapshot.viewport,
  }, stored);
  assert.ok(Buffer.byteLength(jsonText) > 1_000_000);
  assert.equal(JSON.parse(jsonText).nodes[149].data.text, largeText);
});
