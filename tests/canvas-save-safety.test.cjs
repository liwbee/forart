const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createCanvasStore } = require('../electron/main/modules/canvas-store.cjs');
const { registerCanvasIpc } = require('../electron/main/ipc/canvas-ipc.cjs');

async function withStore(run) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-canvas-save-'));
  try {
    return await run(createCanvasStore({ rootDir }), rootDir);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
}

function serializedCanvas(canvas, overrides = {}) {
  const nodes = overrides.nodes || canvas.nodes || [];
  return JSON.stringify({
    ...canvas,
    ...overrides,
    canvasSchemaVersion: 2,
    updatedAt: '__FORART_SAVE_UPDATED_AT__',
    revision: '__FORART_SAVE_REVISION__',
    nodes,
    connections: overrides.connections || canvas.connections || [],
    groups: overrides.groups || canvas.groups || [],
  });
}

test('canvas text saves use revisions and reject an unexpected empty overwrite', async () => withStore(async (store) => {
  const canvas = store.createCanvas({
    nodes: [{ id: 'node-1', data: { kind: 'prompt', text: 'saved work' } }],
  }).canvas;
  assert.equal(canvas.revision, 1);

  await assert.rejects(() => store.saveCanvasText(canvas.id, {
    jsonText: serializedCanvas(canvas, { nodes: [], connections: [] }),
    nodeCount: 0,
  }), /empty canvas snapshot/i);
  assert.equal(store.readCanvas(canvas.id).nodes.length, 1);

  const saveResult = await store.saveCanvasText(canvas.id, {
    jsonText: serializedCanvas(canvas, { nodes: [], connections: [] }),
    nodeCount: 0,
    allowEmpty: true,
  });
  const cleared = store.readCanvas(canvas.id);
  assert.equal(Object.hasOwn(saveResult, 'canvas'), false);
  assert.equal(saveResult.record.id, canvas.id);
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

test('successful text saves leave no temporary canvas file and flush a coalesced index', async () => withStore(async (store, rootDir) => {
  const canvas = store.createCanvas({ nodes: [] }).canvas;
  await store.saveCanvasText(canvas.id, {
    jsonText: serializedCanvas(canvas, {
      nodes: [{ id: 'node-1', data: { kind: 'prompt', text: 'saved work' } }],
      connections: [],
    }),
    nodeCount: 1,
  });
  await store.flushPendingIndexWrite();

  assert.equal(fs.existsSync(`${store.canvasPath(canvas.id)}.tmp`), false);
  assert.equal(fs.existsSync(path.join(rootDir, 'CanvasAssests', 'canvas-index.json.tmp')), false);
  const serialized = fs.readFileSync(store.canvasPath(canvas.id), 'utf8');
  assert.equal(serialized, JSON.stringify(JSON.parse(serialized)));
}));

test('coalesced index persistence does not call synchronous fsync after a text save', async () => withStore(async (store) => {
  const canvas = store.createCanvas({ nodes: [] }).canvas;
  const originalFsyncSync = fs.fsyncSync;
  let synchronousFsyncCalls = 0;
  fs.fsyncSync = (...args) => {
    synchronousFsyncCalls += 1;
    return originalFsyncSync(...args);
  };
  try {
    await store.saveCanvasText(canvas.id, {
      jsonText: serializedCanvas(canvas, {
        nodes: [{ id: 'node-1', data: { kind: 'prompt' } }],
      }),
      nodeCount: 1,
    });
    await store.flushPendingIndexWrite();
  } finally {
    fs.fsyncSync = originalFsyncSync;
  }
  assert.equal(synchronousFsyncCalls, 0);
}));

test('project mutations await asynchronous index persistence', async () => withStore(async (store, rootDir) => {
  const originalFsyncSync = fs.fsyncSync;
  let synchronousFsyncCalls = 0;
  fs.fsyncSync = (...args) => {
    synchronousFsyncCalls += 1;
    return originalFsyncSync(...args);
  };
  try {
    const created = await store.createProject({ title: 'Async project' });
    await store.updateProject(created.project.id, { title: 'Renamed project' });
    const indexPath = path.join(rootDir, 'CanvasAssests', 'canvas-index.json');
    const persisted = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    assert.equal(persisted.projects.find((project) => project.id === created.project.id).title, 'Renamed project');
    await store.deleteProject(created.project.id);
  } finally {
    fs.fsyncSync = originalFsyncSync;
  }
  assert.equal(synchronousFsyncCalls, 0);
}));

test('text save replaces the canvas without reading or parsing the previous document', async () => withStore(async (store) => {
  const canvas = store.createCanvas({
    nodes: [{ id: 'old-node', data: { kind: 'prompt' } }],
  }).canvas;
  fs.writeFileSync(store.canvasPath(canvas.id), '{malformed old canvas', 'utf8');

  await store.saveCanvasText(canvas.id, {
    jsonText: serializedCanvas(canvas, {
      nodes: [{ id: 'new-node', data: { kind: 'prompt' } }],
    }),
    nodeCount: 1,
  });

  assert.equal(store.readCanvas(canvas.id).nodes[0].id, 'new-node');
}));

test('startup rebuilds an index that missed the last asynchronous canvas update', async () => withStore(async (store, rootDir) => {
  const canvas = store.createCanvas({ nodes: [] }).canvas;
  const indexPath = path.join(rootDir, 'CanvasAssests', 'canvas-index.json');
  const staleIndex = fs.readFileSync(indexPath, 'utf8');
  await store.saveCanvasText(canvas.id, {
    jsonText: serializedCanvas(canvas, {
      nodes: [{ id: 'persisted-node', data: { kind: 'prompt' } }],
    }),
    nodeCount: 1,
  });
  await store.flushPendingIndexWrite();
  fs.writeFileSync(indexPath, staleIndex, 'utf8');

  const restarted = createCanvasStore({ rootDir });
  const records = restarted.listCanvases();
  assert.equal(records[0].nodeCount, 1);
  assert.equal(records[0].revision, 2);
}));

test('a generation result committed during an async text save is replayed after the atomic replacement', async () => withStore(async (store) => {
  const canvas = store.createCanvas({
    nodes: [{
      id: 'generator-1',
      type: 'canvasNode',
      data: { kind: 'imageGenerator', latestGenerationTaskId: 'task-1' },
    }],
  }).canvas;
  const save = store.saveCanvasText(canvas.id, {
    jsonText: serializedCanvas(canvas),
    nodeCount: 1,
  });

  const committed = store.completeGenerationNode({
    canvasId: canvas.id,
    nodeId: 'generator-1',
    taskId: 'task-1',
    status: 'succeeded',
    result: { localUrl: 'forart-asset://output/result.png', fileName: 'result.png' },
  });
  assert.equal(committed.applied, true);
  await save;

  const savedNode = store.readCanvas(canvas.id).nodes[0];
  assert.equal(savedNode.data.generatedImages[0].localUrl, 'forart-asset://output/result.png');
}));

test('canvas metadata changed during an async text save is replayed after the atomic replacement', async () => withStore(async (store) => {
  const canvas = store.createCanvas({
    title: 'Old title',
    nodes: [{ id: 'node-1', data: { kind: 'prompt' } }],
  }).canvas;
  const save = store.saveCanvasText(canvas.id, {
    jsonText: serializedCanvas(canvas),
    nodeCount: 1,
  });

  const updated = store.updateCanvasMeta(canvas.id, { title: 'New title' });
  assert.equal(updated.record.title, 'New title');
  await save;

  assert.equal(store.readCanvas(canvas.id).title, 'New title');
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
      async saveCanvasText(canvasId, payload) {
        saves.push({ canvasId, payload });
        return {
          ok: true,
          record: { id: canvasId, nodeCount: payload.nodeCount },
          filePath: 'canvas.json',
        };
      },
    },
    assetStore: {},
    canvasPackageStore: {},
    generationTaskStore: {},
    imageGenerationRunner: runner,
  });
  const save = handlers.get('canvas:save');
  const saved = await save(null, 'canvas-1', {
    saveSessionId: 'session',
    saveSessionStartedAt: 100,
    saveSequence: 2,
    jsonText: '{"canvasSchemaVersion":2,"id":"canvas-1","nodes":[{"id":"new"}]}',
    nodeCount: 1,
  });
  const stale = await save(null, 'canvas-1', { saveSessionId: 'session', saveSessionStartedAt: 100, saveSequence: 1, jsonText: '{}', nodeCount: 1 });

  assert.equal(saves.length, 1);
  assert.equal(typeof saves[0].payload.jsonText, 'string');
  assert.equal(saves[0].payload.nodeCount, 1);
  assert.equal(reconciliations, 0);
  assert.deepEqual(saved, { ok: true, record: { id: 'canvas-1', nodeCount: 1 } });
  assert.equal(Object.hasOwn(saved, 'canvas'), false);
  assert.equal(Object.hasOwn(saved, 'filePath'), false);
  assert.equal(stale.stale, true);
});

test('main-process canvas saves are serialized per canvas before stale-sequence checks', async () => {
  const handlers = new Map();
  const calls = [];
  let active = 0;
  let maxActive = 0;
  let releaseFirst;
  const firstBlocked = new Promise((resolve) => { releaseFirst = resolve; });
  registerCanvasIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    app: { getPath: () => '' },
    canvasStore: {
      async saveCanvasText(_canvasId, payload) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        calls.push(payload.saveSequence);
        if (payload.saveSequence === 1) await firstBlocked;
        active -= 1;
        return { ok: true };
      },
    },
    assetStore: {},
    canvasPackageStore: {},
  });
  const save = handlers.get('canvas:save');
  const first = save(null, 'canvas-1', {
    saveSessionId: 'session', saveSessionStartedAt: 100, saveSequence: 1, jsonText: '{}', nodeCount: 1,
  });
  const second = save(null, 'canvas-1', {
    saveSessionId: 'session', saveSessionStartedAt: 100, saveSequence: 2, jsonText: '{}', nodeCount: 1,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [1]);
  releaseFirst();
  await Promise.all([first, second]);

  assert.deepEqual(calls, [1, 2]);
  assert.equal(maxActive, 1);
});

test('canvas save stops active generation tasks whose targets were deleted', async () => {
  const handlers = new Map();
  const stoppedTaskIds = [];
  registerCanvasIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    app: { getPath: () => '' },
    canvasStore: {
      async saveCanvasText() {
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
    jsonText: '{"canvasSchemaVersion":2,"id":"canvas-1","nodes":[{"id":"existing-node"}]}',
    nodeCount: 1,
  });

  assert.deepEqual(stoppedTaskIds, ['active-missing']);
});
