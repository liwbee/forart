const test = require('node:test');
const assert = require('node:assert/strict');
const { generationResultFileName } = require('../electron/main/modules/generation-naming.cjs');

const date = new Date(2026, 7, 22, 9, 5);

test('generation result file names follow platform-model-timestamp pattern', () => {
  const name = generationResultFileName(
    { executorKind: 'api', providerName: 'APImart', model: 'gpt-image-2' },
    0,
    undefined,
    date,
  );
  assert.equal(name, 'APImart-gpt-image-2-08220905.png');

  const libtvName = generationResultFileName(
    { executorKind: 'libtv', model: 'flux-pro' },
    0,
    undefined,
    date,
  );
  assert.equal(libtvName, 'LibTV-flux-pro-08220905.png');
});

test('multi-image results append index suffix from the second image on', () => {
  const task = { executorKind: 'api', providerName: 'APImart', model: 'gpt-image-2' };
  assert.equal(generationResultFileName(task, 0, undefined, date), 'APImart-gpt-image-2-08220905.png');
  assert.equal(generationResultFileName(task, 1, undefined, date), 'APImart-gpt-image-2-08220905-2.png');
  assert.equal(generationResultFileName(task, 3, undefined, date), 'APImart-gpt-image-2-08220905-4.png');
});

test('platform and model fall back and sanitize unsafe characters', () => {
  assert.equal(
    generationResultFileName({ executorKind: 'api', model: '' }, 0, undefined, date),
    'Forart-Local-08220905.png',
  );
  assert.equal(
    generationResultFileName({ executorKind: 'api', providerId: 'my:relay 2', model: 'model x' }, 0, undefined, date),
    'my-relay-2-model-x-08220905.png',
  );
});

test('extension follows the source file when provided', () => {
  const task = { executorKind: 'libtv', model: 'flux' };
  assert.equal(generationResultFileName(task, 0, 'remote-image.jpeg', date), 'LibTV-flux-08220905.jpeg');
  assert.equal(generationResultFileName(task, 0, 'no-extension', date), 'LibTV-flux-08220905.png');
});
