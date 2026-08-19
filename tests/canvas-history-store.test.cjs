const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadHistoryStore() {
  const previousTsLoader = require.extensions['.ts'];
  require.extensions['.ts'] = (loadedModule, filePath) => {
    const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
      compilerOptions: {
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
      fileName: filePath,
    }).outputText;
    loadedModule._compile(output, filePath);
  };
  const filePath = path.join(
    __dirname,
    '..',
    'renderer',
    'src',
    'features',
    'infinite-canvas',
    'canvasHistoryStore.ts',
  );
  delete require.cache[require.resolve(filePath)];
  const loaded = require(filePath);
  require.extensions['.ts'] = previousTsLoader;
  return loaded;
}

function node(id, data = {}, extra = {}) {
  return {
    id,
    type: 'canvasNode',
    position: { x: 0, y: 0 },
    data: { kind: 'imageGenerator', label: id, ...data },
    style: { width: 320, height: 320 },
    ...extra,
  };
}

function edge(id = 'edge-1') {
  return {
    id,
    type: 'default',
    source: 'source',
    target: 'target',
    data: { inputKind: 'prompt' },
  };
}

test('generation runtime changes neither add history nor clear redo', () => {
  const history = loadHistoryStore();
  const initial = node('generator', { text: 'before' });
  history.resetInfiniteCanvasHistory([initial], []);
  history.recordInfiniteCanvasHistory([node('generator', { text: 'after' })], []);
  history.undoInfiniteCanvasHistory();

  let temporal = history.useInfiniteCanvasHistoryStore.temporal.getState();
  assert.equal(temporal.futureStates.length, 1);

  history.recordInfiniteCanvasHistory([node('generator', {
    text: 'before',
    latestGenerationTaskId: 'task-live',
    generatedImages: [{ localUrl: 'result.png', thumbUrl: 'thumb.png', downloadState: 'downloaded' }],
    imageNaturalWidth: 1024,
    imageNaturalHeight: 768,
    multiImageExpanded: false,
  }, {
    position: { x: -160, y: 0 },
    style: { width: 640, height: 320 },
  })], []);

  temporal = history.useInfiniteCanvasHistoryStore.temporal.getState();
  assert.equal(temporal.pastStates.length, 0);
  assert.equal(temporal.futureStates.length, 1);
});

test('multi-image expansion is view state and does not add history', () => {
  const history = loadHistoryStore();
  const collapsed = node('generator', {
    generatedImages: [{ localUrl: 'one.png' }, { localUrl: 'two.png' }],
    multiImageExpanded: false,
  }, {
    position: { x: 20, y: 30 },
    style: { width: 320, height: 240 },
  });
  history.resetInfiniteCanvasHistory([collapsed], []);
  history.recordInfiniteCanvasHistory([node('generator', {
    generatedImages: [{ localUrl: 'one.png' }, { localUrl: 'two.png' }],
    multiImageExpanded: true,
    multiImageCollapsedSize: { width: 320, height: 240 },
  }, {
    position: { x: 20, y: 30 },
    style: { width: 648, height: 240 },
  })], []);

  assert.equal(history.useInfiniteCanvasHistoryStore.temporal.getState().pastStates.length, 0);
});

test('silent node rebases preserve redo and carry runtime data through the timeline', () => {
  const history = loadHistoryStore();
  history.resetInfiniteCanvasHistory([node('generator', { text: 'before' })], []);
  history.recordInfiniteCanvasHistory([node('generator', { text: 'after' })], []);
  history.undoInfiniteCanvasHistory();

  history.rebaseInfiniteCanvasHistoryNode('generator', (current) => ({
    ...current,
    data: {
      ...current.data,
      latestGenerationTaskId: 'task-1',
      generatedImages: [{ localUrl: 'result.png' }],
    },
  }));

  let temporal = history.useInfiniteCanvasHistoryStore.temporal.getState();
  assert.equal(temporal.pastStates.length, 0);
  assert.equal(temporal.futureStates.length, 1);
  assert.equal(temporal.futureStates[0].snapshot.nodes[0].data.latestGenerationTaskId, 'task-1');

  const redone = history.redoInfiniteCanvasHistory();
  temporal = history.useInfiniteCanvasHistoryStore.temporal.getState();
  assert.equal(temporal.pastStates.length, 1);
  assert.equal(redone.nodes[0].data.text, 'after');
  assert.equal(redone.nodes[0].data.latestGenerationTaskId, 'task-1');
  assert.deepEqual(redone.nodes[0].data.generatedImages, [{ localUrl: 'result.png' }]);
});

test('a silent rebase preserves an active gesture pause', () => {
  const history = loadHistoryStore();
  history.resetInfiniteCanvasHistory([node('generator', { text: 'before' })], []);
  const previous = history.beginInfiniteCanvasHistoryGesture();
  assert.equal(history.useInfiniteCanvasHistoryStore.temporal.getState().isTracking, false);

  history.rebaseInfiniteCanvasHistoryNode('generator', (current) => ({
    ...current,
    data: { ...current.data, latestGenerationTaskId: 'task-live' },
  }));

  assert.equal(history.useInfiniteCanvasHistoryStore.temporal.getState().isTracking, false);
  history.recordInfiniteCanvasHistory([node('generator', {
    text: 'after',
    latestGenerationTaskId: 'task-live',
  })], []);
  history.commitInfiniteCanvasHistoryGesture(previous);
  assert.equal(history.useInfiniteCanvasHistoryStore.temporal.getState().pastStates.length, 1);
});

