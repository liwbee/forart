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
    completeActionFissionRow(payload) {
      terminals.push(payload);
    },
    completeGenerationNode() {},
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

test('API action rows finish and reconcile stale renderer snapshots without renderer polling', async () => {
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

  const stalePayload = {
    nodes: [{
      id: 'node-api',
      data: {
        actionFission: {
          rows: [{ id: 'row-2', selectedActionName: 'Walk', generationTaskId: task.id }],
        },
      },
    }],
  };
  const reconciled = runner.reconcileCanvasPayload('canvas-api', stalePayload);
  const row = reconciled.nodes[0].data.actionFission.rows[0];
  assert.equal(row.resultUrl, 'forart-asset://output/api-result.png');
  assert.equal(row.resultDownloadState, 'pending');
  assert.equal(row.generationTaskId, undefined);
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
  const tasks = await Promise.all([1, 2, 3].map((row) => runner.startTask({
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
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('LibTV queues rows per node, runs different nodes concurrently, and writes terminal rows without renderer polling', async () => {
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
  const workspaceNames = [];
  const libtv = {
    async ensureNamedWorkspace({ name }) { workspaceNames.push(name); return { workspace: { id: 'workspace' } }; },
    async ensureDailyProject() { return { project: { uuid: 'project', name: 'today' } }; },
    async waitForProjectReady(input) { return { project: { uuid: input.projectUuid, name: input.projectName } }; },
    async createImageNode(_project, payload) {
      const id = `remote-${++remoteIndex}`;
      queueByRemoteNode.set(id, payload.title.includes('Node A') ? 'node-a' : 'node-b');
      return { payload: { id }, stdout: '' };
    },
    async connectLeft() {},
    async runNode(_project, remoteNodeId) {
      runAttempts += 1;
      if (remoteNodeId === 'remote-3' && transientStartFailures > 0) {
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
  assert.equal(maxByQueue.get('node-a'), 1);
  assert.equal(maxByQueue.get('node-b'), 1);
  assert.equal(maxGlobalActive, 2);
  assert.equal(runAttempts, 7);
  assert.deepEqual(new Set(workspaceNames), new Set(['LibtvImage-PC01']));
  assert.equal(canvasStore.terminals.filter((item) => item.backend === 'libtv' && item.status === 'succeeded').length, 6);
  assert.equal(new Set(canvasStore.terminals.map((item) => `${item.canvasId}:${item.nodeId}:${item.rowId}`)).size, 6);
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
