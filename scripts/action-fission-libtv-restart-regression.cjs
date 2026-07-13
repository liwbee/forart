const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { createAssetStore } = require('../electron/main/modules/asset-store.cjs');
const { createCanvasStore } = require('../electron/main/modules/canvas-store.cjs');
const { createLibtvAdapter } = require('../electron/main/modules/libtv-adapter.cjs');
const { createLibtvGenerationRunner } = require('../electron/main/modules/libtv-generation-runner.cjs');
const { createLibtvGenerationTaskStore } = require('../electron/main/modules/libtv-generation-task-store.cjs');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function run() {
  const campaignId = process.argv.find((value) => value.startsWith('--campaign='))?.split('=')[1] || '20260712';
  const sourceRoot = path.resolve('test-results', 'action-fission-regression', campaignId, 'libtv', 'G01');
  const resultRoot = path.resolve('test-results', 'action-fission-regression', campaignId, 'libtv', 'G04-restart-recovery');
  const dataRoot = path.join(resultRoot, 'runtime');
  const sourceManifest = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'manifest.json'), 'utf8'));
  fs.rmSync(resultRoot, { recursive: true, force: true });
  fs.mkdirSync(resultRoot, { recursive: true });
  fs.cpSync(path.join(sourceRoot, 'runtime'), dataRoot, { recursive: true });

  const net = { fetch: (...args) => fetch(...args) };
  const assetStore = createAssetStore({ rootDir: dataRoot, net });
  const canvasStore = createCanvasStore({ rootDir: dataRoot });
  const libtv = createLibtvAdapter({ rootDir: path.resolve('.') });
  const taskStore = createLibtvGenerationTaskStore();
  const runner = createLibtvGenerationRunner({ libtv, assetStore, canvasStore, taskStore });
  const workspace = await libtv.ensureNamedWorkspace({ name: 'LibtvImage' });
  const project = await runner.ensureReadyProject({ workspaceId: workspace.workspace.id });

  const canvasId = sourceManifest.canvasId;
  const nodeId = sourceManifest.nodeId;
  const canvas = canvasStore.readCanvas(canvasId);
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
            rows: node.data.actionFission.rows.map((row, index) => {
              const next = {
                ...row,
                libtvTaskId: sourceManifest.tasks[index].id,
                libtvProjectUuid: project.projectUuid,
                libtvRemoteNodeId: sourceManifest.tasks[index].remoteNodeId,
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

  const recovery = runner.recoverCanvasTasks();
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10 * 60_000) {
    if (recovery.tasks.every((task) => ['succeeded', 'failed', 'interrupted'].includes(taskStore.getTask(task.id)?.status))) break;
    await sleep(500);
  }
  const finalTasks = recovery.tasks.map((task) => taskStore.getTask(task.id));
  const recoveredCanvas = canvasStore.readCanvas(canvasId);
  const rows = recoveredCanvas.nodes.find((node) => node.id === nodeId).data.actionFission.rows;
  const results = rows.map((row, index) => {
    const localPath = assetStore.resolveAssetUrl(row.resultUrl || '');
    return {
      rowId: row.id,
      localTaskId: sourceManifest.tasks[index].id,
      remoteNodeId: sourceManifest.tasks[index].remoteNodeId,
      status: row.resultUrl ? 'succeeded' : row.error ? 'failed' : 'missing',
      sha256: localPath && fs.existsSync(localPath) ? sha256(localPath) : '',
      originalSha256: sourceManifest.results[index].sha256,
    };
  });
  const manifest = {
    campaignId,
    scenarioId: 'G04-restart-recovery',
    backend: 'libtv',
    canvasId,
    nodeId,
    projectUuid: project.projectUuid,
    tasks: finalTasks.map((task) => ({ id: task.id, remoteNodeId: task.remoteNodeId, status: task.status, error: task.error || '' })),
    results,
    passed: finalTasks.every((task) => task.status === 'succeeded')
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