test('reset recovers tracking after an interrupted gesture', () => {
  const history = loadHistoryStore();
  history.resetInfiniteCanvasHistory([node('first')], []);
  history.beginInfiniteCanvasHistoryGesture();
  assert.equal(history.useInfiniteCanvasHistoryStore.temporal.getState().isTracking, false);

  history.resetInfiniteCanvasHistory([node('second')], []);

  const temporal = history.useInfiniteCanvasHistoryStore.temporal.getState();
  assert.equal(temporal.isTracking, true);
  assert.equal(temporal.pastStates.length, 0);
  assert.equal(temporal.futureStates.length, 0);
});

test('silent current normalization preserves authored future state', () => {
  const history = loadHistoryStore();
  history.resetInfiniteCanvasHistory([node('generator', {
    imageProviderId: 'provider-a',
    imageModel: 'model-a',
  })], []);
  history.recordInfiniteCanvasHistory([node('generator', {
    imageProviderId: 'provider-b',
    imageModel: 'model-b',
  })], []);
  history.undoInfiniteCanvasHistory();

  history.rebaseInfiniteCanvasHistoryNode(
    'generator',
    (current) => ({
      ...current,
      data: { ...current.data, imageResolution: '1024x1024' },
    }),
    (historical) => historical,
  );

  const temporal = history.useInfiniteCanvasHistoryStore.temporal.getState();
  assert.equal(temporal.futureStates.length, 1);
  assert.equal(temporal.futureStates[0].snapshot.nodes[0].data.imageProviderId, 'provider-b');
  assert.equal(temporal.futureStates[0].snapshot.nodes[0].data.imageResolution, undefined);
  const redone = history.redoInfiniteCanvasHistory();
  assert.equal(redone.nodes[0].data.imageProviderId, 'provider-b');
  assert.equal(redone.nodes[0].data.imageResolution, undefined);
});

test('an image-loader thumbnail rebase keeps redo available', () => {
  const history = loadHistoryStore();
  const loader = (label, thumbUrl) => node('loader', {
    kind: 'imageLoader',
    label,
    imageUrl: 'asset.png',
    thumbUrl,
  });
  history.resetInfiniteCanvasHistory([loader('before')], []);
  history.recordInfiniteCanvasHistory([loader('after')], []);
  history.undoInfiniteCanvasHistory();

  history.rebaseInfiniteCanvasHistoryNode('loader', (current) => ({
    ...current,
    data: { ...current.data, thumbUrl: 'thumb.png' },
  }));

  assert.equal(history.useInfiniteCanvasHistoryStore.temporal.getState().futureStates.length, 1);
  const redone = history.redoInfiniteCanvasHistory();
  assert.equal(redone.nodes[0].data.label, 'after');
  assert.equal(redone.nodes[0].data.thumbUrl, 'thumb.png');
});

test('action fission runtime rebases do not flatten authored row configuration', () => {
  const history = loadHistoryStore();
  const actionNode = (projectId, resultUrl) => node('fission', {
    kind: 'actionFission',
    actionFission: {
      rows: [{
        id: 'row-1',
        categoryGroups: [{
          id: 'group-1',
          actionProjectId: projectId,
          includeActionTagIds: [],
          excludeActionTagIds: [],
        }],
        selectedCategoryGroupId: 'group-1',
        resultUrl,
      }],
    },
  });
  history.resetInfiniteCanvasHistory([actionNode('project-a')], []);
  history.recordInfiniteCanvasHistory([actionNode('project-b')], []);
  history.undoInfiniteCanvasHistory();

  const patchRuntime = (current) => ({
    ...current,
    data: {
      ...current.data,
      actionFission: {
        ...current.data.actionFission,
        rows: current.data.actionFission.rows.map((row) => ({
          ...row,
          resultUrl: 'result.png',
          latestGenerationTaskId: 'task-1',
        })),
      },
    },
  });
  history.rebaseInfiniteCanvasHistoryNode('fission', patchRuntime);

  const redone = history.redoInfiniteCanvasHistory();
  assert.equal(redone.nodes[0].data.actionFission.rows[0].categoryGroups[0].actionProjectId, 'project-b');
  assert.equal(redone.nodes[0].data.actionFission.rows[0].resultUrl, 'result.png');
  assert.equal(redone.nodes[0].data.actionFission.rows[0].latestGenerationTaskId, 'task-1');
});

