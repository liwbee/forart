const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('canvas task repository stores only image history and removes legacy Agent records', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-canvas-tasks-'));
  const fixture = path.join(__dirname, 'fixtures', 'canvas-task-repository-electron.cjs');
  try {
    const result = spawnSync(require('electron'), [fixture, rootDir], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally { fs.rmSync(rootDir, { recursive: true, force: true }); }
});
