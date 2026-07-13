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
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
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
      resolve();
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited early with ${code}. Output: ${output}`));
    });
  });
}

function schemaFingerprint(databasePath) {
  const db = new Database(databasePath, { readonly: true });
  try {
    return db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
  } finally {
    db.close();
  }
}

async function jsonRequest(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const body = await response.json();
  assert.equal(response.status, options.expectedStatus || 200, `${options.method || 'GET'} ${pathname}: ${JSON.stringify(body)}`);
  return body;
}

test('remote resource library keeps schema stable while Library Modules handle CRUD', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-library-http-'));
  const databaseDir = path.join(tempRoot, 'database');
  const libraryDir = path.join(tempRoot, 'library');
  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server/forart-server.mjs'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      FORART_DATABASE_DIR: databaseDir,
      FORART_LIBRARY_DIR: libraryDir,
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
  const databasePath = path.join(databaseDir, 'forart-library.sqlite');
  const schemaBefore = schemaFingerprint(databasePath);

  const project = await jsonRequest(baseUrl, '/api/outfit-projects', {
    method: 'POST',
    body: JSON.stringify({ name: 'HTTP Outfit Test' }),
  });
  const renamedProject = await jsonRequest(baseUrl, `/api/outfit-projects/${encodeURIComponent(project.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: 'HTTP Outfit Renamed' }),
  });
  assert.equal(renamedProject.name, 'HTTP Outfit Renamed');

  const imported = await jsonRequest(baseUrl, `/api/outfit-projects/${encodeURIComponent(project.id)}/outfits/import-entries`, {
    method: 'POST',
    body: JSON.stringify({ entries: [{ name: 'Look 001', filename: 'look.png', mime_type: 'image/png', data: PNG_1X1 }] }),
  });
  assert.equal(imported.imported_count, 1);
  const outfit = imported.imported[0];

  const tag = await jsonRequest(baseUrl, `/api/libraries/outfit/tags?project_id=${encodeURIComponent(project.id)}`, {
    method: 'POST',
    body: JSON.stringify({ name: 'Summer', color: 'yellow' }),
  });
  const updatedTag = await jsonRequest(baseUrl, `/api/libraries/outfit/tags/${encodeURIComponent(tag.id)}?project_id=${encodeURIComponent(project.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ color: 'blue', sort_order: 3 }),
  });
  assert.equal(updatedTag.color, 'blue');

  const bulk = await jsonRequest(baseUrl, '/api/libraries/outfit/entries/bulk', {
    method: 'POST',
    body: JSON.stringify({ project_id: project.id, entry_ids: [outfit.id], operation: 'add_tags', tags: ['Summer'] }),
  });
  assert.equal(bulk.updated, 1);

  const listed = await jsonRequest(baseUrl, `/api/outfit-projects/${encodeURIComponent(project.id)}/outfits?tag_id=${encodeURIComponent(tag.id)}`);
  assert.equal(listed.outfits.length, 1);
  assert.deepEqual(listed.outfits[0].tags, ['Summer']);

  const replaced = await jsonRequest(baseUrl, `/api/outfits/${encodeURIComponent(outfit.id)}/image/upload`, {
    method: 'POST',
    body: JSON.stringify({ filename: 'replacement.png', mime_type: 'image/png', data: PNG_1X1 }),
  });
  assert.notEqual(replaced.asset_id, outfit.asset_id);
  const assetFile = await fetch(`${baseUrl}/api/assets/${encodeURIComponent(replaced.asset_id)}/file`);
  assert.equal(assetFile.status, 200);
  assert.equal(assetFile.headers.get('content-type'), 'image/png');
  const assetHead = await fetch(`${baseUrl}/api/assets/${encodeURIComponent(replaced.asset_id)}/thumb`, { method: 'HEAD' });
  assert.equal(assetHead.status, 200);

  await jsonRequest(baseUrl, `/api/outfits/${encodeURIComponent(outfit.id)}`, { method: 'DELETE' });
  await jsonRequest(baseUrl, `/api/libraries/outfit/tags/${encodeURIComponent(tag.id)}?project_id=${encodeURIComponent(project.id)}`, { method: 'DELETE' });
  await jsonRequest(baseUrl, `/api/outfit-projects/${encodeURIComponent(project.id)}`, { method: 'DELETE' });

  const actionProject = await jsonRequest(baseUrl, '/api/action-projects', {
    method: 'POST',
    body: JSON.stringify({ name: 'HTTP Action Test' }),
  });
  const actionImport = await jsonRequest(baseUrl, `/api/action-projects/${encodeURIComponent(actionProject.id)}/actions/import-entries`, {
    method: 'POST',
    body: JSON.stringify({ entries: [{ name: 'Pose 001', prompt: 'stand', filename: 'pose.png', mime_type: 'image/png', data: PNG_1X1 }] }),
  });
  assert.equal(actionImport.imported_count, 1);
  const action = actionImport.imported[0];
  const updatedAction = await jsonRequest(baseUrl, `/api/actions/${encodeURIComponent(action.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: 'Pose Renamed', prompt: 'turn left' }),
  });
  assert.equal(updatedAction.prompt, 'turn left');
  const actionTag = await jsonRequest(baseUrl, `/api/libraries/action/tags?project_id=${encodeURIComponent(actionProject.id)}`, {
    method: 'POST',
    body: JSON.stringify({ name: 'Standing', color: 'green' }),
  });
  await jsonRequest(baseUrl, '/api/libraries/action/entries/bulk', {
    method: 'POST',
    body: JSON.stringify({ project_id: actionProject.id, entry_ids: [action.id], operation: 'add_tags', tags: ['Standing'] }),
  });
  const filteredActions = await jsonRequest(baseUrl, `/api/action-projects/${encodeURIComponent(actionProject.id)}/actions?tag_id=${encodeURIComponent(actionTag.id)}`);
  assert.equal(filteredActions.actions.length, 1);
  await jsonRequest(baseUrl, `/api/actions/${encodeURIComponent(action.id)}/image/upload`, {
    method: 'POST',
    body: JSON.stringify({ filename: 'pose-replacement.png', mime_type: 'image/png', data: PNG_1X1 }),
  });
  await jsonRequest(baseUrl, `/api/actions/${encodeURIComponent(action.id)}`, { method: 'DELETE' });
  await jsonRequest(baseUrl, `/api/action-projects/${encodeURIComponent(actionProject.id)}`, { method: 'DELETE' });

  const modelProject = await jsonRequest(baseUrl, '/api/model-projects', {
    method: 'POST',
    body: JSON.stringify({ name: 'HTTP Model Test' }),
  });
  const model = await jsonRequest(baseUrl, `/api/model-projects/${encodeURIComponent(modelProject.id)}/models`, {
    method: 'POST',
    body: JSON.stringify({ name: 'Model 001', gender: 'female' }),
  });
  const uploadedImage = await jsonRequest(baseUrl, `/api/models/${encodeURIComponent(model.id)}/images/upload`, {
    method: 'POST',
    body: JSON.stringify({ filename: 'model.png', mime_type: 'image/png', data: PNG_1X1 }),
  });
  const modelTag = await jsonRequest(baseUrl, `/api/libraries/model/tags?project_id=${encodeURIComponent(modelProject.id)}`, {
    method: 'POST',
    body: JSON.stringify({ name: 'Female', color: 'purple' }),
  });
  const updatedModel = await jsonRequest(baseUrl, `/api/models/${encodeURIComponent(model.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ cover_image_id: uploadedImage.image.id, tags: ['Female'] }),
  });
  assert.equal(updatedModel.cover_image_id, uploadedImage.image.id);
  const modelImages = await jsonRequest(baseUrl, `/api/models/${encodeURIComponent(model.id)}/images`);
  assert.equal(modelImages.images.length, 1);
  const filteredModels = await jsonRequest(baseUrl, `/api/model-projects/${encodeURIComponent(modelProject.id)}/models?gender=female&tag_id=${encodeURIComponent(modelTag.id)}`);
  assert.equal(filteredModels.models.length, 1);
  await jsonRequest(baseUrl, `/api/model-images/${encodeURIComponent(uploadedImage.image.id)}`, { method: 'DELETE' });
  await jsonRequest(baseUrl, `/api/models/${encodeURIComponent(model.id)}`, { method: 'DELETE' });
  await jsonRequest(baseUrl, `/api/model-projects/${encodeURIComponent(modelProject.id)}`, { method: 'DELETE' });

  const projects = await jsonRequest(baseUrl, '/api/outfit-projects');
  assert.equal(projects.projects.some((item) => item.id === project.id), false);
  assert.deepEqual(schemaFingerprint(databasePath), schemaBefore);

  const modelProjects = await jsonRequest(baseUrl, '/api/model-projects');
  const actionProjects = await jsonRequest(baseUrl, '/api/action-projects');
  assert.ok(modelProjects.projects.length >= 1);
  assert.ok(actionProjects.projects.length >= 1);
});
