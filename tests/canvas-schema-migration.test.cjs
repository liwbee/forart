const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  CURRENT_CANVAS_SCHEMA_VERSION,
  upgradeCanvasDocument,
} = require('../electron/main/modules/canvas-schema.cjs');
const { createCanvasStore } = require('../electron/main/modules/canvas-store.cjs');

function github0134Canvas() {
  return {
    id: 'canvas-release-0134',
    title: 'Release canvas',
    icon: 'layers',
    projectId: 'project-1',
    color: '#334455',
    pinned: true,
    createdAt: 100,
    updatedAt: 200,
    revision: 7,
    nodes: [{
      id: 'generator-1',
      type: 'canvasNode',
      position: { x: 10, y: 20 },
      selected: true,
      dragging: true,
      width: 300,
      height: 400,
      measured: { width: 300, height: 400 },
      zIndex: 8,
      style: { width: 280, height: 280 },
      data: {
        kind: 'imageGenerator',
        label: 'result.png',
        imageGenerationBackend: 'libtv',
        imageProviderId: 'provider-1',
        imageModel: 'model-1',
        imageResolution: '1k',
        imageAspectRatio: '3:4',
        imageQuality: 'high',
        imageCount: 2,
        generatedImages: [{
          url: 'https://example.com/result.png',
          localUrl: 'forart-asset://canvas/output/result.png',
          thumbUrl: 'forart-asset://canvas/thumb/result.webp',
          fileName: 'result.png',
          width: 768,
          height: 1024,
          downloadState: 'downloaded',
          downloadedAt: 150,
        }],
        generationTaskId: 'legacy-api-task',
        generationRemoteTaskId: 'legacy-remote-task',
        generationTask: { id: 'legacy-api-task', status: 'running' },
        generationError: 'ignored API error',
        libtvImageGeneration: {
          modelName: 'Qwen Edit',
          resolution: '1k',
          aspectRatio: '3:4',
          quality: 'high',
          count: 1,
          taskId: 'legacy-libtv-task',
          projectUuid: 'legacy-project',
          remoteNodeId: 'legacy-node',
          task: { id: 'legacy-libtv-task', status: 'running' },
          error: 'ignored LibTV error',
        },
      },
    }, {
      id: 'action-1',
      type: 'canvasNode',
      position: { x: 30, y: 40 },
      data: {
        kind: 'actionFission',
        label: 'Actions',
        actionFission: {
          status: 'running',
          error: 'ignored node error',
          libtvProjectUuid: 'legacy-project',
          rows: [{
            id: 'row-1',
            actionProjectId: 'project-1',
            includeActionTagIds: ['tag-1', 'tag-1'],
            excludeActionTagIds: ['tag-2'],
            selectedActionId: 'action-entry-1',
            selectedActionName: 'Walk',
            selectedActionPrompt: 'walking',
            selectedActionAssetUrl: 'forart-asset://library/action.png',
            selectedActionThumbUrl: 'forart-asset://library/action-thumb.webp',
            resultUrl: 'forart-asset://canvas/output/action.png',
            resultThumbUrl: 'forart-asset://canvas/thumb/action.webp',
            resultFileName: 'action.png',
            resultWidth: 768,
            resultHeight: 1024,
            resultDownloadState: 'downloaded',
            resultDownloadedAt: 180,
            generationTaskId: 'legacy-row-api-task',
            generationRemoteTaskId: 'legacy-row-remote-task',
            generationTask: { id: 'legacy-row-api-task', status: 'running' },
            libtvTaskId: 'legacy-row-libtv-task',
            libtvProjectUuid: 'legacy-row-project',
            libtvRemoteNodeId: 'legacy-row-node',
            libtvTask: { id: 'legacy-row-libtv-task', status: 'running' },
            libtvQueued: true,
            error: 'stale error',
          }, {
            id: 'row-2',
            categoryGroups: [{
              id: 'group-2',
              name: ' Group 2 ',
              actionProjectId: 'project-2',
              includeActionTagIds: ['tag-3'],
              excludeActionTagIds: [],
              fixedActionId: 'temporary-action',
            }],
            selectedCategoryGroupId: 'missing-group',
          }],
        },
      },
    }],
    connections: [{
      id: 'edge-1',
      type: 'default',
      source: 'generator-1',
      target: 'action-1',
      sourceHandle: 'output',
      targetHandle: 'input',
      data: { inputKind: 'referenceImage', referenceOrder: 1 },
      selected: true,
    }],
    viewport: { x: 4, y: 5, scale: 1.25 },
  };
}

