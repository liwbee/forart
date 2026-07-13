const test = require('node:test');
const assert = require('node:assert/strict');

test('server lifecycle starts on an ephemeral port and closes cleanly', async () => {
  const { createForartServer } = await import('../server/src/server-app.mjs');
  const app = createForartServer({
    handleRequest(_req, res) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    },
  });

  await app.start({ port: 0, host: '127.0.0.1' });
  const address = app.address();
  assert.equal(typeof address, 'object');
  const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  await app.close();
  assert.equal(app.address(), null);
});
