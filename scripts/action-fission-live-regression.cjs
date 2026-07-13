const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { createAssetStore } = require('../electron/main/modules/asset-store.cjs');
const { createCanvasStore } = require('../electron/main/modules/canvas-store.cjs');
const { createGenerationTaskStore } = require('../electron/main/modules/generation-task-store.cjs');
const { createImageGenerationRunner } = require('../electron/main/modules/image-generation-runner.cjs');
const { createLibtvAdapter } = require('../electron/main/modules/libtv-adapter.cjs');
const { createLibtvGenerationRunner } = require('../electron/main/modules/libtv-generation-runner.cjs');
const { createLibtvGenerationTaskStore } = require('../electron/main/modules/libtv-generation-task-store.cjs');

function argument(name, fallback = '') {
  const prefix = `--${name}=`;
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function terminal(status) {
  return ['succeeded', 'failed', 'interrupted', 'superseded'].includes(String(status || ''));
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function ensureReference(dataRoot, sourcePath, name) {
  const targetRoot = path.join(dataRoot, 'CanvasAssests', 'input');
  fs.mkdirSync(targetRoot, { recursive: true });
  const target = path.join(targetRoot, name);
  fs.copyFileSync(sourcePath, target);
  return `forart-asset://canvas/input/${encodeURIComponent(name)}`;
}

function makeRows() {
  return [
    { id: 'row-front', name: 'Front standing', prompt: 'Keep the same person and clothing. Change only the pose to a full-body front-facing relaxed standing pose.' },
    { id: 'row-walk', name: 'Side walking', prompt: 'Keep the same person and clothing. Change only the pose to a full-body side-view walking pose.' },
    { id: 'row-sit', name: 'Seated pose', prompt: 'Keep the same person and clothing. Change only the pose to a clearly seated full-body pose.' },
  ];
}

function createTestCanvas(canvasStore, backend, campaignId, referenceUrl, suffix = 'A') {
  const project = canvasStore.createProject({ title: `AF regression ${campaignId}` }).project;
  const nodeId = `action-${backend}-${campaignId}-${suffix}`;
  const rows = makeRows();
  const canvas = canvasStore.createCanvas({
    title: `AF-REG-${backend.toUpperCase()}-${campaignId}-${suffix}`,
    projectId: project.id,
    nodes: [
      {
        id: 'reference-node',
        type: 'canvasNode',
        position: { x: 0, y: 0 },
        data: { kind: 'imageLoader', label: 'Regression reference', imageUrl: referenceUrl },
      },
      {
        id: nodeId,
        type: 'canvasNode',
        position: { x: 500, y: 0 },
        data: {
          kind: 'actionFission',
          label: `Regression ${backend}`,
          imageGenerationBackend: backend === 'libtv' ? 'libtv' : 'api',
          imageProviderId: backend === 'api' ? 'apimart' : undefined,
          imageModel: backend === 'api' ? 'gpt-image-2' : undefined,
          libtvImageGeneration: backend === 'libtv'
            ? { modelName: 'Qwen Edit', quality: 'auto', aspectRatio: '3:4', count: 1 }
            : undefined,
          actionFission: {
            layout: 'list',
            aspectRatio: '3:4',
            rows: rows.map((row) => ({
              id: row.id,
              actionProjectId: 'regression',
              includeActionTagIds: [],
              excludeActionTagIds: [],
              selectedActionId: row.id,
              selectedActionName: row.name,
              selectedActionPrompt: row.prompt,
            })),
          },
        },
      },
    ],
    connections: [{
      id: 'reference-edge',
      source: 'reference-node',
      target: nodeId,
      sourceHandle: 'output',
      targetHandle: 'input',
      data: { inputKind: 'referenceImage', referenceOrder: 1 },
    }],
    viewport: { x: 0, y: 0, scale: 1 },
  }).canvas;
  return { canvas, nodeId, rows };
}

async function pollTasks(tasks, getTask, events, timeoutMs) {
  const lastStatuses = new Map();
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const current = tasks.map((task) => getTask(task.id)).filter(Boolean);
    current.forEach((task) => {
      if (lastStatuses.get(task.id) === task.status) return;
      lastStatuses.set(task.id, task.status);
      events.push({ timestamp: new Date().toISOString(), taskId: task.id, status: task.status, message: task.message || '', error: task.error || '' });
      process.stdout.write(`[${task.id}] ${task.status}${task.message ? ` - ${task.message}` : ''}\n`);
    });
    if (current.length === tasks.length && current.every((task) => terminal(task.status))) return current;
    await sleep(1000);
  }
  throw new Error(`Timed out after ${timeoutMs}ms.`);
}

async function run() {
  const backend = argument('backend');
  if (!['libtv', 'api'].includes(backend)) throw new Error('Use --backend=libtv or --backend=api.');
  const campaignId = argument('campaign', `${Date.now()}`);
  const scenarioId = argument('scenario', 'G01');
  const resultRoot = path.resolve(argument('result-root', path.join('test-results', 'action-fission-regression', campaignId, backend, scenarioId)));
  const dataRoot = path.join(resultRoot, 'runtime');
  fs.mkdirSync(resultRoot, { recursive: true });
  fs.rmSync(dataRoot, { recursive: true, force: true });
  fs.mkdirSync(dataRoot, { recursive: true });

  const canvasCount = Math.max(1, Math.min(2, Number(argument('canvas-count', '1')) || 1));
  const referenceSources = [
    path.resolve(argument('reference', path.join('CanvasAssests', 'input', 'image_001.png'))),
    path.resolve(argument('reference-b', path.join('CanvasAssests', 'input', '158.png'))),
  ];
  referenceSources.slice(0, canvasCount).forEach((source) => {
    if (!fs.existsSync(source)) throw new Error(`Reference image not found: ${source}`);
  });
  const net = { fetch: (...args) => fetch(...args) };
  const assetStore = createAssetStore({ rootDir: dataRoot, net });
  const canvasStore = createCanvasStore({ rootDir: dataRoot });
  const contexts = Array.from({ length: canvasCount }, (_, index) => {
    const suffix = String.fromCharCode(65 + index);
    const referenceUrl = ensureReference(dataRoot, referenceSources[index], `reference-${suffix.toLowerCase()}.png`);
    return {
      ...createTestCanvas(canvasStore, backend, campaignId, referenceUrl, suffix),
      referenceSha256: sha256(referenceSources[index]),
    };
  });
  const events = [];
  let tasks;
  let getTask;

  if (backend === 'api') {
    const config = JSON.parse(fs.readFileSync(path.resolve('forart-config.json'), 'utf8'));
    const provider = (config.apiSettings?.providers || []).find((item) => item.id === 'apimart');
    if (!provider?.apiKey || !provider.baseUrl) throw new Error('APImart is not configured.');
    const taskStore = createGenerationTaskStore();
    const runner = createImageGenerationRunner({ net, assetStore, canvasStore, generationTaskStore: taskStore });
    tasks = await Promise.all(contexts.flatMap(({ canvas, nodeId, rows }) => rows.map((row) => runner.startTask({
      canvasId: canvas.id,
      nodeId,
      target: { type: 'actionFissionRow', nodeId, rowId: row.id },
      kind: 'image',
      providerId: 'apimart',
      provider,
      model: 'gpt-image-2',
      modelRule: {
        requestFormat: 'standard',
        sizeMode: 'ratio',
        resolutionCase: 'lower',
        sizeRule: { resolutionField: 'resolution' },
      },
      prompt: row.prompt,
      referenceImages: [canvas.nodes.find((node) => node.id === 'reference-node').data.imageUrl],
      resolution: '1k',
      aspectRatio: '3:4',
      status: 'submitting',
    }))));
    getTask = (taskId) => taskStore.getTask(taskId);
  } else {
    const libtv = createLibtvAdapter({ rootDir: path.resolve('.') });
    const taskStore = createLibtvGenerationTaskStore();
    const runner = createLibtvGenerationRunner({ libtv, assetStore, canvasStore, taskStore });
    tasks = runner.startImageTasks(contexts.flatMap(({ canvas, nodeId, rows }) => rows.map((row) => ({
      canvasId: canvas.id,
      nodeId,
      target: { type: 'actionFissionRow', nodeId, rowId: row.id },
      queueKey: `${canvas.id}:${nodeId}`,
      workspaceName: 'LibtvImage',
      prompt: row.prompt,
      modelName: 'Qwen Edit',
      count: 1,
      quality: 'auto',
      resolution: '',
      aspectRatio: '3:4',
      referenceImages: [canvas.nodes.find((node) => node.id === 'reference-node').data.imageUrl],
      nodeTitle: `AF regression ${row.name}`,
      x: 500,
      y: rows.indexOf(row) * 420,
    }))));
    getTask = (taskId) => taskStore.getTask(taskId);
  }

  const finalTasks = await pollTasks(tasks, getTask, events, backend === 'libtv' ? 30 * 60_000 : 20 * 60_000);
  const results = contexts.flatMap(({ canvas, nodeId, referenceSha256 }) => {
    const storedCanvas = canvasStore.readCanvas(canvas.id);
    const storedRows = storedCanvas.nodes.find((node) => node.id === nodeId)?.data?.actionFission?.rows || [];
    return storedRows.map((row) => {
      const localPath = assetStore.resolveAssetUrl(row.resultUrl || '');
      const resultSha256 = localPath && fs.existsSync(localPath) ? sha256(localPath) : '';
      return {
        canvasId: canvas.id,
        nodeId,
        rowId: row.id,
        status: row.error ? 'failed' : row.resultUrl ? 'succeeded' : 'missing',
        error: row.error || '',
        resultUrl: row.resultUrl || '',
        fileName: row.resultFileName || '',
        sha256: resultSha256,
        referenceSha256,
        isReferenceCopy: Boolean(resultSha256 && resultSha256 === referenceSha256),
        sizeBytes: localPath && fs.existsSync(localPath) ? fs.statSync(localPath).size : 0,
      };
    });
  });
  const manifest = {
    campaignId,
    scenarioId,
    backend,
    model: backend === 'libtv' ? 'Qwen Edit' : 'gpt-image-2',
    modelKey: backend === 'libtv' ? 'qwen-edit' : 'gpt-image-2',
    resolution: backend === 'libtv' ? 'auto' : '1k',
    aspectRatio: '3:4',
    canvases: contexts.map(({ canvas, nodeId }) => ({ canvasId: canvas.id, nodeId })),
    taskCount: tasks.length,
    tasks: finalTasks.map((task) => ({ id: task.id, status: task.status, error: task.error || '', remoteTaskId: task.upstreamTaskId || '', remoteNodeId: task.remoteNodeId || '' })),
    results,
    passed: finalTasks.every((task) => task.status === 'succeeded')
      && results.every((result) => result.status === 'succeeded' && !result.isReferenceCopy),
  };
  fs.writeFileSync(path.join(resultRoot, 'events.jsonl'), `${events.map((event) => JSON.stringify(event)).join('\n')}\n`, 'utf8');
  fs.writeFileSync(path.join(resultRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  if (!manifest.passed) process.exitCode = 1;
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
