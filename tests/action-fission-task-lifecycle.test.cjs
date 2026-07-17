const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createCanvasStore } = require('../electron/main/modules/canvas-store.cjs');
const { createGenerationTaskStore } = require('../electron/main/modules/generation-task-store.cjs');
const { createImageGenerationRunner } = require('../electron/main/modules/image-generation-runner.cjs');
const { createLibtvGenerationTaskStore } = require('../electron/main/modules/libtv-generation-task-store.cjs');
const { createLibtvGenerationRunner, extractImageUrl } = require('../electron/main/modules/libtv-generation-runner.cjs');

function waitFor(predicate, timeoutMs = 3000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const value = predicate();
      if (value) {
        resolve(value);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error('Timed out waiting for test condition.'));
        return;
      }
      setTimeout(check, 5);
    };
    check();
  });
}

function createCanvasRecorder() {
  const anchors = [];
  const terminals = [];
  return {
    anchors,
    terminals,
    setActionFissionRowTaskAnchor(canvasId, nodeId, rowId, payload) {
      anchors.push({ backend: 'api', canvasId, nodeId, rowId, ...payload });
    },
    setActionFissionRowRemoteTaskId() {},
    setActionFissionRowLibtvAnchor(canvasId, nodeId, rowId, payload) {
      anchors.push({ backend: 'libtv', canvasId, nodeId, rowId, ...payload });
    },
    setGenerationTaskAnchor(canvasId, nodeId, payload) {
      anchors.push({ backend: 'api', canvasId, nodeId, ...payload });
    },
    setLibtvGenerationTaskAnchor(canvasId, nodeId, payload) {
      anchors.push({ backend: 'libtv', canvasId, nodeId, ...payload });
    },
    completeActionFissionRow(payload) {
      terminals.push(payload);
    },
    completeGenerationNode(payload) {
      terminals.push(payload);
    },
    completeLibtvGenerationNode(payload) {
      terminals.push({ backend: 'libtv', ...payload });
    },
  };
}

test('LibTV output parsing never treats an input reference as a generated result', () => {
  const pendingNode = {
    data: {
      url: [],
      params: {
        imageList: [{ nodeId: 'reference-node', url: 'https://example.test/reference.png' }],
      },
    },
  };
  assert.equal(extractImageUrl(pendingNode), '');
  assert.equal(extractImageUrl(pendingNode, JSON.stringify(pendingNode)), '');
  assert.equal(extractImageUrl({ data: { url: ['https://example.test/generated.png'], params: pendingNode.data.params } }), 'https://example.test/generated.png');
});

test('API action rows write terminal results without renderer polling', async () => {
  const canvasStore = createCanvasRecorder();
  const generationTaskStore = createGenerationTaskStore();
  let submissions = 0;
  const net = {
    async fetch() {
      submissions += 1;
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('result').toString('base64') }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  };
  const assetStore = {
    async saveAsset() {
      return { url: 'forart-asset://output/api-result.png', fileName: 'api-result.png' };
    },
  };
  const runner = createImageGenerationRunner({ net, assetStore, canvasStore, generationTaskStore });
  const target = { type: 'actionFissionRow', nodeId: 'node-api', rowId: 'row-2' };
  const task = await runner.startTask({
    canvasId: 'canvas-api',
    nodeId: 'node-api',
    target,
    kind: 'image',
    providerId: 'provider',
    provider: { id: 'provider', baseUrl: 'https://example.test/v1', apiKey: 'test', protocol: 'compatible' },
    model: 'gpt-image-2',
    prompt: 'test prompt',
    resolution: '1k',
    aspectRatio: '3:4',
  });

  await waitFor(() => ['succeeded', 'failed', 'interrupted'].includes(generationTaskStore.getTask(task.id)?.status));
  assert.equal(generationTaskStore.getTask(task.id)?.status, 'succeeded', generationTaskStore.getTask(task.id)?.error);
  assert.equal(submissions, 1);
  assert.equal(canvasStore.terminals.length, 1);
  assert.deepEqual(canvasStore.terminals[0].target, undefined);
  assert.equal(canvasStore.terminals[0].rowId, 'row-2');
  assert.equal(canvasStore.terminals[0].taskId, task.id);

});

test('API image nodes keep a local task anchor while preparation is still running', async () => {
  const canvasStore = createCanvasRecorder();
  const generationTaskStore = createGenerationTaskStore();
  let releaseResponse;
  const responseGate = new Promise((resolve) => { releaseResponse = resolve; });
  const net = {
    async fetch() {
      await responseGate;
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('result').toString('base64') }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  };
  const assetStore = {
    async saveAsset() {
      return { url: 'forart-asset://output/api-node.png', fileName: 'api-node.png' };
    },
  };
  const runner = createImageGenerationRunner({ net, assetStore, canvasStore, generationTaskStore });
  const task = await runner.startTask({
    canvasId: 'canvas-api-node',
    nodeId: 'node-api',
    target: { type: 'imageGenerator', nodeId: 'node-api' },
    providerId: 'provider',
    provider: { id: 'provider', baseUrl: 'https://example.test/v1', apiKey: 'test', protocol: 'compatible' },
    model: 'gpt-image-2',
    prompt: 'test prompt',
  });

  assert.equal(canvasStore.anchors.some((anchor) => anchor.nodeId === 'node-api' && anchor.taskId === task.id), true);

  releaseResponse();
  await waitFor(() => generationTaskStore.getTask(task.id)?.status === 'succeeded');
  assert.equal(canvasStore.terminals.some((terminal) => terminal.nodeId === 'node-api' && terminal.taskId === task.id), true);
});

