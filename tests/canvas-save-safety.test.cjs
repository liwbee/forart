const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createCanvasStore } = require('../electron/main/modules/canvas-store.cjs');
const { registerCanvasIpc } = require('../electron/main/ipc/canvas-ipc.cjs');

function withStore(run) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-canvas-save-'));
  try {
    return run(createCanvasStore({ rootDir }), rootDir);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
}

test('canvas saves use revisions and reject an unexpected empty overwrite', () => withStore((store) => {
  const canvas = store.createCanvas({
    nodes: [{ id: 'node-1', data: { kind: 'prompt', text: 'saved work' } }],
  }).canvas;
  assert.equal(canvas.revision, 1);

  assert.throws(() => store.saveCanvas(canvas.id, { nodes: [], connections: [] }), /empty canvas snapshot/i);
  assert.equal(store.readCanvas(canvas.id).nodes.length, 1);

  const cleared = store.saveCanvas(canvas.id, { nodes: [], connections: [], allowEmpty: true }).canvas;
  assert.equal(cleared.nodes.length, 0);
  assert.equal(cleared.revision, 2);
}));

test('a valid newer temporary canvas is recovered and consumed on load', () => withStore((store) => {
  const canvas = store.createCanvas({
    nodes: [{ id: 'node-old', data: { kind: 'prompt', text: 'old' } }],
  }).canvas;
  const filePath = store.canvasPath(canvas.id);
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify({
    ...canvas,
    revision: canvas.revision + 1,
    nodes: [{ id: 'node-recovered', data: { kind: 'prompt', text: 'recovered' } }],
  }), 'utf8');

  const recovered = store.readCanvas(canvas.id);
  assert.equal(recovered.nodes[0].id, 'node-recovered');
  assert.equal(recovered.revision, 2);
  assert.equal(fs.existsSync(temporaryPath), false);
  assert.equal(JSON.parse(fs.readFileSync(filePath, 'utf8')).nodes[0].id, 'node-recovered');
}));

test('a valid temporary canvas recovers a malformed primary file', () => withStore((store) => {
  const canvas = store.createCanvas({
    nodes: [{ id: 'node-old', data: { kind: 'prompt', text: 'old' } }],
  }).canvas;
  const filePath = store.canvasPath(canvas.id);
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify({
    ...canvas,
    revision: canvas.revision + 1,
    nodes: [{ id: 'node-recovered', data: { kind: 'prompt', text: 'recovered' } }],
  }), 'utf8');
  fs.writeFileSync(filePath, '{broken', 'utf8');

  const recovered = store.readCanvas(canvas.id);
  assert.equal(recovered.nodes[0].id, 'node-recovered');
  assert.equal(fs.existsSync(temporaryPath), false);
}));

test('index rebuilding discovers a canvas that only has a complete temporary file', () => withStore((store, rootDir) => {
  const canvas = store.createCanvas({ nodes: [] }).canvas;
  const filePath = store.canvasPath(canvas.id);
  fs.renameSync(filePath, `${filePath}.tmp`);
  fs.writeFileSync(path.join(rootDir, 'CanvasAssests', 'canvas-index.json'), '{broken', 'utf8');

  const canvases = store.listCanvases();
  assert.equal(canvases.length, 1);
  assert.equal(canvases[0].id, canvas.id);
  assert.equal(fs.existsSync(filePath), true);
  assert.equal(fs.existsSync(`${filePath}.tmp`), false);
}));

test('a malformed index rebuilds from valid canvas files on the first list', () => withStore((store, rootDir) => {
  const canvas = store.createCanvas({
    nodes: [{ id: 'node-1', data: { kind: 'prompt', text: 'saved work' } }],
  }).canvas;
  fs.writeFileSync(path.join(rootDir, 'CanvasAssests', 'canvas-index.json'), '{broken', 'utf8');

  const canvases = store.listCanvases();
  assert.equal(canvases.length, 1);
  assert.equal(canvases[0].id, canvas.id);
}));

test('successful saves leave no temporary canvas or index files behind', () => withStore((store, rootDir) => {
  const canvas = store.createCanvas({ nodes: [] }).canvas;
  store.saveCanvas(canvas.id, {
    nodes: [{ id: 'node-1', data: { kind: 'prompt', text: 'saved work' } }],
    connections: [],
  });

  assert.equal(fs.existsSync(`${store.canvasPath(canvas.id)}.tmp`), false);
  assert.equal(fs.existsSync(path.join(rootDir, 'CanvasAssests', 'canvas-index.json.tmp')), false);
}));

test('main-process saves do not consult in-memory task runners', async () => {
  const handlers = new Map();
  const saves = [];
  let reconciliations = 0;
  const runner = {
    reconcileCanvasPayload() {
      reconciliations += 1;
      throw new Error('Canvas save must not reconcile task state.');
    },
  };
  registerCanvasIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    app: { getPath: () => '' },
    canvasStore: {
      saveCanvas(canvasId, payload) {
        saves.push({ canvasId, payload });
        return { ok: true };
      },
    },
    assetStore: {},
    canvasPackageStore: {},
    generationTaskStore: {},
    imageGenerationRunner: runner,
  });
  const save = handlers.get('canvas:save');
  await save(null, 'canvas-1', {
    saveSessionId: 'session',
    saveSessionStartedAt: 100,
    saveSequence: 2,
    nodes: [{ id: 'new', data: { generatedImages: [{ localUrl: 'forart-asset://output/image.png', downloadState: 'downloaded' }] } }],
  });
  const stale = await save(null, 'canvas-1', { saveSessionId: 'session', saveSessionStartedAt: 100, saveSequence: 1, nodes: [{ id: 'old' }] });

  assert.equal(saves.length, 1);
  assert.equal(saves[0].payload.nodes[0].id, 'new');
  assert.equal(saves[0].payload.nodes[0].data.generatedImages[0].downloadState, 'downloaded');
  assert.equal(reconciliations, 0);
  assert.equal(stale.stale, true);
});

test('canvas save stops active generation tasks whose targets were deleted', async () => {
  const handlers = new Map();
  const stoppedTaskIds = [];
  registerCanvasIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    app: { getPath: () => '' },
    canvasStore: {
      saveCanvas() {
        return { ok: true };
      },
      findMissingGenerationTargets(tasks) {
        return tasks.filter((task) => task.target.nodeId === 'deleted-node');
      },
    },
    assetStore: {},
    canvasPackageStore: {},
    generationTaskService: {
      listTasksForCanvas() {
        return [
          { id: 'active-missing', status: 'running', target: { canvasId: 'canvas-1', kind: 'imageGenerator', nodeId: 'deleted-node' } },
          { id: 'active-existing', status: 'queued', target: { canvasId: 'canvas-1', kind: 'imageGenerator', nodeId: 'existing-node' } },
          { id: 'terminal-missing', status: 'succeeded', target: { canvasId: 'canvas-1', kind: 'imageGenerator', nodeId: 'deleted-node' } },
        ];
      },
      stopTask(taskId) {
        stoppedTaskIds.push(taskId);
        return { id: taskId, status: 'interrupted' };
      },
    },
  });

  await handlers.get('canvas:save')(null, 'canvas-1', {
    nodes: [{ id: 'existing-node' }],
  });

  assert.deepEqual(stoppedTaskIds, ['active-missing']);
});
