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

test('API references are re-uploaded, verified, and submitted with the returned URL unchanged', async () => {
  const sourceUrl = 'https://upload.apimart.ai/f/image/existing.png';
  const returnedUrl = 'https://upload.aishuch.com/f/image/new.png';
  const requests = [];
  let verificationAttempts = 0;
  let submittedBody;

  const net = {
    async fetch(url, init = {}) {
      const requestUrl = String(url);
      const method = init.method || 'GET';
      requests.push({ url: requestUrl, method });

      if (requestUrl === sourceUrl && method === 'GET') {
        return new Response(Buffer.from('source-image'), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      }
      if (requestUrl === 'https://api.apib.ai/v1/uploads/images' && method === 'POST') {
        return Response.json({ url: returnedUrl });
      }
      if (requestUrl === returnedUrl && method === 'GET') {
        verificationAttempts += 1;
        return verificationAttempts === 1
          ? new Response('not propagated', { status: 404 })
          : new Response(Buffer.from('uploaded-image'), {
            status: 206,
            headers: { 'content-type': 'image/png' },
          });
      }
      if (requestUrl === 'https://api.apib.ai/v1/images/generations' && method === 'POST') {
        submittedBody = JSON.parse(init.body);
        return Response.json({ data: [{ b64_json: Buffer.from('result').toString('base64') }] });
      }
      throw new Error(`Unexpected request: ${method} ${requestUrl}`);
    },
  };

  const generationTaskStore = createMemoryGenerationTaskStore('api');
  const runner = createImageGenerationRunner({
    net,
    assetStore: {
      resolveAssetUrl() { return ''; },
      async saveAsset() {
        return { url: 'forart-asset://output/result.png', fileName: 'result.png' };
      },
    },
    canvasStore: {
      setGenerationTaskAnchor() {},
    },
    generationTaskStore,
    resultCommitter: { commit() {} },
  });

  const task = await runner.startTask({
    canvasId: 'canvas-upload',
    target: { type: 'imageGenerator', nodeId: 'node-upload' },
    providerId: 'apimart',
    provider: {
      id: 'apimart',
      baseUrl: 'https://api.apib.ai/v1',
      apiKey: 'test',
      protocol: 'compatible',
    },
    model: 'gpt-image-2',
    modelRule: {
      requestFormat: 'standard',
      sizeMode: 'ratio',
      resolutionCase: 'upper',
      imageCountRule: { options: [1], defaultCount: 1 },
    },
    prompt: 'test prompt',
    referenceImages: [sourceUrl],
    resolution: '1K',
    aspectRatio: '3:4',
  });

  await waitFor(() => ['succeeded', 'failed'].includes(generationTaskStore.getTask(task.id)?.status));

  assert.equal(generationTaskStore.getTask(task.id)?.status, 'succeeded', generationTaskStore.getTask(task.id)?.error);
  assert.equal(verificationAttempts, 2);
  assert.equal(submittedBody.resolution, '1K');
  assert.deepEqual(submittedBody.image_urls, [returnedUrl]);
  assert.deepEqual(requests.map(({ method, url }) => `${method} ${url}`), [
    `GET ${sourceUrl}`,
    'POST https://api.apib.ai/v1/uploads/images',
    `GET ${returnedUrl}`,
    `GET ${returnedUrl}`,
    'POST https://api.apib.ai/v1/images/generations',
  ]);
});