test('action fission thumbnails follow the selected asset across undo', () => {
  const history = loadHistoryStore();
  const actionNode = (assetUrl, thumbUrl) => node('fission', {
    kind: 'actionFission',
    actionFission: {
      rows: [{
        id: 'row-1',
        categoryGroups: [],
        selectedActionId: assetUrl,
        selectedActionAssetUrl: assetUrl,
        selectedActionThumbUrl: thumbUrl,
      }],
    },
  });
  const before = actionNode('asset-a.png', 'thumb-a.png');
  const current = actionNode('asset-b.png', 'thumb-b.png');
  history.resetInfiniteCanvasHistory([before], []);
  history.recordInfiniteCanvasHistory([current], []);

  const restored = history.restoreInfiniteCanvasHistorySnapshot(
    history.undoInfiniteCanvasHistory(),
    [current],
    [],
  );
  const row = restored.nodes[0].data.actionFission.rows[0];
  assert.equal(row.selectedActionAssetUrl, 'asset-a.png');
  assert.equal(row.selectedActionThumbUrl, 'thumb-a.png');
});

test('multiple prompt changes inside one gesture create one undo entry', () => {
  const history = loadHistoryStore();
  history.resetInfiniteCanvasHistory([node('prompt', { kind: 'prompt', text: '' })], []);
  const previous = history.beginInfiniteCanvasHistoryGesture();
  for (const text of ['a', 'ab', 'abc']) {
    history.recordInfiniteCanvasHistory([node('prompt', { kind: 'prompt', text })], []);
  }
  history.commitInfiniteCanvasHistoryGesture(previous);

  assert.equal(history.useInfiniteCanvasHistoryStore.temporal.getState().pastStates.length, 1);
  const undone = history.undoInfiniteCanvasHistory();
  assert.equal(undone.nodes[0].data.text, '');
});

test('undo overlays current generation state while restoring authored data', () => {
  const history = loadHistoryStore();
  const before = node('generator', {
    text: 'before',
    libtvImageGeneration: { modelName: 'model-a', error: 'old runtime error' },
  });
  const current = node('generator', {
    text: 'after',
    latestGenerationTaskId: 'task-live',
    generatedImages: [{ localUrl: 'result.png' }],
    imageNaturalWidth: 1024,
    imageNaturalHeight: 768,
    libtvImageGeneration: { modelName: 'model-a', error: 'latest runtime error' },
  }, {
    position: { x: -160, y: 0 },
    style: { width: 640, height: 320 },
  });
  history.resetInfiniteCanvasHistory([before], []);
  history.recordInfiniteCanvasHistory([current], []);

  const restored = history.restoreInfiniteCanvasHistorySnapshot(
    history.undoInfiniteCanvasHistory(),
    [current],
    [],
  );

  assert.equal(restored.nodes[0].data.text, 'before');
  assert.equal(restored.nodes[0].data.latestGenerationTaskId, 'task-live');
  assert.deepEqual(restored.nodes[0].data.generatedImages, [{ localUrl: 'result.png' }]);
  assert.equal(restored.nodes[0].data.libtvImageGeneration.error, 'latest runtime error');
  assert.deepEqual(restored.nodes[0].style, { width: 640, height: 320 });
  assert.deepEqual(restored.nodes[0].position, { x: -160, y: 0 });
});

test('edge creation and deletion restore the exact historical edge set', () => {
  const history = loadHistoryStore();
  const nodes = [node('source'), node('target')];
  const connection = edge();

  history.resetInfiniteCanvasHistory(nodes, []);
  history.recordInfiniteCanvasHistory(nodes, [connection]);
  const undoCreation = history.restoreInfiniteCanvasHistorySnapshot(
    history.undoInfiniteCanvasHistory(),
    nodes,
    [connection],
  );
  assert.deepEqual(undoCreation.edges, []);

  history.resetInfiniteCanvasHistory(nodes, [connection]);
  history.recordInfiniteCanvasHistory(nodes, []);
  const undoDeletion = history.restoreInfiniteCanvasHistorySnapshot(
    history.undoInfiniteCanvasHistory(),
    nodes,
    [],
  );
  assert.deepEqual(undoDeletion.edges.map((item) => item.id), ['edge-1']);
});

test('a resize gesture records one durable size and never restores resizing state', () => {
  const history = loadHistoryStore();
  const initial = node('prompt', { kind: 'prompt' }, { style: { width: 260, height: 160 } });
  history.resetInfiniteCanvasHistory([initial], []);
  const previous = history.beginInfiniteCanvasHistoryGesture();
  for (let width = 280; width <= 360; width += 20) {
    history.recordInfiniteCanvasHistory([node('prompt', { kind: 'prompt' }, {
      width,
      height: 200,
      measured: { width, height: 200 },
      resizing: true,
      style: { width: 260, height: 160 },
    })], []);
  }
  history.commitInfiniteCanvasHistoryGesture(previous);

  assert.equal(history.useInfiniteCanvasHistoryStore.temporal.getState().pastStates.length, 1);
  const resized = history.useInfiniteCanvasHistoryStore.getState().snapshot.nodes[0];
  assert.deepEqual(resized.style, { width: 360, height: 200 });
  assert.equal('resizing' in resized, false);

  const restored = history.restoreInfiniteCanvasHistorySnapshot(
    history.undoInfiniteCanvasHistory(),
    [resized],
    [],
  );
  assert.deepEqual(restored.nodes[0].style, { width: 260, height: 160 });
  assert.equal(restored.nodes[0].resizing, false);
});
