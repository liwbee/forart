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
      if (Date.now() - startedAt >= timeoutMs) return reject(new Error('Timed out waiting for Gemini task.'));
      setTimeout(check, 5);
    };
    check();
  });
}

function createRunner(fetch, savedAssets) {
  const generationTaskStore = createMemoryGenerationTaskStore('api');
  return {
    generationTaskStore,
    runner: createImageGenerationRunner({
      net: { fetch },
      assetStore: {
        resolveAssetUrl() { return ''; },
        async saveAsset(payload) {
          savedAssets.push(payload);
          return {
            url: `forart-asset://output/gemini-${savedAssets.length}.png`,
            fileName: `gemini-${savedAssets.length}.png`,
          };
        },
      },
      canvasStore: { setGenerationTaskAnchor() {} },
      generationTaskStore,
      resultCommitter: { commit() {} },
    }),
  };
}

async function runGeminiTask(runner, generationTaskStore, overrides = {}) {
  const task = await runner.startTask({
    canvasId: 'canvas-gemini',
    target: { type: 'imageGenerator', nodeId: 'node-gemini' },
    providerId: 'ai-tudou',
    provider: {
      id: 'ai-tudou',
      baseUrl: 'https://api.ai-tudou.net',
      apiKey: 'secret-key',
      protocol: 'gemini',
    },
    model: 'gemini-3-pro-image-preview',
    prompt: 'keep the subject and change the lighting',
    referenceImages: [
      'data:image/jpeg;base64,cmVmLTE=',
      'data:image/png;base64,cmVmLTI=',
    ],
    resolution: '2K',
    aspectRatio: '9:16',
    ...overrides,
  });
  await waitFor(() => ['succeeded', 'failed'].includes(generationTaskStore.getTask(task.id)?.status));
  return generationTaskStore.getTask(task.id);
}

test('AI-Tudou Gemini requests use Bearer auth and place reference images before the prompt', async () => {
  const savedAssets = [];
  let request;
  const { runner, generationTaskStore } = createRunner(async (url, init) => {
    request = { url: String(url), init, body: JSON.parse(init.body) };
    return Response.json({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'cmVzdWx0' } }] } }],
    });
  }, savedAssets);

  const task = await runGeminiTask(runner, generationTaskStore);

  assert.equal(task.status, 'succeeded', task.error);
  assert.equal(request.url, 'https://api.ai-tudou.net/v1beta/models/gemini-3-pro-image-preview:generateContent');
  assert.equal(request.init.headers.Authorization, 'Bearer secret-key');
  assert.equal(request.init.headers['x-goog-api-key'], undefined);
  assert.deepEqual(request.body.contents[0].parts, [
    { inlineData: { mimeType: 'image/jpeg', data: 'cmVmLTE=' } },
    { inlineData: { mimeType: 'image/png', data: 'cmVmLTI=' } },
    { text: 'keep the subject and change the lighting' },
  ]);
  assert.deepEqual(request.body.generationConfig, {
    responseModalities: ['TEXT', 'IMAGE'],
    imageConfig: { aspectRatio: '9:16', imageSize: '2K' },
  });
  assert.equal(savedAssets.length, 1);
});

test('AI-Tudou Gemini responses skip thoughts and parse Markdown and inline base64 images', async () => {
  const savedAssets = [];
  const { runner, generationTaskStore } = createRunner(async () => Response.json({
    candidates: [{
      content: {
        parts: [
          { thought: true, inlineData: { mimeType: 'image/png', data: 'aWdub3JlZA==' } },
          { text: 'first ![image](data:image/png;base64,bWFya2Rvd24=)' },
          { inline_data: { mime_type: 'image/jpeg', data: 'aW5saW5l' } },
        ],
      },
    }],
  }), savedAssets);

  const task = await runGeminiTask(runner, generationTaskStore, { referenceImages: [] });

  assert.equal(task.status, 'succeeded', task.error);
  assert.deepEqual(savedAssets.map((asset) => asset.dataUrl), [
    'data:image/png;base64,bWFya2Rvd24=',
    'data:image/jpeg;base64,aW5saW5l',
  ]);
  assert.equal(task.result.results.length, 2);
});
