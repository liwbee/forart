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
      if (Date.now() - startedAt >= timeoutMs) return reject(new Error('Timed out waiting for the generation task.'));
      setTimeout(check, 5);
    };
    check();
  });
}

function createRunner(provider) {
  const savedAssets = [];
  const generationTaskStore = createMemoryGenerationTaskStore('api');
  return {
    savedAssets,
    generationTaskStore,
    runner: createImageGenerationRunner({
      net: {
        fetch: async () => Response.json({
          candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'cmVzdWx0' } }] } }],
        }),
      },
      assetStore: {
        resolveAssetUrl() { return ''; },
        async saveAsset(payload) {
          savedAssets.push(payload);
          return { url: `forart-asset://output/asset-${savedAssets.length}.png`, fileName: `asset-${savedAssets.length}.png` };
        },
      },
      canvasStore: { setGenerationTaskAnchor() {} },
      generationTaskStore,
      resolveProvider: () => provider,
      resultCommitter: { commit() {} },
    }),
  };
}

async function runTask(runner, generationTaskStore, providerId = 'custom-api-3') {
  const task = await runner.startTask({
    canvasId: 'canvas-naming',
    target: { type: 'imageGenerator', nodeId: 'node-naming' },
    providerId,
    model: 'gemini-3-pro-image-preview',
    prompt: 'a cat',
    resolution: '2K',
    aspectRatio: '1:1',
  });
  await waitFor(() => ['succeeded', 'failed'].includes(generationTaskStore.getTask(task.id)?.status));
  return generationTaskStore.getTask(task.id);
}

// The renderer only sends the provider id, so the task used to carry no platform name and
// "平台-模型-时间戳" fell back to the id (custom-api-3) instead of the name the user typed
// in the API settings. The runner now records the resolved provider's display name before
// the result is saved.
test('result files use the provider name the user configured', async () => {
  const { runner, generationTaskStore, savedAssets } = createRunner({
    id: 'custom-api-3',
    name: 'Comfly',
    baseUrl: 'https://api.example.com',
    apiKey: 'secret-key',
    protocol: 'gemini',
  });

  const task = await runTask(runner, generationTaskStore);

  assert.equal(task.status, 'succeeded', task.error);
  assert.equal(task.providerName, 'Comfly');
  assert.equal(savedAssets.length, 1);
  assert.match(savedAssets[0].defaultName, /^Comfly-gemini-3-pro-image-preview-\d{8}\.png$/);
});

test('unsafe characters in a provider name are sanitized in the file name', async () => {
  const { runner, generationTaskStore, savedAssets } = createRunner({
    id: 'custom-api-4',
    name: 'My Relay: v2/测试',
    baseUrl: 'https://api.example.com',
    apiKey: 'secret-key',
    protocol: 'gemini',
  });

  const task = await runTask(runner, generationTaskStore, 'custom-api-4');

  assert.equal(task.status, 'succeeded', task.error);
  assert.match(savedAssets[0].defaultName, /^My-Relay-v2-测试-gemini-3-pro-image-preview-\d{8}\.png$/);
});

test('a provider without a name still falls back to its id', async () => {
  const { runner, generationTaskStore, savedAssets } = createRunner({
    id: 'custom-api-5',
    baseUrl: 'https://api.example.com',
    apiKey: 'secret-key',
    protocol: 'gemini',
  });

  const task = await runTask(runner, generationTaskStore, 'custom-api-5');

  assert.equal(task.status, 'succeeded', task.error);
  assert.match(savedAssets[0].defaultName, /^custom-api-5-gemini-3-pro-image-preview-\d{8}\.png$/);
});
