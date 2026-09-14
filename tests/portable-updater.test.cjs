const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const AdmZip = require('adm-zip');

const {
  createPortableUpdater,
  downloadFileWithProgress,
  normalizeSha256Digest,
  validatePortableArchiveVersion,
} = require('../electron/main/modules/portable-updater.cjs');

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

test('GitHub metadata requests keep a stable cacheable URL', async () => {
  const rootDir = createRoot();
  try {
    const requests = [];
    const updater = createPortableUpdater({
      app: { isPackaged: false, quit() {} },
      rootDir,
      net: {
        fetch: async (url, init) => {
          requests.push({ url, init });
          return releaseResponse();
        },
      },
    });

    await updater.check();
    assert.equal(requests[0].url, 'https://api.github.com/repos/liwbee/forart/releases/latest');
    assert.equal(requests[0].init.headers['User-Agent'], 'Forart-Updater');
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('portable update downloads verify the GitHub sha256 digest and remove corrupt files', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-updater-digest-'));
  const filePath = path.join(rootDir, 'update.zip');
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const payload = Buffer.from('portable update payload');
  const digest = createHash('sha256').update(payload).digest('hex');
  const response = {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-length': String(payload.length) }),
    arrayBuffer: async () => payload,
  };
  const net = { fetch: async () => response };

  assert.equal(normalizeSha256Digest(`sha256:${digest.toUpperCase()}`), digest);
  await downloadFileWithProgress(net, 'https://example.test/update.zip', filePath, null, `sha256:${digest}`);
  assert.deepEqual(fs.readFileSync(filePath), payload);

  await assert.rejects(
    downloadFileWithProgress(net, 'https://example.test/update.zip', filePath, null, `sha256:${'0'.repeat(64)}`),
    /digest mismatch/,
  );
  assert.equal(fs.existsSync(filePath), false);
});

test('portable updater rejects an archive whose embedded app version is stale', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-updater-package-version-'));
  const zipPath = path.join(rootDir, 'update.zip');
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const zip = new AdmZip();
  zip.addFile('resources/app/VERSION', Buffer.from('0.2.13\n'));
  zip.addFile('resources/app/package.json', Buffer.from(JSON.stringify({ version: '0.2.13' })));
  zip.writeZip(zipPath);

  assert.throws(
    () => validatePortableArchiveVersion(zipPath, '0.2.14'),
    /version mismatch.*Expected 0\.2\.14, got 0\.2\.13/,
  );
});

test('portable updater accepts an archive whose embedded app version matches the release', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-updater-package-version-ok-'));
  const zipPath = path.join(rootDir, 'update.zip');
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const zip = new AdmZip();
  zip.addFile('resources/app/VERSION', Buffer.from('0.2.14\n'));
  zip.addFile('resources/app/package.json', Buffer.from(JSON.stringify({ version: '0.2.14' })));
  zip.writeZip(zipPath);

  assert.equal(validatePortableArchiveVersion(zipPath, '0.2.14'), '0.2.14');
});

test('packaged updates refuse releases without a sha256 digest', async (t) => {
  const rootDir = createRoot();
  const dataRoot = path.join(rootDir, 'portable-data');
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const updater = createPortableUpdater({
    app: { isPackaged: true, quit() {} },
    rootDir,
    dataRoot,
    net: { fetch: async () => releaseResponse() },
  });

  const result = await updater.run();
  assert.equal(result.ok, false);
  assert.match(result.error, /sha256 asset digest/);
  const stagingRoot = path.join(dataRoot, '.forart-data', 'update_staging');
  assert.equal(fs.existsSync(stagingRoot), true);
  assert.deepEqual(fs.readdirSync(stagingRoot), []);
});
