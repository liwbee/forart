const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { registerLocalApiIpc } = require('../electron/main/ipc/local-api-ipc.cjs');

const serverRequire = createRequire(path.resolve(__dirname, '../server/package.json'));
const Database = serverRequire('better-sqlite3');
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function schemaFingerprint(databasePath) {
  const db = new Database(databasePath, { readonly: true });
  try {
    return db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
  } finally {
    db.close();
  }
}

test('local mode keeps resource CRUD on Electron IPC and preserves schema', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-local-library-ipc-'));
  const libraryDir = path.join(tempRoot, 'library');
  const dataRoot = path.join(tempRoot, 'app-data');
  const handlers = new Map();
  const ipcMain = { handle(channel, handler) { handlers.set(channel, handler); } };
  const configStore = {
    load() {
      return { mode: 'local', localLibraryPath: libraryDir, language: 'zh-CN' };
    },
  };
  const localApi = registerLocalApiIpc({ ipcMain, configStore, app: {}, dataRoot });
  const request = handlers.get('local-api:request');
  assert.equal(typeof request, 'function');

  t.after(() => {
    localApi.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  async function ipc(pathname, method = 'GET', body) {
    return request({}, { path: pathname, method, body });
  }

  const runtime = await ipc('/api/local-ipc/runtime');
  assert.equal(runtime.ok, true);
  assert.equal(runtime.body.transport, 'ipc');
  assert.equal(path.resolve(runtime.body.dataDir), path.resolve(libraryDir));

  const databasePath = path.join(libraryDir, '.forart', 'database', 'forart-library.sqlite');
  const schemaBefore = schemaFingerprint(databasePath);
  const created = await ipc('/api/outfit-projects', 'POST', { name: 'IPC Outfit Test' });
  assert.equal(created.ok, true);
  const imported = await ipc(`/api/outfit-projects/${encodeURIComponent(created.body.id)}/outfits/import-entries`, 'POST', {
    entries: [{ name: 'IPC Look', filename: 'look.png', mime_type: 'image/png', data: PNG_1X1 }],
  });
  assert.equal(imported.ok, true);
  assert.equal(imported.body.imported_count, 1);

  const listed = await ipc(`/api/outfit-projects/${encodeURIComponent(created.body.id)}/outfits`);
  assert.equal(listed.ok, true);
  assert.equal(listed.body.outfits.length, 1);
  assert.match(listed.body.outfits[0].asset_url, /^forart-asset:\/\/library\//);

  const removedPreview = await ipc(`/api/action-projects/${encodeURIComponent('missing')}/actions/import-folder/preview`, 'POST', { source_path: tempRoot });
  assert.equal(removedPreview.status, 501);
  assert.deepEqual(schemaFingerprint(databasePath), schemaBefore);
});
