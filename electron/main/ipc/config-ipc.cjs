const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const REPO_URL = 'https://github.com/liwbee/forart';
const GITHUB_BRANCH = 'main';
const GITHUB_API_ROOT = 'https://api.github.com/repos/liwbee/forart';
const GITHUB_RAW_ROOT = `https://raw.githubusercontent.com/liwbee/forart/${GITHUB_BRANCH}`;
const REMOTE_TREE_URL = `${GITHUB_API_ROOT}/git/trees/${GITHUB_BRANCH}?recursive=1`;
const REMOTE_VERSION_URL = `${GITHUB_RAW_ROOT}/VERSION`;
const REMOTE_UPDATE_NOTES_URL = `${GITHUB_RAW_ROOT}/update-notes.json`;

function readPackageInfo(rootDir) {
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    return {
      version: String(packageJson.version || '0.0.0'),
      name: String(packageJson.name || 'Forart'),
    };
  } catch {
    return { version: '0.0.0', name: 'Forart' };
  }
}

async function fetchJson(net, url) {
  const response = await net.fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Forart-Updater',
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function fetchText(net, url) {
  const response = await net.fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`, {
    headers: {
      Accept: 'text/plain, application/json',
      'User-Agent': 'Forart-Updater',
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.text();
}

async function fetchBytes(net, url) {
  const response = await net.fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`, {
    headers: {
      Accept: 'application/octet-stream, text/plain, */*',
      'User-Agent': 'Forart-Updater',
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function resolveCommand(command) {
  if (process.platform === 'win32' && command === 'npm') return 'npm.cmd';
  return command;
}

function runCommand(command, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(resolveCommand(command), args.map(String), {
      cwd,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      resolve({ ok: false, stdout, stderr, error: error.message });
    });

    child.on('close', (code) => {
      resolve({
        ok: code === 0,
        stdout,
        stderr,
        error: code === 0 ? undefined : `${command} exited with code ${code}`,
      });
    });
  });
}

function normalizeUpdateNotes(input, fallbackVersion = '') {
  const payload = input && typeof input === 'object' ? input : {};
  const items = Array.isArray(payload.items)
    ? payload.items
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        if (item && typeof item === 'object') return String(item.text || item.title || '').trim();
        return '';
      })
      .filter(Boolean)
    : [];

  return {
    version: String(payload.version || fallbackVersion || '').trim(),
    updatedAt: String(payload.updatedAt || payload.updated_at || payload.date || '').trim(),
    revision: String(payload.revision || fallbackVersion || '').trim(),
    items,
  };
}

function readLocalVersion(rootDir) {
  try {
    const version = fs.readFileSync(path.join(rootDir, 'VERSION'), 'utf8').trim().split(/\r?\n/)[0]?.trim();
    if (version) return version;
  } catch {
    // Fall back to package.json for older local copies that do not have VERSION yet.
  }
  return readPackageInfo(rootDir).version;
}

async function readRemoteVersion(net) {
  const text = await fetchText(net, REMOTE_VERSION_URL);
  const version = String(text || '').trim().split(/\r?\n/)[0]?.trim() || '';
  if (!version || version.includes('<') || version.includes('{') || !/\d/.test(version)) {
    throw new Error('Remote VERSION is empty or invalid.');
  }
  return version;
}

function readLocalUpdateNotes(rootDir, fallbackVersion = '') {
  try {
    const filePath = path.join(rootDir, 'update-notes.json');
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return normalizeUpdateNotes(payload, fallbackVersion);
  } catch {
    return normalizeUpdateNotes({}, fallbackVersion);
  }
}

