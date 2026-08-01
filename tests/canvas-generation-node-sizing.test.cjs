const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createCanvasStore } = require('../electron/main/modules/canvas-store.cjs');

test('unmounted canvas result commit persists the generated image ratio around the node center', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-generator-size-'));
  try {
    const store = createCanvasStore({ rootDir });
    const canvas = store.createCanvas({
      nodes: [{
        id: 'generator',
        type: 'canvasNode',
        position: { x: 100, y: 200 },
        style: { width: 280, height: 280 },
        data: { kind: 'imageGenerator', latestGenerationTaskId: 'task-1' },
      }],
    }).canvas;

    const committed = store.completeGenerationNode({
      canvasId: canvas.id,
      nodeId: 'generator',
      taskId: 'task-1',
      status: 'succeeded',
      result: {
        localUrl: 'forart-asset://canvas/output/result.png',
        fileName: 'result.png',
        width: 900,
        height: 1200,
      },
    });

    assert.equal(committed.applied, true);
    const node = store.readCanvas(canvas.id).nodes[0];
    assert.deepEqual(node.style, { width: 240, height: 320 });
    assert.deepEqual(node.position, { x: 120, y: 180 });
    assert.equal(node.data.imageNaturalWidth, 900);
    assert.equal(node.data.imageNaturalHeight, 1200);
    assert.equal(node.data.generatedImages[0].width, 900);
    assert.equal(node.data.generatedImages[0].height, 1200);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