test('API recovery reuses the canvas local task id and only polls the existing remote task', async () => {
  const canvasStore = createCanvasRecorder();
  const generationTaskStore = createGenerationTaskStore();
  const requests = [];
  const net = {
    async fetch(url, init = {}) {
      requests.push({ url: String(url), method: init.method || 'GET' });
      return new Response(JSON.stringify({
        data: { status: 'completed', output: { url: 'https://example.test/recovered.png' } },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  };
  const assetStore = {
    async saveAsset() {
      return { url: 'forart-asset://output/recovered.png', fileName: 'recovered.png' };
    },
  };
  const runner = createImageGenerationRunner({ net, assetStore, canvasStore, generationTaskStore });
  const task = await runner.recoverTask({
    canvasId: 'canvas-recover',
    nodeId: 'node-recover',
    rowId: 'row-recover',
    target: { type: 'actionFissionRow', nodeId: 'node-recover', rowId: 'row-recover' },
    taskId: 'gen_original_local_id',
    upstreamTaskId: 'task_existing_remote_id',
    providerId: 'apimart',
    provider: { id: 'apimart', baseUrl: 'https://example.test/v1', apiKey: 'test', protocol: 'compatible' },
    model: 'gpt-image-2',
  });

  assert.equal(task.id, 'gen_original_local_id');
  await waitFor(() => generationTaskStore.getTask(task.id)?.status === 'succeeded', 7000);
  assert.equal(requests.every((request) => request.method === 'GET'), true);
  assert.equal(canvasStore.terminals[0].taskId, 'gen_original_local_id');
  assert.equal(canvasStore.terminals[0].remoteTaskId, 'task_existing_remote_id');
});

test('stopping an API action group prevents late responses from writing results', async () => {
  const canvasStore = createCanvasRecorder();
  const generationTaskStore = createGenerationTaskStore();
  let releaseResponses;
  const responseGate = new Promise((resolve) => { releaseResponses = resolve; });
  const net = {
    async fetch() {
      await responseGate;
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('late-result').toString('base64') }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  };
  const assetStore = {
    async saveAsset() {
      return { url: 'forart-asset://output/late.png', fileName: 'late.png' };
    },
  };
  const runner = createImageGenerationRunner({ net, assetStore, canvasStore, generationTaskStore });
  const tasks = await runner.startTasks([1, 2, 3].map((row) => ({
    canvasId: 'canvas-stop',
    nodeId: 'node-stop',
    target: { type: 'actionFissionRow', nodeId: 'node-stop', rowId: `row-${row}` },
    providerId: 'provider',
    provider: { id: 'provider', baseUrl: 'https://example.test/v1', apiKey: 'test', protocol: 'compatible' },
    model: 'gpt-image-2',
    prompt: `row ${row}`,
  })));
  const stopped = runner.stopTasksForNode('canvas-stop', 'node-stop');
  assert.equal(stopped.tasks.length, 3);
  releaseResponses();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(tasks.every((task) => generationTaskStore.getTask(task.id)?.status === 'interrupted'), true);
  assert.equal(canvasStore.terminals.filter((item) => item.status === 'succeeded').length, 0);
  assert.equal(canvasStore.terminals.filter((item) => item.status === 'interrupted').length, 3);
});

test('an older action row attempt cannot overwrite the current task anchor', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-action-attempt-'));
  try {
    const canvasStore = createCanvasStore({ rootDir });
    const canvas = canvasStore.createCanvas({
      nodes: [{
        id: 'node-attempt',
        data: { actionFission: { rows: [{ id: 'row-attempt', selectedActionName: 'Walk' }] } },
      }],
    }).canvas;
    canvasStore.setActionFissionRowTaskAnchor(canvas.id, 'node-attempt', 'row-attempt', { taskId: 'task-old' });
    canvasStore.setActionFissionRowTaskAnchor(canvas.id, 'node-attempt', 'row-attempt', { taskId: 'task-new' });
    canvasStore.completeActionFissionRow({
      canvasId: canvas.id,
      nodeId: 'node-attempt',
      rowId: 'row-attempt',
      taskId: 'task-old',
      status: 'succeeded',
      result: { localUrl: 'forart-asset://output/old.png', fileName: 'old.png' },
    });
    let row = canvasStore.readCanvas(canvas.id).nodes[0].data.actionFission.rows[0];
    assert.equal(row.generationTaskId, 'task-new');
    assert.equal(row.resultUrl, undefined);
    canvasStore.completeActionFissionRow({
      canvasId: canvas.id,
      nodeId: 'node-attempt',
      rowId: 'row-attempt',
      taskId: 'task-new',
      status: 'succeeded',
      result: { localUrl: 'forart-asset://output/new.png', fileName: 'new.png' },
    });
    row = canvasStore.readCanvas(canvas.id).nodes[0].data.actionFission.rows[0];
    assert.equal(row.generationTaskId, undefined);
    assert.equal(row.resultUrl, 'forart-asset://output/new.png');

    const downloaded = canvasStore.readCanvas(canvas.id);
    downloaded.nodes[0].data.actionFission.rows[0].resultDownloadState = 'downloaded';
    downloaded.nodes[0].data.actionFission.rows[0].resultDownloadedAt = 1;
    canvasStore.saveCanvas(canvas.id, { nodes: downloaded.nodes });
    canvasStore.completeActionFissionRow({
      canvasId: canvas.id,
      nodeId: 'node-attempt',
      rowId: 'row-attempt',
      taskId: 'task-new',
      status: 'succeeded',
      result: { localUrl: 'forart-asset://output/duplicate.png', fileName: 'duplicate.png' },
    });
    row = canvasStore.readCanvas(canvas.id).nodes[0].data.actionFission.rows[0];
    assert.equal(row.resultUrl, 'forart-asset://output/new.png');
    assert.equal(row.resultDownloadState, 'downloaded');
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('LibTV limits concurrency per node, runs different nodes independently, and writes terminal rows without renderer polling', async () => {
  const canvasStore = createCanvasRecorder();
  const taskStore = createLibtvGenerationTaskStore();
  const activeByQueue = new Map();
  const maxByQueue = new Map();
  let globalActive = 0;
  let maxGlobalActive = 0;
  let remoteIndex = 0;
  let transientStartFailures = 1;
  let runAttempts = 0;
  const queueByRemoteNode = new Map();
  const busyRemoteNodes = new Set();
  const workspaceNames = [];
  const libtv = {
    async ensureNamedWorkspace({ name }) { workspaceNames.push(name); return { workspace: { id: 'workspace' } }; },
    async ensureDailyProject() { return { project: { uuid: 'project', name: 'today' } }; },
    async waitForProjectReady(input) { return { project: { uuid: input.projectUuid, name: input.projectName } }; },
    async createImageNode(_project, payload) {
      const id = `remote-${++remoteIndex}`;
      queueByRemoteNode.set(id, payload.title.includes('Node A') ? 'node-a' : 'node-b');
      if (payload.prompt === 'prompt node-b 3') busyRemoteNodes.add(id);
      return { payload: { id }, stdout: '' };
    },
    async connectLeft() {},
    async runNode(_project, remoteNodeId) {
      runAttempts += 1;
      if (busyRemoteNodes.has(remoteNodeId) && transientStartFailures > 0) {
        transientStartFailures -= 1;
        throw new Error('API Request Error code 1200000171 (2020058)');
      }
      const key = queueByRemoteNode.get(remoteNodeId);
      const active = (activeByQueue.get(key) || 0) + 1;
      activeByQueue.set(key, active);
      maxByQueue.set(key, Math.max(maxByQueue.get(key) || 0, active));
      globalActive += 1;
      maxGlobalActive = Math.max(maxGlobalActive, globalActive);
      await new Promise((resolve) => setTimeout(resolve, 30));
      activeByQueue.set(key, active - 1);
      globalActive -= 1;
      return { payload: { url: `https://example.test/${remoteNodeId}.png` }, stdout: '' };
    },
    async queryNode() { return { payload: {}, stdout: '' }; },
    async deleteNode() {},
  };
  const assetStore = {
    resolveAssetUrl() { return ''; },
    async saveAsset(payload) {
      return { url: `forart-asset://output/${encodeURIComponent(payload.url)}.png`, fileName: 'libtv-result.png', filePath: 'result.png' };
    },
  };
  const runner = createLibtvGenerationRunner({
    libtv,
    assetStore,
    canvasStore,
    taskStore,
    resolveWorkspaceName: () => 'LibtvImage-PC01',
    resolveActionFissionConcurrency: () => 2,
  });
  const payloads = ['node-a', 'node-b'].flatMap((nodeId) => [1, 2, 3].map((row) => ({
    canvasId: `canvas-${nodeId}`,
    nodeId,
    target: { type: 'actionFissionRow', nodeId, rowId: `row-${row}` },
    queueKey: `canvas-${nodeId}:${nodeId}`,
    workspaceName: 'LibtvImage',
    prompt: `prompt ${nodeId} ${row}`,
    modelName: 'Qwen Edit',
    count: 1,
    aspectRatio: '3:4',
    nodeTitle: nodeId === 'node-a' ? 'Node A' : 'Node B',
  })));
  const tasks = runner.startImageTasks(payloads);

  await waitFor(() => tasks.every((task) => taskStore.getTask(task.id)?.status === 'succeeded'), 5000);
  assert.equal(maxByQueue.get('node-a'), 2);
  assert.equal(maxByQueue.get('node-b'), 2);
  assert.equal(maxGlobalActive, 4);
  assert.equal(runAttempts, 7);
  assert.deepEqual(new Set(workspaceNames), new Set(['LibtvImage-PC01']));
  assert.equal(canvasStore.terminals.filter((item) => item.backend === 'libtv' && item.status === 'succeeded').length, 6);
  assert.equal(new Set(canvasStore.terminals.map((item) => `${item.canvasId}:${item.nodeId}:${item.rowId}`)).size, 6);
});

test('LibTV unlimited concurrency starts every row in the node pool', async () => {
  const canvasStore = createCanvasRecorder();
  const taskStore = createLibtvGenerationTaskStore();
  const runs = [];
  let releaseRuns;
  const runGate = new Promise((resolve) => { releaseRuns = resolve; });
  const libtv = {
    async ensureNamedWorkspace() { return { workspace: { id: 'workspace' } }; },
    async ensureDailyProject() { return { project: { uuid: 'project', name: 'today' } }; },
    async createImageNode(_project, payload) { return { payload: { id: payload.prompt }, stdout: '' }; },
    async connectLeft() {},
    async runNode(_project, remoteNodeId) {
      runs.push(remoteNodeId);
      await runGate;
      return { payload: { url: `https://example.test/${encodeURIComponent(remoteNodeId)}.png` }, stdout: '' };
    },
    async queryNode() { return { payload: {}, stdout: '' }; },
    async deleteNode() {},
  };
  const assetStore = {
    resolveAssetUrl() { return ''; },
    async saveAsset(payload) { return { url: `forart-asset://output/${encodeURIComponent(payload.url)}.png`, fileName: 'result.png' }; },
  };
  const runner = createLibtvGenerationRunner({
    libtv,
    assetStore,
    canvasStore,
    taskStore,
    resolveActionFissionConcurrency: () => 0,
  });
  const tasks = runner.startImageTasks([1, 2, 3, 4].map((row) => ({
    canvasId: 'canvas',
    nodeId: 'node',
    target: { type: 'actionFissionRow', nodeId: 'node', rowId: `row-${row}` },
    queueKey: 'canvas:node',
    prompt: `row-${row}`,
    modelName: 'Qwen Edit',
    aspectRatio: '3:4',
  })));

  await waitFor(() => runs.length === 4);
  assert.equal(tasks.every((task) => taskStore.getTask(task.id)?.status === 'running'), true);
  releaseRuns();
  await waitFor(() => tasks.every((task) => taskStore.getTask(task.id)?.status === 'succeeded'));
});

test('LibTV accepts intermediate action-fission concurrency values', async () => {
  const canvasStore = createCanvasRecorder();
  const taskStore = createLibtvGenerationTaskStore();
  const runs = [];
  let releaseRuns;
  const runGate = new Promise((resolve) => { releaseRuns = resolve; });
  const libtv = {
    async ensureNamedWorkspace() { return { workspace: { id: 'workspace' } }; },
    async ensureDailyProject() { return { project: { uuid: 'project', name: 'today' } }; },
    async createImageNode(_project, payload) { return { payload: { id: payload.prompt }, stdout: '' }; },
    async connectLeft() {},
    async runNode(_project, remoteNodeId) {
      runs.push(remoteNodeId);
      await runGate;
      return { payload: { url: `https://example.test/${remoteNodeId}.png` }, stdout: '' };
    },
    async queryNode() { return { payload: {}, stdout: '' }; },
    async deleteNode() {},
  };
  const assetStore = {
    resolveAssetUrl() { return ''; },
    async saveAsset() { return { url: 'forart-asset://output/result.png', fileName: 'result.png' }; },
  };
  const runner = createLibtvGenerationRunner({
    libtv,
    assetStore,
    canvasStore,
    taskStore,
    resolveActionFissionConcurrency: () => 3,
  });
  const tasks = runner.startImageTasks([1, 2, 3, 4].map((row) => ({
    canvasId: 'canvas',
    nodeId: 'node',
    target: { type: 'actionFissionRow', nodeId: 'node', rowId: `row-${row}` },
    queueKey: 'canvas:node',
    prompt: `row-${row}`,
    modelName: 'Qwen Edit',
    aspectRatio: '3:4',
  })));

  await waitFor(() => runs.length === 3);
  assert.equal(runs.length, 3);
  releaseRuns();
  await waitFor(() => tasks.every((task) => taskStore.getTask(task.id)?.status === 'succeeded'));
});

test('a failed LibTV row can re-enter an active node pool without bypassing its limit', async () => {
  const canvasStore = createCanvasRecorder();
  const taskStore = createLibtvGenerationTaskStore();
  let releaseHold;
  const holdGate = new Promise((resolve) => { releaseHold = resolve; });
  let retryAttempts = 0;
  const libtv = {
    async ensureNamedWorkspace() { return { workspace: { id: 'workspace' } }; },
    async ensureDailyProject() { return { project: { uuid: 'project', name: 'today' } }; },
    async createImageNode(_project, payload) { return { payload: { id: payload.prompt }, stdout: '' }; },
    async connectLeft() {},
    async runNode(_project, remoteNodeId) {
      if (remoteNodeId === 'hold') await holdGate;
      if (remoteNodeId === 'retry' && retryAttempts++ === 0) throw new Error('expected failure');
      return { payload: { url: `https://example.test/${remoteNodeId}.png` }, stdout: '' };
    },
    async queryNode() { return { payload: {}, stdout: '' }; },
    async deleteNode() {},
  };
  const assetStore = {
    resolveAssetUrl() { return ''; },
    async saveAsset(payload) { return { url: `forart-asset://output/${encodeURIComponent(payload.url)}.png`, fileName: 'result.png' }; },
  };
  const runner = createLibtvGenerationRunner({
    libtv,
    assetStore,
    canvasStore,
    taskStore,
    resolveActionFissionConcurrency: () => 2,
  });
  const payload = (prompt, rowId) => ({
    canvasId: 'canvas',
    nodeId: 'node',
    target: { type: 'actionFissionRow', nodeId: 'node', rowId },
    queueKey: 'canvas:node',
    prompt,
    modelName: 'Qwen Edit',
    aspectRatio: '3:4',
  });
  const [holding, failed] = runner.startImageTasks([
    payload('hold', 'row-hold'),
    payload('retry', 'row-retry'),
  ]);
  await waitFor(() => taskStore.getTask(failed.id)?.status === 'failed');

  const [retried] = runner.startImageTasks([payload('retry', 'row-retry')]);
  await waitFor(() => taskStore.getTask(retried.id)?.status === 'succeeded');
  assert.equal(taskStore.getTask(holding.id)?.status, 'running');
  releaseHold();
  await waitFor(() => taskStore.getTask(holding.id)?.status === 'succeeded');
});

test('ordinary image node anchors survive canvas reloads and reject older terminal writes', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-image-node-attempt-'));
  try {
    const canvasStore = createCanvasStore({ rootDir });
    const canvas = canvasStore.createCanvas({
      nodes: [{
        id: 'node-attempt',
        data: {
          kind: 'imageGenerator',
          imageProviderId: 'provider',
          imageModel: 'model',
          libtvImageGeneration: {},
        },
      }],
    }).canvas;

    canvasStore.setGenerationTaskAnchor(canvas.id, 'node-attempt', { taskId: 'api-old' });
    canvasStore.setGenerationTaskAnchor(canvas.id, 'node-attempt', { taskId: 'api-new' });
    canvasStore.completeGenerationNode({
      canvasId: canvas.id,
      nodeId: 'node-attempt',
      taskId: 'api-old',
      status: 'succeeded',
      result: { localUrl: 'forart-asset://output/api-old.png', fileName: 'api-old.png' },
    });
    let data = canvasStore.readCanvas(canvas.id).nodes[0].data;
    assert.equal(data.generationTaskId, 'api-new');
    assert.equal(data.generatedImages, undefined);
    assert.equal(canvasStore.listGenerationTaskAnchors()[0].taskId, 'api-new');

    canvasStore.completeGenerationNode({
      canvasId: canvas.id,
      nodeId: 'node-attempt',
      taskId: 'api-new',
      status: 'succeeded',
      result: { localUrl: 'forart-asset://output/api-new.png', fileName: 'api-new.png' },
    });
    let downloaded = canvasStore.readCanvas(canvas.id);
    downloaded.nodes[0].data.generatedImages[0].downloadState = 'downloaded';
    downloaded.nodes[0].data.generatedImages[0].downloadedAt = 1;
    canvasStore.saveCanvas(canvas.id, { nodes: downloaded.nodes });
    canvasStore.completeGenerationNode({
      canvasId: canvas.id,
      nodeId: 'node-attempt',
      taskId: 'api-new',
      status: 'succeeded',
      result: { localUrl: 'forart-asset://output/api-duplicate.png', fileName: 'api-duplicate.png' },
    });
    data = canvasStore.readCanvas(canvas.id).nodes[0].data;
    assert.equal(data.generatedImages[0].localUrl, 'forart-asset://output/api-new.png');
    assert.equal(data.generatedImages[0].downloadState, 'downloaded');

    canvasStore.setLibtvGenerationTaskAnchor(canvas.id, 'node-attempt', { taskId: 'libtv-old' });
    canvasStore.setLibtvGenerationTaskAnchor(canvas.id, 'node-attempt', { taskId: 'libtv-new', projectUuid: 'project', remoteNodeId: 'remote' });
    canvasStore.completeLibtvGenerationNode({
      canvasId: canvas.id,
      nodeId: 'node-attempt',
      taskId: 'libtv-old',
      status: 'succeeded',
      result: { localUrl: 'forart-asset://output/libtv-old.png', fileName: 'libtv-old.png' },
    });
    data = canvasStore.readCanvas(canvas.id).nodes[0].data;
    assert.equal(data.libtvImageGeneration.taskId, 'libtv-new');
    assert.equal(data.generatedImages[0].localUrl, 'forart-asset://output/api-new.png');
    assert.equal(data.generatedImages[0].downloadState, 'downloaded');
    assert.equal(canvasStore.listLibtvTaskAnchors()[0].taskId, 'libtv-new');

    canvasStore.completeLibtvGenerationNode({
      canvasId: canvas.id,
      nodeId: 'node-attempt',
      taskId: 'libtv-new',
      status: 'succeeded',
      result: { localUrl: 'forart-asset://output/libtv-new.png', fileName: 'libtv-new.png' },
    });
    data = canvasStore.readCanvas(canvas.id).nodes[0].data;
    assert.equal(data.libtvImageGeneration.taskId, undefined);
    assert.equal(data.generatedImages[0].localUrl, 'forart-asset://output/libtv-new.png');

    downloaded = canvasStore.readCanvas(canvas.id);
    downloaded.nodes[0].data.generatedImages[0].downloadState = 'downloaded';
    downloaded.nodes[0].data.generatedImages[0].downloadedAt = 2;
    canvasStore.saveCanvas(canvas.id, { nodes: downloaded.nodes });
    canvasStore.completeLibtvGenerationNode({
      canvasId: canvas.id,
      nodeId: 'node-attempt',
      taskId: 'libtv-new',
      status: 'succeeded',
      result: { localUrl: 'forart-asset://output/libtv-duplicate.png', fileName: 'libtv-duplicate.png' },
    });
    data = canvasStore.readCanvas(canvas.id).nodes[0].data;
    assert.equal(data.generatedImages[0].localUrl, 'forart-asset://output/libtv-new.png');
    assert.equal(data.generatedImages[0].downloadState, 'downloaded');
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('LibTV image node failures use the shared generation error field', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-libtv-shared-error-'));
  try {
    const canvasStore = createCanvasStore({ rootDir });
    const canvas = canvasStore.createCanvas({
      nodes: [{
        id: 'node-error',
        data: {
          kind: 'imageGenerator',
          generationError: '',
          libtvImageGeneration: { modelName: 'Qwen Edit' },
        },
      }],
    }).canvas;

    canvasStore.setLibtvGenerationTaskAnchor(canvas.id, 'node-error', {
      taskId: 'libtv-error-task',
      projectUuid: 'project',
      remoteNodeId: 'remote',
    });
    canvasStore.completeLibtvGenerationNode({
      canvasId: canvas.id,
      nodeId: 'node-error',
      taskId: 'libtv-error-task',
      status: 'failed',
      error: 'LibTV failed.',
    });

    const data = canvasStore.readCanvas(canvas.id).nodes[0].data;
    assert.equal(data.generationError, 'LibTV failed.');
    assert.equal(data.libtvImageGeneration.error, undefined);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('API task anchors clear a legacy nested LibTV error', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-api-clears-libtv-error-'));
  try {
    const canvasStore = createCanvasStore({ rootDir });
    const canvas = canvasStore.createCanvas({
      nodes: [{
        id: 'node-error',
        data: {
          kind: 'imageGenerator',
          imageProviderId: 'provider',
          imageModel: 'model',
          generationError: '',
          libtvImageGeneration: { modelName: 'Qwen Edit', error: 'Old LibTV failure.' },
        },
      }],
    }).canvas;

    canvasStore.setGenerationTaskAnchor(canvas.id, 'node-error', { taskId: 'api-task' });

    const data = canvasStore.readCanvas(canvas.id).nodes[0].data;
    assert.equal(data.generationError, '');
    assert.equal(data.libtvImageGeneration.error, undefined);
    assert.equal(data.generationTaskId, 'api-task');
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('LibTV image nodes keep anchors and write terminal results without renderer polling', async () => {
  const canvasStore = createCanvasRecorder();
  const taskStore = createLibtvGenerationTaskStore();
  let releaseRun;
  const runGate = new Promise((resolve) => { releaseRun = resolve; });
  const libtv = {
    async ensureNamedWorkspace() { return { workspace: { id: 'workspace' } }; },
    async ensureDailyProject() { return { project: { uuid: 'project', name: 'today' } }; },
    async createImageNode() { return { payload: { id: 'remote-node' }, stdout: '' }; },
    async connectLeft() {},
    async runNode() {
      await runGate;
      return { payload: { url: 'https://example.test/libtv-node.png' }, stdout: '' };
    },
    async queryNode() { return { payload: {}, stdout: '' }; },
    async deleteNode() {},
  };
  const assetStore = {
    resolveAssetUrl() { return ''; },
    async saveAsset() { return { url: 'forart-asset://output/libtv-node.png', fileName: 'libtv-node.png' }; },
  };
  const runner = createLibtvGenerationRunner({ libtv, assetStore, canvasStore, taskStore });
  const task = runner.startImageTask({
    canvasId: 'canvas-libtv-node',
    nodeId: 'node-libtv',
    target: { type: 'imageGenerator', nodeId: 'node-libtv' },
    prompt: 'test prompt',
    modelName: 'Qwen Edit',
    aspectRatio: '3:4',
    nodeTitle: 'Node',
  });

  assert.equal(canvasStore.anchors.some((anchor) => anchor.nodeId === 'node-libtv' && anchor.taskId === task.id), true);

  releaseRun();
  await waitFor(() => taskStore.getTask(task.id)?.status === 'succeeded');
  assert.equal(canvasStore.terminals.some((terminal) => terminal.nodeId === 'node-libtv' && terminal.taskId === task.id), true);
});

test('stopping one queued LibTV row does not run it or block the following row', async () => {
  const canvasStore = createCanvasRecorder();
  const taskStore = createLibtvGenerationTaskStore();
  const runs = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const libtv = {
    async ensureNamedWorkspace() { return { workspace: { id: 'workspace' } }; },
    async ensureDailyProject() { return { project: { uuid: 'project', name: 'today' } }; },
    async createImageNode(_project, payload) { return { payload: { id: payload.title.match(/row-(\d)/)?.[0] || payload.prompt }, stdout: '' }; },
    async connectLeft() {},
    async runNode(_project, remoteNodeId) {
      runs.push(remoteNodeId);
      if (runs.length === 1) await firstGate;
      return { payload: { url: `https://example.test/${encodeURIComponent(remoteNodeId)}.png` }, stdout: '' };
    },
    async queryNode() { return { payload: {}, stdout: '' }; },
    async deleteNode() {},
  };
  const assetStore = {
    resolveAssetUrl() { return ''; },
    async saveAsset(payload) { return { url: `forart-asset://output/${encodeURIComponent(payload.url)}.png`, fileName: 'result.png' }; },
  };
  const runner = createLibtvGenerationRunner({ libtv, assetStore, canvasStore, taskStore });
  const tasks = runner.startImageTasks([1, 2, 3].map((row) => ({
    canvasId: 'canvas',
    nodeId: 'node',
    target: { type: 'actionFissionRow', nodeId: 'node', rowId: `row-${row}` },
    queueKey: 'canvas:node',
    prompt: `row-${row}`,
    modelName: 'Qwen Edit',
    aspectRatio: '3:4',
    nodeTitle: `row-${row}`,
  })));
  await waitFor(() => taskStore.getTask(tasks[0].id)?.status === 'running');
  const stopped = runner.stopImageTask(tasks[1].id);
  assert.equal(stopped.status, 'interrupted');
  releaseFirst();
  await waitFor(() => taskStore.getTask(tasks[2].id)?.status === 'succeeded');
  assert.equal(taskStore.getTask(tasks[1].id).status, 'interrupted');
  assert.equal(runs.length, 2);
  assert.equal(canvasStore.terminals.some((item) => item.rowId === 'row-2' && item.status === 'interrupted'), true);
  assert.equal(canvasStore.terminals.some((item) => item.rowId === 'row-3' && item.status === 'succeeded'), true);
});

test('LibTV accepts a run result without a redundant query and retries a transient required query', async () => {
  for (const scenario of ['run-result', 'query-retry']) {
    const canvasStore = createCanvasRecorder();
    const taskStore = createLibtvGenerationTaskStore();
    let queries = 0;
    const libtv = {
      async ensureNamedWorkspace() { return { workspace: { id: 'workspace' } }; },
      async ensureDailyProject() { return { project: { uuid: 'project', name: 'today' } }; },
      async createImageNode() { return { payload: { id: 'remote' }, stdout: '' }; },
      async connectLeft() {},
      async runNode() {
        return scenario === 'run-result'
          ? { payload: { url: 'https://example.test/result.png' }, stdout: '' }
          : { payload: {}, stdout: '' };
      },
      async queryNode() {
        queries += 1;
        if (scenario === 'run-result') throw new Error('query should not be called');
        if (queries === 1) throw new Error('temporary query outage');
        return { payload: { url: 'https://example.test/result.png' }, stdout: '' };
      },
      async deleteNode() {},
    };
    const assetStore = {
      resolveAssetUrl() { return ''; },
      async saveAsset() { return { url: 'forart-asset://output/result.png', fileName: 'result.png' }; },
    };
    const runner = createLibtvGenerationRunner({ libtv, assetStore, canvasStore, taskStore });
    const task = runner.startImageTask({
      canvasId: 'canvas',
      nodeId: 'node',
      target: { type: 'actionFissionRow', nodeId: 'node', rowId: `row-${scenario}` },
      prompt: 'prompt',
      modelName: 'Qwen Edit',
      aspectRatio: '3:4',
    });

    await waitFor(() => ['succeeded', 'failed'].includes(taskStore.getTask(task.id)?.status), 5000);
    assert.equal(taskStore.getTask(task.id)?.status, 'succeeded', taskStore.getTask(task.id)?.error);
    assert.equal(queries, scenario === 'run-result' ? 0 : 2);
  }
});

test('LibTV retry and stop transitions clear stale retry metadata', async () => {
  const canvasStore = createCanvasRecorder();
  const taskStore = createLibtvGenerationTaskStore();
  let attempts = 0;
  let releaseSecondRun;
  let markSecondStarted;
  const secondStarted = new Promise((resolve) => { markSecondStarted = resolve; });
  const secondRunGate = new Promise((resolve) => { releaseSecondRun = resolve; });
  const libtv = {
    async ensureNamedWorkspace() { return { workspace: { id: 'workspace' } }; },
    async ensureDailyProject() { return { project: { uuid: 'project', name: 'today' } }; },
    async createImageNode() { return { payload: { id: 'remote' }, stdout: '' }; },
    async connectLeft() {},
    async runNode() {
      attempts += 1;
      if (attempts === 1) throw new Error('API Request Error code 1200000171');
      markSecondStarted();
      await secondRunGate;
      return { payload: { url: 'https://example.test/result.png' }, stdout: '' };
    },
    async queryNode() { return { payload: {}, stdout: '' }; },
    async deleteNode() {},
  };
  const assetStore = {
    resolveAssetUrl() { return ''; },
    async saveAsset() { return { url: 'forart-asset://output/result.png', fileName: 'result.png' }; },
  };
  const runner = createLibtvGenerationRunner({ libtv, assetStore, canvasStore, taskStore });
  const task = runner.startImageTask({
    canvasId: 'canvas',
    nodeId: 'node',
    target: { type: 'actionFissionRow', nodeId: 'node', rowId: 'row' },
    prompt: 'prompt',
    modelName: 'Qwen Edit',
    aspectRatio: '3:4',
  });

  await secondStarted;
  assert.equal(taskStore.getTask(task.id)?.messageCode, 'libtv.generating');
  runner.stopImageTask(task.id);
  assert.equal(taskStore.getTask(task.id)?.status, 'interrupted');
  assert.equal(taskStore.getTask(task.id)?.messageCode, '');
  assert.equal(taskStore.getTask(task.id)?.messageParams, undefined);
  releaseSecondRun();
});

test('stopping LibTV workspace preparation releases the node pool without creating a remote node', async () => {
  const canvasStore = createCanvasRecorder();
  const taskStore = createLibtvGenerationTaskStore();
  let workspaceCalls = 0;
  let releaseFirstWorkspace;
  let markFirstWorkspaceStarted;
  const firstWorkspaceGate = new Promise((resolve) => { releaseFirstWorkspace = resolve; });
  const firstWorkspaceStarted = new Promise((resolve) => { markFirstWorkspaceStarted = resolve; });
  const createdPrompts = [];
  const libtv = {
    async ensureNamedWorkspace() {
      workspaceCalls += 1;
      if (workspaceCalls === 1) {
        markFirstWorkspaceStarted();
        await firstWorkspaceGate;
      }
      return { workspace: { id: 'workspace' } };
    },
    async ensureDailyProject() { return { project: { uuid: 'project', name: 'today' } }; },
    async createImageNode(_project, payload) {
      createdPrompts.push(payload.prompt);
      return { payload: { id: payload.prompt }, stdout: '' };
    },
    async connectLeft() {},
    async runNode(_project, id) { return { payload: { url: `https://example.test/${id}.png` }, stdout: '' }; },
    async queryNode() { return { payload: {}, stdout: '' }; },
    async deleteNode() {},
  };
  const assetStore = {
    resolveAssetUrl() { return ''; },
    async saveAsset() { return { url: 'forart-asset://output/result.png', fileName: 'result.png' }; },
  };
  const runner = createLibtvGenerationRunner({ libtv, assetStore, canvasStore, taskStore });
  const payload = (prompt) => ({
    canvasId: 'canvas',
    nodeId: 'node',
    target: { type: 'actionFissionRow', nodeId: 'node', rowId: prompt },
    queueKey: 'canvas:node',
    prompt,
    modelName: 'Qwen Edit',
    aspectRatio: '3:4',
  });
  const [first, second] = runner.startImageTasks([payload('first'), payload('second')]);

  await firstWorkspaceStarted;
  runner.stopImageTask(first.id);
  const secondStartedBeforeSharedPreparationFinished = await Promise.race([
    waitFor(() => workspaceCalls === 2).then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 100)),
  ]);
  releaseFirstWorkspace();
  await waitFor(() => taskStore.getTask(second.id)?.status === 'succeeded');
  assert.equal(secondStartedBeforeSharedPreparationFinished, true);
  assert.equal(taskStore.getTask(first.id)?.status, 'interrupted');
  assert.deepEqual(createdPrompts, ['second']);
});

test('LibTV cleans nodes created before a connection failure but preserves nodes after a run attempt', async () => {
  for (const stage of ['connect', 'run']) {
    const canvasStore = createCanvasRecorder();
    const taskStore = createLibtvGenerationTaskStore();
    const deleted = [];
    const libtv = {
      async ensureNamedWorkspace() { return { workspace: { id: 'workspace' } }; },
      async ensureDailyProject() { return { project: { uuid: 'project', name: 'today' } }; },
      async uploadImageNode() { return { payload: { id: 'reference' }, stdout: '' }; },
      async createImageNode() { return { payload: { id: 'generated' }, stdout: '' }; },
      async connectLeft() {
        if (stage === 'connect') throw new Error('connect failed');
      },
      async runNode() { throw new Error('run failed'); },
      async queryNode() { return { payload: {}, stdout: '' }; },
      async deleteNode(_project, id) { deleted.push(id); },
    };
    const assetStore = {
      resolveAssetUrl() { return 'C:/fixtures/reference.png'; },
      async saveAsset() { return { url: 'forart-asset://output/result.png', fileName: 'result.png' }; },
    };
    const runner = createLibtvGenerationRunner({ libtv, assetStore, canvasStore, taskStore });
    const task = runner.startImageTask({
      canvasId: 'canvas',
      nodeId: 'node',
      target: { type: 'actionFissionRow', nodeId: 'node', rowId: `row-${stage}` },
      prompt: 'prompt',
      modelName: 'Qwen Edit',
      aspectRatio: '3:4',
      referenceImages: ['forart-asset://canvas/input/reference.png'],
    });

    await waitFor(() => taskStore.getTask(task.id)?.status === 'failed');
    assert.deepEqual(deleted, stage === 'connect' ? ['generated', 'reference'] : []);
  }
});

test('LibTV retries local result materialization without starting another remote generation', async () => {
  const canvasStore = createCanvasRecorder();
  const taskStore = createLibtvGenerationTaskStore();
  let runCalls = 0;
  let saveCalls = 0;
  const libtv = {
    async ensureNamedWorkspace() { return { workspace: { id: 'workspace' } }; },
    async ensureDailyProject() { return { project: { uuid: 'project', name: 'today' } }; },
    async createImageNode() { return { payload: { id: 'generated' }, stdout: '' }; },
    async connectLeft() {},
    async runNode() {
      runCalls += 1;
      return { payload: { url: 'https://example.test/result.png' }, stdout: '' };
    },
    async queryNode() { return { payload: {}, stdout: '' }; },
    async deleteNode() {},
  };
  const assetStore = {
    resolveAssetUrl() { return ''; },
    async saveAsset() {
      saveCalls += 1;
      if (saveCalls === 1) throw new Error('temporary local processing failure');
      return { url: 'forart-asset://output/result.png', fileName: 'result.png' };
    },
  };
  const runner = createLibtvGenerationRunner({ libtv, assetStore, canvasStore, taskStore });
  const task = runner.startImageTask({
    canvasId: 'canvas',
    nodeId: 'node',
    target: { type: 'actionFissionRow', nodeId: 'node', rowId: 'row' },
    prompt: 'prompt',
    modelName: 'Qwen Edit',
    aspectRatio: '3:4',
  });

  await waitFor(() => ['succeeded', 'failed'].includes(taskStore.getTask(task.id)?.status), 5000);
  assert.equal(taskStore.getTask(task.id)?.status, 'succeeded', taskStore.getTask(task.id)?.error);
  assert.equal(runCalls, 1);
  assert.equal(saveCalls, 2);
});