test('GitHub 0.1.34 canvas upgrades to the canonical v2 document', () => {
  const result = upgradeCanvasDocument(github0134Canvas());
  assert.equal(result.migrated, true);
  assert.equal(result.fromVersion, 1);
  assert.equal(result.canvas.canvasSchemaVersion, CURRENT_CANVAS_SCHEMA_VERSION);
  assert.deepEqual(result.canvas.viewport, { x: 4, y: 5, scale: 1.25 });
  assert.equal(result.canvas.connections[0].source, 'generator-1');
  assert.equal(result.canvas.connections[0].target, 'action-1');
  assert.deepEqual(result.canvas.connections[0].data, { inputKind: 'referenceImage', referenceOrder: 1 });
  assert.equal('selected' in result.canvas.connections[0], false);

  const generator = result.canvas.nodes[0];
  assert.deepEqual(generator.style, { width: 300, height: 400 });
  assert.equal(generator.zIndex, 8);
  assert.equal('selected' in generator, false);
  assert.equal('dragging' in generator, false);
  assert.equal('measured' in generator, false);
  assert.equal('width' in generator, false);
  assert.deepEqual(generator.data.generatedImages, [{
    url: 'https://example.com/result.png',
    localUrl: 'forart-asset://canvas/output/result.png',
    thumbUrl: 'forart-asset://canvas/thumb/result.webp',
    fileName: 'result.png',
    width: 768,
    height: 1024,
    downloadState: 'downloaded',
    downloadedAt: 150,
  }]);
  assert.deepEqual(generator.data.libtvImageGeneration, {
    aspectRatio: '3:4',
    count: 1,
    modelName: 'Qwen Edit',
    quality: 'high',
    resolution: '1k',
  });
  assert.equal(generator.data.imageProviderId, 'provider-1');
  assert.equal(generator.data.imageModel, 'model-1');
  assert.equal('latestGenerationTaskId' in generator.data, false);
  assert.equal('generationTaskId' in generator.data, false);
  assert.equal('generationRemoteTaskId' in generator.data, false);
  assert.equal('generationTask' in generator.data, false);
  assert.equal('generationError' in generator.data, false);

  const rows = result.canvas.nodes[1].data.actionFission.rows;
  assert.deepEqual(rows[0].categoryGroups, [{
    id: 'row-1_group_1',
    actionProjectId: 'project-1',
    includeActionTagIds: ['tag-1'],
    excludeActionTagIds: ['tag-2'],
  }]);
  assert.equal(rows[0].selectedCategoryGroupId, 'row-1_group_1');
  assert.equal(rows[0].selectedActionId, 'action-entry-1');
  assert.equal(rows[0].resultUrl, 'forart-asset://canvas/output/action.png');
  assert.equal(rows[0].resultThumbUrl, 'forart-asset://canvas/thumb/action.webp');
  assert.equal(rows[0].resultDownloadState, 'downloaded');
  assert.equal('actionProjectId' in rows[0], false);
  assert.equal('generationTaskId' in rows[0], false);
  assert.equal('generationRemoteTaskId' in rows[0], false);
  assert.equal('generationTask' in rows[0], false);
  assert.equal('libtvTaskId' in rows[0], false);
  assert.equal('libtvProjectUuid' in rows[0], false);
  assert.equal('libtvRemoteNodeId' in rows[0], false);
  assert.equal('libtvTask' in rows[0], false);
  assert.equal('libtvQueued' in rows[0], false);
  assert.equal('error' in rows[0], false);
  assert.equal(rows[1].categoryGroups[0].name, 'Group 2');
  assert.equal('fixedActionId' in rows[1].categoryGroups[0], false);
  assert.equal(rows[1].selectedCategoryGroupId, 'group-2');
  assert.equal('status' in result.canvas.nodes[1].data.actionFission, false);
});

test('canvas schema v2 reads idempotently and rejects future schemas', () => {
  const v2 = upgradeCanvasDocument(github0134Canvas()).canvas;
  v2.connections.push({
    id: 'edge-additional-prompt',
    type: 'default',
    source: 'prompt-1',
    target: 'action-1',
    sourceHandle: 'output',
    targetHandle: 'additional-reference',
    data: { inputKind: 'additionalReferencePrompt' },
  });
  const current = upgradeCanvasDocument(v2);
  assert.equal(current.migrated, false);
  assert.deepEqual(current.canvas, v2);
  assert.deepEqual(current.canvas.connections[1].data, { inputKind: 'additionalReferencePrompt' });
  assert.throws(
    () => upgradeCanvasDocument({ ...v2, canvasSchemaVersion: 3 }),
    /unsupported canvas schema version/i,
  );
});

test('canvas store startup atomically rewrites local canvases to schema v2', (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-canvas-schema-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const directory = path.join(rootDir, 'CanvasAssests', 'json');
  const filePath = path.join(directory, 'canvas-release-0134.json');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(github0134Canvas(), null, 2)}\n`, 'utf8');

  const store = createCanvasStore({ rootDir });
  const stored = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(stored.canvasSchemaVersion, CURRENT_CANVAS_SCHEMA_VERSION);
  assert.equal(stored.revision, 7);
  assert.equal(stored.nodes[1].data.actionFission.rows[0].categoryGroups.length, 1);
  assert.equal(store.readCanvas('canvas-release-0134').canvasSchemaVersion, CURRENT_CANVAS_SCHEMA_VERSION);
  assert.equal(store.migrateStoredCanvasDocuments(), 0);

  const created = store.createCanvas({ title: 'New canvas' }).canvas;
  assert.equal(created.canvasSchemaVersion, CURRENT_CANVAS_SCHEMA_VERSION);
});