async function readRemoteUpdateNotes(net, latestVersion) {
  try {
    const payload = JSON.parse(await fetchText(net, REMOTE_UPDATE_NOTES_URL));
    return normalizeUpdateNotes(payload, latestVersion);
  } catch (error) {
    return {
      ...normalizeUpdateNotes({}, latestVersion),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function versionParts(value) {
  return String(value || '').match(/\d+/g)?.map(Number) || [];
}

function compareVersions(a, b) {
  const aa = versionParts(a);
  const bb = versionParts(b);
  const length = Math.max(aa.length, bb.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (aa[index] || 0) - (bb[index] || 0);
    if (diff) return diff;
  }
  const left = String(a || '').trim();
  const right = String(b || '').trim();
  if (left === right) return 0;
  return left > right ? 1 : -1;
}

function portableDataRoot(rootDir) {
  const directory = path.join(rootDir, '.forart-data');
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function updateBackupRoot(rootDir) {
  const directory = path.join(portableDataRoot(rootDir), 'update_backups');
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function updateStagingRoot(rootDir) {
  const directory = path.join(portableDataRoot(rootDir), 'update_staging');
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function timestampName() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function normalizeUpdatePath(input) {
  return String(input || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
}

function hasSafeParts(rel) {
  return Boolean(rel) && rel.split('/').every((part) => part && part !== '.' && part !== '..');
}

function updateAllowedFile(input) {
  const rel = normalizeUpdatePath(input);
  if (!hasSafeParts(rel)) return false;
  if (rel === 'Forart.exe') return false;
  if (rel === 'forart-config.json') return false;
  if (rel.startsWith('.git/') || rel.startsWith('.forart-data/') || rel.startsWith('CanvasAssests/')) return false;
  if (rel.startsWith('node_modules/') || rel.startsWith('dist/') || rel.startsWith('data/')) return false;
  if (rel.startsWith('server/node_modules/') || rel.startsWith('server/.forart-data/') || rel.startsWith('server/data/')) return false;
  if (/\.(log|err\.log)$/i.test(rel)) return false;

  if ([
    'VERSION',
    'README.md',
    'START_FORART_MAIN.bat',
    'eslint.config.js',
    'index.html',
    'package-lock.json',
    'package.json',
    'tsconfig.app.json',
    'tsconfig.json',
    'tsconfig.node.json',
    'update-notes.json',
    'vite.config.ts',
  ].includes(rel)) return true;

  return (
    rel.startsWith('electron/')
    || rel.startsWith('renderer/')
    || rel.startsWith('server/')
    || rel.startsWith('scripts/launcher/')
  );
}

function isInsideOrSame(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative === '' || (Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function safeUpdateTarget(rootDir, rel) {
  const normalized = normalizeUpdatePath(rel);
  if (!updateAllowedFile(normalized)) throw new Error(`Update file is not allowed: ${normalized}`);
  const target = path.resolve(rootDir, ...normalized.split('/'));
  if (!isInsideOrSame(rootDir, target)) throw new Error(`Unsafe update path: ${normalized}`);
  return target;
}

function safeStagingTarget(stagingRoot, rel) {
  const normalized = normalizeUpdatePath(rel);
  if (!updateAllowedFile(normalized)) throw new Error(`Update file is not allowed: ${normalized}`);
  const target = path.resolve(stagingRoot, ...normalized.split('/'));
  if (!isInsideOrSame(stagingRoot, target)) throw new Error(`Unsafe staging path: ${normalized}`);
  return target;
}

async function githubUpdateFileList(net) {
  const payload = await fetchJson(net, REMOTE_TREE_URL);
  const entries = Array.isArray(payload.tree) ? payload.tree : [];
  const files = entries
    .filter((entry) => entry?.type === 'blob')
    .map((entry) => normalizeUpdatePath(entry.path))
    .filter(updateAllowedFile)
    .sort();

  if (!files.includes('VERSION')) throw new Error('Remote update source is missing VERSION.');
  if (!files.includes('package.json')) throw new Error('Remote update source is missing package.json.');
  if (!files.some((file) => file.startsWith('electron/'))) throw new Error('Remote update source did not return electron files.');
  if (!files.some((file) => file.startsWith('renderer/'))) throw new Error('Remote update source did not return renderer files.');

  return [...new Set(files)];
}

async function downloadGithubUpdateFiles(net, files, stagingRoot) {
  for (const rel of files) {
    const target = safeStagingTarget(stagingRoot, rel);
    const rawUrl = `${GITHUB_RAW_ROOT}/${rel.split('/').map(encodeURIComponent).join('/')}`;
    const bytes = await fetchBytes(net, rawUrl);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
}

function backupFile(rootDir, backupRoot, rel) {
  const target = safeUpdateTarget(rootDir, rel);
  if (!fs.existsSync(target)) return false;
  const backupPath = path.resolve(backupRoot, ...normalizeUpdatePath(rel).split('/'));
  if (!isInsideOrSame(backupRoot, backupPath)) throw new Error(`Unsafe backup path: ${rel}`);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.copyFileSync(target, backupPath);
  return true;
}

function restoreFiles(rootDir, backupRoot, applied) {
  for (const item of [...applied].reverse()) {
    const target = safeUpdateTarget(rootDir, item.rel);
    const backupPath = path.resolve(backupRoot, ...normalizeUpdatePath(item.rel).split('/'));
    try {
      if (item.hadOriginal && fs.existsSync(backupPath)) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(backupPath, target);
      } else if (!item.hadOriginal && fs.existsSync(target)) {
        fs.unlinkSync(target);
      }
    } catch {
      // Keep restoring the rest. The original update error is more useful to the caller.
    }
  }
}

function applyStagedFiles(rootDir, stagingRoot, backupRoot, files) {
  const applied = [];
  for (const rel of files) {
    const source = safeStagingTarget(stagingRoot, rel);
    const target = safeUpdateTarget(rootDir, rel);
    const hadOriginal = backupFile(rootDir, backupRoot, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tempPath = `${target}.update_tmp`;
    fs.copyFileSync(source, tempPath);
    try {
      fs.renameSync(tempPath, target);
    } catch {
      fs.rmSync(target, { force: true });
      fs.renameSync(tempPath, target);
    }
    applied.push({ rel, hadOriginal });
  }
  return applied;
}

async function probeNet(name, net, url, required = true) {
  const startedAt = Date.now();
  try {
    const response = await net.fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`, {
      headers: { 'User-Agent': 'Forart-Updater' },
    });
    return {
      name,
      ok: response.ok,
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      detail: `HTTP ${response.status}`,
      required,
    };
  } catch (error) {
    return {
      name,
      ok: false,
      elapsedMs: Date.now() - startedAt,
      detail: error instanceof Error ? error.message : String(error),
      required,
    };
  }
}

async function probeCommand(name, command, args, rootDir) {
  const startedAt = Date.now();
  const result = await runCommand(command, args, rootDir);
  return {
    name,
    ok: result.ok,
    elapsedMs: Date.now() - startedAt,
    detail: result.ok ? (result.stdout || result.stderr || '').trim().split(/\r?\n/)[0] || 'OK' : result.error || result.stderr || 'Failed',
    required: true,
  };
}

async function probeWritable(rootDir) {
  const startedAt = Date.now();
  const filePath = path.join(portableDataRoot(rootDir), `.update-write-test-${process.pid}.tmp`);
  try {
    fs.writeFileSync(filePath, 'ok', 'utf8');
    fs.rmSync(filePath, { force: true });
    return {
      name: 'Local update directory',
      ok: true,
      elapsedMs: Date.now() - startedAt,
      detail: 'Writable',
      required: true,
    };
  } catch (error) {
    return {
      name: 'Local update directory',
      ok: false,
      elapsedMs: Date.now() - startedAt,
      detail: error instanceof Error ? error.message : String(error),
      required: true,
    };
  }
}

async function appInfoPayload(rootDir) {
  const packageInfo = readPackageInfo(rootDir);
  const version = readLocalVersion(rootDir);
  const localNotes = readLocalUpdateNotes(rootDir, version);
  return {
    name: packageInfo.name,
    repoUrl: REPO_URL,
    updateUrl: REMOTE_VERSION_URL,
    canGitUpdate: true,
    currentRevision: version,
    currentUpdatedAt: localNotes.updatedAt || version,
  };
}

function registerConfigIpc({ ipcMain, dialog, configStore, localServer, app, rootDir, net, shell }) {
  let activeAppConfig = null;

  ipcMain.handle('config:load', async () => {
    try {
      const config = configStore.load();
      if (!config) return null;
      activeAppConfig = config;
      if (config.mode === 'local') await localServer.ensure(config);
      return config;
    } catch {
      return null;
    }
  });

  ipcMain.handle('config:save', async (_event, payload) => {
    const config = configStore.save(payload);
    activeAppConfig = config;
    if (config.mode === 'local') {
      await localServer.ensure(config);
    } else {
      localServer.stop();
    }
    return { ok: true, config };
  });

  ipcMain.handle('config:load-api-settings', async () => configStore.loadApiSettings());

  ipcMain.handle('config:save-api-settings', async (_event, payload) => {
    const apiSettings = configStore.saveApiSettings(payload);
    return { ok: true, apiSettings };
  });

  ipcMain.handle('config:load-image-review-settings', async () => configStore.loadImageReviewSettings());

  ipcMain.handle('config:save-image-review-settings', async (_event, payload) => {
    const imageReview = configStore.saveImageReviewSettings(payload);
    return { ok: true, imageReview };
  });

  ipcMain.handle('config:default-paths', async () => ({
    imageDownloadPath: app.getPath('downloads'),
  }));

  ipcMain.handle('dialog:choose-directory', async (_event, payload = {}) => {
    const result = await dialog.showOpenDialog({
      title: String(payload?.title || 'Choose Forart asset library folder'),
      properties: ['openDirectory', 'createDirectory'],
    });

    return {
      canceled: result.canceled,
      path: result.filePaths[0] || '',
    };
  });

  ipcMain.handle('server:test-remote', async (_event, serverUrl) => {
    const baseUrl = String(serverUrl || '').trim();
    if (!baseUrl) return { ok: false, error: 'Server URL is required' };
    return localServer.checkHealth(baseUrl);
  });

  ipcMain.handle('server:local-status', async () => localServer.localStatus());

  ipcMain.handle('app:info', async () => appInfoPayload(rootDir));

  ipcMain.handle('app:check-update', async () => {
    const info = await appInfoPayload(rootDir);
    try {
      const latestVersion = await readRemoteVersion(net);
      const remoteNotes = await readRemoteUpdateNotes(net, latestVersion);
      const updateAvailable = compareVersions(latestVersion, info.currentRevision) > 0;
      return {
        ok: true,
        currentRevision: info.currentRevision,
        latestRevision: latestVersion,
        currentUpdatedAt: info.currentUpdatedAt,
        latestUpdatedAt: remoteNotes.updatedAt || latestVersion,
        updateAvailable,
        canGitUpdate: true,
        repoUrl: REPO_URL,
        updateNotes: remoteNotes.items.length ? { ...remoteNotes, source: 'update-notes.json' } : remoteNotes,
      };
    } catch (error) {
      return {
        ok: false,
        currentRevision: info.currentRevision,
        latestRevision: '',
        currentUpdatedAt: info.currentUpdatedAt,
        latestUpdatedAt: '',
        updateAvailable: false,
        canGitUpdate: true,
        repoUrl: REPO_URL,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('app:run-update', async () => {
    const stagingRoot = path.join(updateStagingRoot(rootDir), `${timestampName()}-${process.pid}`);
    const backupRoot = path.join(updateBackupRoot(rootDir), timestampName());
    let applied = [];
    try {
      if (fs.existsSync(stagingRoot)) fs.rmSync(stagingRoot, { recursive: true, force: true });
      fs.mkdirSync(stagingRoot, { recursive: true });
      fs.mkdirSync(backupRoot, { recursive: true });

      const files = await githubUpdateFileList(net);
      await downloadGithubUpdateFiles(net, files, stagingRoot);
      applied = applyStagedFiles(rootDir, stagingRoot, backupRoot, files);

      const needsRootInstall = files.includes('package.json') || files.includes('package-lock.json');
      const needsServerInstall = files.includes('server/package.json') || files.includes('server/package-lock.json');
      const installResults = [];
      if (needsRootInstall) {
        installResults.push(await runCommand('npm', ['install'], rootDir));
      }
      if (needsServerInstall) {
        installResults.push(await runCommand('npm', ['install'], path.join(rootDir, 'server')));
      }
      const failedInstall = installResults.find((item) => !item.ok);
      if (failedInstall) {
          restoreFiles(rootDir, backupRoot, applied);
        return {
          ok: false,
          stdout: installResults.map((item) => item.stdout || '').join(''),
          stderr: installResults.map((item) => item.stderr || '').join(''),
          restartRequired: false,
          backupDir: backupRoot,
          updated: applied.map((item) => item.rel),
          count: applied.length,
          error: failedInstall.error || 'npm install failed',
        };
      }

      const version = readLocalVersion(rootDir);
      return {
        ok: true,
        stdout: installResults.map((item) => item.stdout || '').join(''),
        stderr: installResults.map((item) => item.stderr || '').join(''),
        restartRequired: true,
        backupDir: backupRoot,
        updated: applied.map((item) => item.rel),
        count: applied.length,
        version,
      };
    } catch (error) {
      if (applied.length) restoreFiles(rootDir, backupRoot, applied);
      return {
        ok: false,
        stdout: '',
        stderr: '',
        restartRequired: false,
        backupDir: fs.existsSync(backupRoot) ? backupRoot : '',
        updated: applied.map((item) => item.rel),
        count: applied.length,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      if (fs.existsSync(stagingRoot)) fs.rmSync(stagingRoot, { recursive: true, force: true });
    }
  });

  ipcMain.handle('app:update-connectivity', async () => {
    const results = await Promise.all([
      probeNet('GitHub VERSION', net, REMOTE_VERSION_URL),
      probeNet('GitHub update tree', net, REMOTE_TREE_URL),
      probeNet('GitHub update notes', net, REMOTE_UPDATE_NOTES_URL, false),
      probeWritable(rootDir),
      probeCommand('npm command', 'npm', ['--version'], rootDir),
    ]);
    const required = results.filter((item) => item.required);
    return {
      ok: required.every((item) => item.ok),
      results,
    };
  });

  ipcMain.handle('app:open-update-page', async () => {
    await shell.openExternal(REPO_URL);
    return { ok: true };
  });

  return { getActiveConfig: () => activeAppConfig };
}

module.exports = { registerConfigIpc };
