const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');

const serverRequire = createRequire(path.resolve(__dirname, '../server/package.json'));
const Database = serverRequire('better-sqlite3');

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

function waitForOutput(child, pattern, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for server. Output: ${output}`)), timeoutMs);
    const onData = (chunk) => {
      output += chunk.toString();
      if (!pattern.test(output)) return;
      clearTimeout(timeout);
      child.stdout.off('data', onData);
      resolve(output);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited early with ${code}. Output: ${output}`));
    });
  });
}

test('real server entry uses isolated storage and preserves the expected schema', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-server-smoke-'));
  const libraryDir = path.join(tempRoot, 'library');
  const runtimeDataDir = path.join(tempRoot, 'forart_data');
  const canvasDir = path.join(tempRoot, 'canvas');
  const port = await reservePort();
  const child = spawn(process.execPath, ['server/forart-server.mjs'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      FORART_DB_DRIVER: 'sqlite',
      FORART_AUTH_DISABLED: '1',
      NODE_ENV: 'test',
      FORART_LIBRARY_DIR: libraryDir,
      FORART_DATA_DIR: runtimeDataDir,
      FORART_CANVAS_STORAGE_ROOT: canvasDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  t.after(async () => {
    if (child.exitCode === null) child.kill();
    await new Promise((resolve) => child.exitCode === null ? child.once('exit', resolve) : resolve());
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  await waitForOutput(child, /Forart Server API running/);
  const health = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, database: 'ready' });

  const admin = await fetch(`http://127.0.0.1:${port}/api/admin/status`);
  assert.equal(admin.status, 200);
  assert.equal((await admin.json()).ok, true);

  const adminPage = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(adminPage.status, 200);
  const adminHtml = await adminPage.text();
  const adminEntry = adminHtml.match(/src="(\/_admin\/assets\/[^"]+\.js)"/i)?.[1];
  assert.ok(adminEntry, "compiled admin entry should be present");
  const adminAsset = await fetch(`http://127.0.0.1:${port}${adminEntry}`);
  assert.equal(adminAsset.status, 200);
  assert.match(adminAsset.headers.get("content-type") || "", /javascript/);

  const databasePath = path.join(libraryDir, '.forart', 'database', 'forart-library.sqlite');
  const db = new Database(databasePath, { readonly: true });
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name);
  db.close();
  const requiredTables = [
    'account',
    'action_profiles',
    'asset_cleanup_jobs',
    'assets',
    'kysely_migration',
    'kysely_migration_lock',
    'library_entries',
    'library_entry_assets',
    'library_entry_tags',
    'library_projects',
    'library_tags',
    'model_profiles',
    'organization',
    'organizationRole',
    'member',
    'session',
    'user',
    'verification',
  ];
  for (const table of requiredTables) assert.ok(tables.includes(table), `expected current schema table ${table}`);
  assert.equal(tables.includes('user_permission_grants'), false, 'legacy permission grant table must not be recreated');
  assert.equal(fs.existsSync(path.join(runtimeDataDir, '.forart-auth-secret')), true);
  assert.equal(fs.existsSync(path.join(libraryDir, '.forart-auth-secret')), false);
});
