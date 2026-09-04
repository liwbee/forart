const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const rootDir = path.resolve(process.argv[2]);
const { createCanvasTaskRepository, rejectUnsafe } = require('../../electron/main/modules/tasks/canvas-task-repository.cjs');
const { createGenerationTaskRepository } = require('../../electron/main/modules/generation/generation-task-repository.cjs');

assert.deepEqual(rejectUnsafe({ apiKey: 'secret', headers: { Authorization: 'secret' }, safe: 'kept' }), { safe: 'kept' });
assert.throws(() => rejectUnsafe({ image: `data:image/png;base64,${'x'.repeat(1000)}` }), /base64/i);

const legacyRepository = createGenerationTaskRepository({ rootDir });
legacyRepository.saveTask({ id: 'legacy-image', canvasId: 'canvas-legacy', target: { type: 'imageGenerator', nodeId: 'image-legacy' }, providerId: 'provider-a', model: 'image-model', resolution: '2K', aspectRatio: '3:4', quality: 'high', status: 'succeeded', startedAt: 1, updatedAt: 20, completedAt: 20, result: { localUrl: 'forart-asset://legacy.png' } }, { executorKind: 'api', setAsLatest: true });
legacyRepository.close();

let repository = createCanvasTaskRepository({ rootDir });
assert.equal(repository.migrateLegacyImageTasks().migratedCount, 1);
assert.equal(repository.get('legacy-image').operation, 'image_generate');
assert.equal(repository.get('legacy-image').resolution, '2K');
assert.equal(repository.get('legacy-image').aspectRatio, '3:4');
assert.equal(repository.get('legacy-image').quality, 'high');
repository.close();

const databasePath = path.join(rootDir, 'CanvasAssests', 'tasks', 'generation-tasks.sqlite');
const database = new Database(databasePath);
database.prepare(`INSERT INTO canvas_tasks (id, category, operation, canvas_id, node_id, executor_kind, status, version, created_at, started_at, updated_at, result_kind) VALUES (?, 'agent', 'image_reverse', ?, ?, 'agent', 'succeeded', 1, 1, 1, 1, 'structured')`).run('legacy-agent', 'canvas-1', 'node-1');
database.close();

repository = createCanvasTaskRepository({ rootDir });
assert.equal(repository.get('legacy-agent'), null);
assert.equal(repository.listPage({ category: 'agent' }).total, 0);
assert.equal(fs.existsSync(repository.migrationBackupPath), true);
const verificationDatabase = new Database(databasePath, { readonly: true });
assert.equal(verificationDatabase.prepare(`SELECT COUNT(*) count FROM canvas_tasks WHERE category <> 'image'`).get().count, 0);
verificationDatabase.close();
assert.throws(() => repository.save({ id: 'agent-task', category: 'agent', operation: 'image_reverse', canvasId: 'canvas-1', nodeId: 'node-1', status: 'running' }), /only accepts image tasks/i);

const before = fs.statSync(databasePath).size;
assert.throws(() => repository.save({ id: 'image-base64', category: 'image', operation: 'image_generate', canvasId: 'canvas-1', nodeId: 'node-1', status: 'running', input: { references: [{ imageUrl: `data:image/png;base64,${'x'.repeat(5_000_000)}` }] } }), /base64/i);
repository.save({ id: 'image-safe', category: 'image', operation: 'image_generate', canvasId: 'canvas-1', nodeId: 'node-1', status: 'running', input: { references: [{ imageUrl: 'forart-asset://safe.png' }] } }, { setAsLatest: true });
repository.save({ id: 'image-metadata', category: 'image', operation: 'image_generate', canvasId: 'canvas-1', nodeId: 'node-metadata', status: 'succeeded', resolution: '2K', aspectRatio: '3:4', quality: 'high' }, { setAsLatest: true });
const metadataTask = repository.get('image-metadata');
assert.equal(metadataTask.resolution, '2K');
assert.equal(metadataTask.aspectRatio, '3:4');
assert.equal(metadataTask.quality, 'high');
const after = fs.statSync(databasePath).size;
assert.ok(after - before < 1024 * 1024);

repository.save({ id: 'old-image', category: 'image', operation: 'image_generate', canvasId: 'canvas-1', nodeId: 'node-2', status: 'succeeded', startedAt: 1, updatedAt: 10, completedAt: 10, result: { images: [] } }, { setAsLatest: true });
for (const status of ['failed', 'canceled', 'interrupted', 'superseded']) {
  repository.save({ id: `old-${status}`, category: 'image', operation: 'image_generate', canvasId: 'canvas-1', nodeId: `node-${status}`, status, startedAt: 1, updatedAt: 10, completedAt: 10 }, { setAsLatest: true });
}
assert.deepEqual(
  new Set(repository.cleanup({ now: 1000, retentionMs: 1 }).deletedTaskIds),
  new Set(['legacy-image', 'old-image', 'old-failed', 'old-canceled', 'old-interrupted', 'old-superseded']),
);
assert.equal(repository.get('old-image'), null);
repository.close();
