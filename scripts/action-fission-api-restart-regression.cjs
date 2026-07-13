const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { createAssetStore } = require('../electron/main/modules/asset-store.cjs');
const { createCanvasStore } = require('../electron/main/modules/canvas-store.cjs');
const { createGenerationTaskStore } = require('../electron/main/modules/generation-task-store.cjs');
const { createImageGenerationRunner } = require('../electron/main/modules/image-generation-runner.cjs');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function run() {
  const campaignId = process.argv.find((value) => value.startsWith('--campaign='))?.split('=')[1] || '20260712';
  const sourceRoot = path.resolve('test-results', 'action-fission-regression', campaignId, 'api', 'G01');
  const resultRoot = path.resolve('test-results', 'action-fission-regression', campaignId, 'api', 'G04-restart-recovery');
  const dataRoot = path.join(resultRoot, 'runtime');
  const sourceManifest = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'manifest.json'), 'utf8'));
  fs.rmSync(resultRoot, { recursive: true, force: true });
  fs.mkdirSync(resultRoot, { recursive: true });
  fs.cpSync(path.join(sourceRoot, 'runtime'), dataRoot, { recursive: true });

  const config = JSON.parse(fs.readFileSync(path.resolve('forart-config.json'), 'utf8'));
  const provider = (config.apiSettings?.providers || []).find((item) => item.id === 'apimart');
  if (!provider?.apiKey || !provider.baseUrl) throw new Error('APImart is not configured.');

  const requests = [];
  const net = {
    fetch(url, init = {}) {
      requests.push({ url: String(url).replace(/([?&](?:key|api_key)=)[^&]+/gi, '$1[redacted]'), method: init.method || 'GET' });
      return fetch(url, init);
    },
  };
  const assetStore = createAssetStore({ rootDir: dataRoot, net });
  const canvasStore = createCanvasStore({ rootDir: dataRoot });
  const canvasId = sourceManifest.canvasId;
  const nodeId = sourceManifest.nodeId;
  const canvas = canvasStore.readCanvas(canvasId);
  const tasksByRow = new Map(canvas.nodes.find((node) => node.id === nodeId).data.actionFission.rows.map((row, index) => [
    row.id,
    sourceManifest.tasks[index],
  ]));
  canvasStore.saveCanvas(canvasId, {
    ...canvas,
    nodes: canvas.nodes.map((node) => {
      if (node.id !== nodeId) return node;
      return {
        ...node,
        data: {
          ...node.data,
          actionFission: {
            ...node.data.actionFission,
            rows: node.data.actionFission.rows.map((row) => {
              const task = tasksByRow.get(row.id);
              const next = {
                ...row,
                generationTaskId: task.id,
                generationRemoteTaskId: task.remoteTaskId,
              };
              delete next.resultUrl;
              delete next.resultFileName;
              delete next.resultDownloadState;
              delete next.error;
              return next;
            }),
          },
        },
      };
    }),
  });

  const generationTaskStore = createGenerationTaskStore();
  const runner = createImageGenerationRunner({ net, assetStore, canvasStore, generationTaskStore });
  const recovery = await runner.recoverCanvasTasks({ providers: [provider] });
  if (recovery.errors.length) throw new Error(`Recovery setup failed: ${JSON.stringify(recovery.errors)}`);
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10 * 60_000) {
    if (recovery.tasks.every((task) => ['succeeded', 'failed', 'interrupted'].includes(generationTaskStore.getTask(task.id)?.status))) break;
    await sleep(1000);
  }

  const finalTasks = recovery.tasks.map((task) => generationTaskStore.getTask(task.id));
  const recoveredCanvas = canvasStore.readCanvas(canvasId);
  const rows = recoveredCanvas.nodes.find((node) => node.id === nodeId).data.actionFission.rows;
  const results = rows.map((row, index) => {
    const localPath = assetStore.resolveAssetUrl(row.resultUrl || '');
    return {
      rowId: row.id,
      localTaskId: sourceManifest.tasks[index].id,
      remoteTaskId: sourceManifest.tasks[index].remoteTaskId,
      status: row.resultUrl ? 'succeeded' : row.error ? 'failed' : 'missing',
      sha256: localPath && fs.existsSync(localPath) ? sha256(localPath) : '',
      originalSha256: sourceManifest.results[index].sha256,
    };
  });
  const manifest = {
    campaignId,
    scenarioId: 'G04-restart-recovery',
    backend: 'api',
    canvasId,
    nodeId,
    requests: requests.map((request) => request.method),
    tasks: finalTasks.map((task) => ({ id: task.id, remoteTaskId: task.upstreamTaskId, status: task.status, error: task.error || '' })),
    results,
    passed: finalTasks.every((task) => task.status === 'succeeded')
      && requests.every((request) => request.method === 'GET')
      && results.every((result) => result.status === 'succeeded' && result.sha256 === result.originalSha256),
  };
  fs.writeFileSync(path.join(resultRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  if (!manifest.passed) process.exitCode = 1;
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
