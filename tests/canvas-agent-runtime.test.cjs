const test = require('node:test');
const assert = require('node:assert/strict');
const { createCanvasAgentRuntime, promptDocumentFromReferenceText } = require('../electron/main/modules/canvas-agent/canvas-agent-runtime.cjs');

test('Agent runtime stays in memory and commits results directly to the original canvas', async () => {
  const nodes = new Map([
    ['reverse-a', { kind: 'smartReverse', text: '' }],
    ['generator-a', { kind: 'imageGenerator', text: '原始提示词' }],
  ]);
  const commits = [];
  const results = {
    'smart-reverse': { outputs: [{ detailedPrompt: '后台反推结果' }] },
    'optimize-image-generator-prompt': { optimizedPrompt: '人物佩戴 @图一\n暖色逆光' },
  };
  const runtime = createCanvasAgentRuntime({
    canvasAgent: { run: async (request) => results[request.task], cancel: async () => ({ ok: true, canceled: true }) },
    canvasStore: {
      updateGenerationNode(canvasId, nodeId, update) {
        const next = update(nodes.get(nodeId));
        nodes.set(nodeId, next);
        commits.push({ canvasId, nodeId, data: next });
      },
    },
  });

  await runtime.run({ runId: 'agent-1', task: 'smart-reverse', canvasId: 'canvas-a', nodeId: 'reverse-a', context: { assets: [] } });
  await runtime.run({ runId: 'agent-2', task: 'optimize-image-generator-prompt', canvasId: 'canvas-a', nodeId: 'generator-a', context: { prompt: '原始提示词', referenceImages: [{ edgeId: 'edge-1' }] } });

  assert.equal(runtime.activeCount(), 0);
  assert.equal(nodes.get('reverse-a').text, '后台反推结果');
  assert.equal(nodes.get('generator-a').text, '人物佩戴 @图一\n暖色逆光');
  assert.equal(nodes.get('generator-a').imagePromptDocument.root.children[0].children[1].edgeId, 'edge-1');
  assert.deepEqual(commits.map((item) => item.canvasId), ['canvas-a', 'canvas-a']);
});

test('Agent runtime does not overwrite a prompt edited while optimization is running', async () => {
  const data = { kind: 'imageGenerator', text: '用户已修改' };
  const runtime = createCanvasAgentRuntime({
    canvasAgent: { run: async () => ({ optimizedPrompt: '旧请求结果' }), cancel: async () => ({ ok: true, canceled: true }) },
    canvasStore: { updateGenerationNode(_canvasId, _nodeId, update) { Object.assign(data, update(data)); } },
  });
  await runtime.run({ runId: 'agent-stale', task: 'optimize-image-generator-prompt', canvasId: 'canvas-a', nodeId: 'generator-a', context: { prompt: '原始提示词', referenceImages: [] } });
  assert.equal(data.text, '用户已修改');
});

test('Agent reference prompt documents are created without a task repository', () => {
  const document = promptDocumentFromReferenceText('@图一 的帽子与 @图二 的眼镜', [{ edgeId: 'hat' }, { edgeId: 'glasses' }]);
  assert.deepEqual(document.root.children[0].children.filter((node) => node.type === 'image-reference').map((node) => node.edgeId), ['hat', 'glasses']);
});

test('Agent runtime exposes active lifecycle state for canvas remount hydration', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const events = [];
  const runtime = createCanvasAgentRuntime({
    canvasAgent: {
      run: async (_request, progress) => {
        progress({ stage: 'requesting-model' });
        await pending;
        return { optimizedPrompt: '完成结果' };
      },
      cancel: async () => ({ ok: true, canceled: true }),
    },
    canvasStore: { updateGenerationNode() {} },
  });
  const runPromise = runtime.run({ runId: 'agent-active', task: 'optimize-image-generator-prompt', canvasId: 'canvas-a', nodeId: 'node-a', context: { prompt: '原提示词' } }, (event) => events.push(event));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(runtime.listActive('canvas-a').map((run) => ({ runId: run.runId, nodeId: run.nodeId, status: run.status, stage: run.stage })), [
    { runId: 'agent-active', nodeId: 'node-a', status: 'running', stage: 'requesting-model' },
  ]);
  assert.deepEqual(runtime.listActive('canvas-b'), []);

  release();
  await runPromise;
  assert.equal(runtime.listActive('canvas-a').length, 0);
  assert.equal(events.at(-1).status, 'completed');
  assert.equal(events.at(-1).result.optimizedPrompt, '完成结果');
});
