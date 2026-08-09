const assert = require('node:assert/strict');
const test = require('node:test');

const { createImageGenerationRunner } = require('../electron/main/modules/image-generation-runner.cjs');
const { createMemoryGenerationTaskStore } = require('./fixtures/generation-task-memory.cjs');

function waitFor(predicate, timeoutMs = 3000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const value = predicate();
      if (value) return resolve(value);
      if (Date.now() - startedAt >= timeoutMs) return reject(new Error('Timed out waiting for test condition.'));
      setTimeout(check, 5);
    };
    check();
  });
}

function createRunner(onRequest) {
  const generationTaskStore = createMemoryGenerationTaskStore('api');
  return {
    generationTaskStore,
    runner: createImageGenerationRunner({
      net: {
        async fetch(url, init = {}) {
          if (String(url) === 'https://api.apimart.ai/v1/images/generations' && init.method === 'POST') {
            onRequest(JSON.parse(init.body));
            return Response.json({ data: [{ b64_json: Buffer.from('result').toString('base64') }] });
          }
          throw new Error(`Unexpected request: ${init.method || 'GET'} ${url}`);
        },
      },
      assetStore: {
        async saveAsset() {
          return { url: 'forart-asset://output/result.png', fileName: 'result.png' };
        },
      },
      canvasStore: { setGenerationTaskAnchor() {} },
      generationTaskStore,
      resultCommitter: { commit() {} },
    }),
  };
}

const qwenImage3Rule = {
  requestFormat: 'standard',
  sizeMode: 'ratio',
  resolutionCase: 'upper',
  sizeRule: {
    resolutionField: 'resolution',
    pixelSizeConstraints: {
      minDimension: 512,
      maxDimension: 2048,
      minAspectRatio: 1 / 8,
      maxAspectRatio: 8,
    },
  },
  imageCountRule: { options: [1, 2, 3, 4, 5, 6], defaultCount: 1 },
  advancedRule: {
    supportsNegativePrompt: true,
    promptExtend: {
      defaultEnabled: false,
      modes: ['direct', 'agent'],
      defaultMode: 'direct',
      agentTextToImageOnly: true,
    },
  },
};

test('Qwen Image 3.0 submits its documented advanced fields and custom pixel size', async () => {
  let submittedBody;
  const { runner, generationTaskStore } = createRunner((body) => { submittedBody = body; });

  const task = await runner.startTask({
    canvasId: 'canvas-qwen-3',
    target: { type: 'imageGenerator', nodeId: 'node-qwen-3' },
    provider: {
      id: 'apimart',
      baseUrl: 'https://api.apimart.ai/v1',
      apiKey: 'test',
      protocol: 'compatible',
    },
    model: 'qwen-image-3.0-pro',
    modelRule: qwenImage3Rule,
    prompt: 'menu layout',
    negativePrompt: 'watermark',
    promptExtend: true,
    promptExtendMode: 'agent',
    customSize: '1600x900',
    resolution: '2K',
    aspectRatio: '16:9',
    imageCount: 6,
  });

  await waitFor(() => ['succeeded', 'failed'].includes(generationTaskStore.getTask(task.id)?.status));

  assert.equal(generationTaskStore.getTask(task.id)?.status, 'succeeded');
  assert.deepEqual(submittedBody, {
    model: 'qwen-image-3.0-pro',
    prompt: 'menu layout',
    n: 6,
    size: '1600x900',
    negative_prompt: 'watermark',
    prompt_extend: true,
    prompt_extend_mode: 'agent',
  });
});

test('models without advanced capabilities do not receive Qwen-only fields', async () => {
  let submittedBody;
  const { runner, generationTaskStore } = createRunner((body) => { submittedBody = body; });

  const task = await runner.startTask({
    canvasId: 'canvas-generic',
    target: { type: 'imageGenerator', nodeId: 'node-generic' },
    provider: {
      id: 'apimart',
      baseUrl: 'https://api.apimart.ai/v1',
      apiKey: 'test',
      protocol: 'compatible',
    },
    model: 'generic-image',
    modelRule: {
      requestFormat: 'standard',
      sizeMode: 'ratio',
      sizeRule: { resolutionField: 'resolution' },
      imageCountRule: { options: [1], defaultCount: 1 },
    },
    prompt: 'test',
    negativePrompt: 'watermark',
    promptExtend: true,
    promptExtendMode: 'agent',
    resolution: '1K',
    aspectRatio: '1:1',
  });

  await waitFor(() => ['succeeded', 'failed'].includes(generationTaskStore.getTask(task.id)?.status));

  assert.equal(generationTaskStore.getTask(task.id)?.status, 'succeeded');
  assert.equal(submittedBody.negative_prompt, undefined);
  assert.equal(submittedBody.prompt_extend, undefined);
  assert.equal(submittedBody.prompt_extend_mode, undefined);
});
