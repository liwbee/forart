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

test('canvas snapshot semantics ignore React Flow interaction and measurement state', () => {
  const { canvasSnapshotSignatures } = loadSnapshotSemantics();
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

  assert.deepEqual(canvasSnapshotSignatures(transient), canvasSnapshotSignatures(base));
});

test('canvas snapshot semantics persist explicit React Flow resize dimensions in node style', () => {
  const { canvasSnapshotForStorage, canvasSnapshotSignatures } = loadSnapshotSemantics();
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
  assert.notEqual(canvasSnapshotSignatures(resized).content, canvasSnapshotSignatures(base).content);
});

test('canvas snapshot semantics ignore transient generation polling objects but keep task anchors', () => {
  const { canvasSnapshotSignatures } = loadSnapshotSemantics();
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
  const transient = snapshot({
    nodes: [{
      ...base.nodes[0],
      data: {
        ...base.nodes[0].data,
        generationTask: { id: 'poll-1', status: 'running', updatedAt: 20 },
        libtvImageGeneration: {
          ...base.nodes[0].data.libtvImageGeneration,
          task: { id: 'libtv-poll', status: 'running' },
        },
        actionFission: {
          ...base.nodes[0].data.actionFission,
          rows: [{
            id: 'row-1',
            generationTask: { id: 'row-poll', status: 'running' },
            libtvTask: { id: 'row-libtv-poll', status: 'running' },
            libtvQueued: true,
            libtvRunning: true,
          }],
        },
      },
    }],
  });
  const anchored = snapshot({
    nodes: [{
      ...base.nodes[0],
      data: { ...base.nodes[0].data, generationTaskId: 'task-anchor' },
    }],
  });

  assert.deepEqual(canvasSnapshotSignatures(transient), canvasSnapshotSignatures(base));
  assert.notEqual(canvasSnapshotSignatures(anchored).content, canvasSnapshotSignatures(base).content);
});

test('viewport changes require silent persistence without changing the content signature', () => {
  const { canvasSnapshotSignatures } = loadSnapshotSemantics();
  const base = canvasSnapshotSignatures(snapshot());
  const moved = canvasSnapshotSignatures(snapshot({ viewport: { x: 20, y: -10, zoom: 1.25 } }));

  assert.equal(moved.content, base.content);
  assert.notEqual(moved.persistence, base.persistence);
});

test('download markers persist silently without making canvas content dirty', () => {
  const { canvasSnapshotSignatures } = loadSnapshotSemantics();
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
  const pendingSignatures = canvasSnapshotSignatures(pending);
  const downloadedSignatures = canvasSnapshotSignatures(downloaded);

  assert.equal(downloadedSignatures.content, pendingSignatures.content);
  assert.notEqual(downloadedSignatures.persistence, pendingSignatures.persistence);
});

test('durable canvas content changes alter both signatures', () => {
  const { canvasSnapshotSignatures } = loadSnapshotSemantics();
  const base = snapshot();
  const changed = snapshot({
    nodes: [{ ...base.nodes[0], data: { ...base.nodes[0].data, text: 'changed' } }],
  });

  assert.notEqual(canvasSnapshotSignatures(changed).content, canvasSnapshotSignatures(base).content);
  assert.notEqual(canvasSnapshotSignatures(changed).persistence, canvasSnapshotSignatures(base).persistence);
});

test('save state keeps viewport persistence silent and detects edits during an active save', () => {
  const { canvasSnapshotSaveState, canvasSnapshotSignatures } = loadSnapshotSemantics();
  const saved = canvasSnapshotSignatures(snapshot());
  const viewportOnly = canvasSnapshotSignatures(snapshot({ viewport: { x: 30, y: 40, zoom: 0.8 } }));
  const editedSnapshot = snapshot();
  editedSnapshot.nodes = [{
    ...editedSnapshot.nodes[0],
    data: { ...editedSnapshot.nodes[0].data, text: 'edited while saving' },
  }];
  const edited = canvasSnapshotSignatures(editedSnapshot);

  assert.deepEqual(canvasSnapshotSaveState(viewportOnly, saved), {
    contentDirty: false,
    persistenceDirty: true,
    status: 'saved',
  });
  assert.deepEqual(canvasSnapshotSaveState(saved, saved, { signatures: saved, reportsStatus: true }), {
    contentDirty: false,
    persistenceDirty: false,
    status: 'saving',
  });
  assert.deepEqual(canvasSnapshotSaveState(edited, saved, { signatures: saved, reportsStatus: true }), {
    contentDirty: true,
    persistenceDirty: true,
    status: 'unsaved',
  });
  assert.deepEqual(canvasSnapshotSaveState(viewportOnly, saved, {
    signatures: viewportOnly,
    reportsStatus: false,
  }), {
    contentDirty: false,
    persistenceDirty: false,
    status: 'saved',
  });
});
