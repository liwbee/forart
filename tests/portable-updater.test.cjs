const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createPortableUpdater } = require('../electron/main/modules/portable-updater.cjs');

function createRoot() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-updater-test-'));
  fs.writeFileSync(path.join(rootDir, 'VERSION'), '0.1.29\n');
  fs.writeFileSync(path.join(rootDir, 'package.json'), JSON.stringify({ name: 'forart-main', version: '0.1.29' }));
  return rootDir;
}

function releaseResponse(version = '0.1.30') {
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        id: 1,
        tag_name: `v${version}`,
        name: version,
        published_at: '2026-07-13T00:00:00.000Z',
        html_url: `https://github.com/liwbee/forart/releases/tag/v${version}`,
        body: '- Update test',
        assets: [{
          name: `Forart-${version}-windows-portable.zip`,
          size: 123,
          browser_download_url: 'https://example.test/forart.zip',
        }],
      };
    },
  };
}

test('portable updater reports app info and a newer release without writing the database', async (t) => {
  const rootDir = createRoot();
  const dataRoot = path.join(rootDir, 'portable-data');
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const updater = createPortableUpdater({
    app: { isPackaged: false, quit() {} },
    rootDir,
    dataRoot,
    net: { fetch: async () => releaseResponse() },
  });

  assert.deepEqual(await updater.appInfo(), {
    name: 'forart-main',
    repoUrl: 'https://github.com/liwbee/forart',
    updateUrl: 'https://api.github.com/repos/liwbee/forart/releases/latest',
    currentRevision: '0.1.29',
    currentUpdatedAt: '',
  });

  const result = await updater.check();
  assert.equal(result.ok, true);
  assert.equal(result.currentRevision, '0.1.29');
  assert.equal(result.latestRevision, '0.1.30');
  assert.equal(result.updateAvailable, true);
  assert.equal(fs.existsSync(path.join(dataRoot, 'database')), false);
});

test('development builds reject portable apply before staging files are created', async (t) => {
  const rootDir = createRoot();
  const dataRoot = path.join(rootDir, 'portable-data');
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const updater = createPortableUpdater({
    app: { isPackaged: false, quit() {} },
    rootDir,
    dataRoot,
    net: { fetch: async () => releaseResponse() },
  });

  const result = await updater.run();
  assert.equal(result.ok, false);
  assert.match(result.error, /Development builds/);
  assert.equal(fs.existsSync(dataRoot), false);
});
