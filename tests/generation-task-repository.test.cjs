const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

function runFixture(executable, fixture, rootDir, env) {
  return spawnSync(executable, [fixture, rootDir], {
    cwd: path.resolve(__dirname, '..'),
    env,
    encoding: 'utf8',
    timeout: 30_000,
  });
}

test('generation task repository persists API and LibTV stores in one SQLite database', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-generation-tasks-'));
  const fixture = path.join(__dirname, 'fixtures', 'generation-task-repository-electron.cjs');
  const electronExecutable = require('electron');
  try {
    let result = runFixture(electronExecutable, fixture, rootDir, {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
    });
    if (result.status !== 0 && /NODE_MODULE_VERSION|ERR_DLOPEN_FAILED/.test(`${result.stderr}\n${result.stdout}`)) {
      result = runFixture(process.execPath, fixture, rootDir, process.env);
    }
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(fs.existsSync(path.join(rootDir, 'CanvasAssests', 'tasks', 'generation-tasks.sqlite')), true);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
