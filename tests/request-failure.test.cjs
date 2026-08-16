const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

async function loadModule() {
  return import(pathToFileURL(path.join(__dirname, '..', 'renderer', 'src', 'lib', 'requestFailure.ts')).href);
}

test('request failures distinguish authentication, permission and retryable server errors', async () => {
  const { classifyRequestFailure } = await loadModule();

  assert.deepEqual(classifyRequestFailure({ status: 401, message: 'Unauthorized' }), {
    kind: 'unauthenticated',
    message: 'Unauthorized',
    status: 401,
    retryable: false,
  });
  assert.equal(classifyRequestFailure({ status: 403, message: 'Forbidden' }).kind, 'forbidden');
  assert.equal(classifyRequestFailure({ status: 503, message: 'Unavailable' }).retryable, true);
});

test('request failures distinguish timeout and transport failures', async () => {
  const { classifyRequestFailure } = await loadModule();

  assert.equal(classifyRequestFailure({ name: 'AbortError', message: 'aborted' }).kind, 'timeout');
  assert.equal(classifyRequestFailure(new TypeError('Failed to fetch')).kind, 'unavailable');
  assert.equal(classifyRequestFailure(new Error('ECONNREFUSED')).retryable, true);
  assert.equal(classifyRequestFailure(new TypeError('Cannot read properties of undefined')).kind, 'unknown');
});

test('first request failure ignores empty query slots', async () => {
  const { firstRequestFailure } = await loadModule();
  const failure = firstRequestFailure([null, undefined, { status: 500, message: 'Database unavailable' }]);

  assert.equal(failure.kind, 'server');
  assert.equal(failure.status, 500);
});
