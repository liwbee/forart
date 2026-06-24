const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const REPO_URL = 'https://github.com/liwbee/forart';
const REMOTE_COMMIT_URL = 'https://api.github.com/repos/liwbee/forart/commits/main';
const REMOTE_UPDATE_NOTES_URL = 'https://raw.githubusercontent.com/liwbee/forart/main/update-notes.json';

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

function canGitUpdate(rootDir) {
  return fs.existsSync(path.join(rootDir, '.git'));
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

async function readLocalRevision(rootDir) {
  if (!canGitUpdate(rootDir)) {
    return { revision: '', updatedAt: '' };
  }

  const revision = await runCommand('git', ['rev-parse', 'HEAD'], rootDir);
  const updatedAt = await runCommand('git', ['log', '-1', '--format=%cI'], rootDir);
  return {
    revision: revision.ok ? revision.stdout.trim() : '',
    updatedAt: updatedAt.ok ? updatedAt.stdout.trim() : '',
  };
}

async function readRemoteRevision(net) {
  const payload = await fetchJson(net, REMOTE_COMMIT_URL);
  return {
    revision: String(payload.sha || '').trim(),
    updatedAt: String(payload.commit?.committer?.date || payload.commit?.author?.date || '').trim(),
  };
}

function normalizeUpdateNotes(input, fallbackRevision = '') {
  const payload = input && typeof input === 'object' ? input : {};
  const items = Array.isArray(payload.items)
    ? payload.items
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        if (item && typeof item === 'object') return String(item.text || '').trim();
        return '';
      })
      .filter(Boolean)
    : [];

  return {
    version: String(payload.version || '').trim(),
    updatedAt: String(payload.updatedAt || payload.updated_at || '').trim(),
    revision: String(payload.revision || fallbackRevision || '').trim(),
    items,
  };
}

function readLocalUpdateNotes(rootDir) {
  try {
    const filePath = path.join(rootDir, 'update-notes.json');
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return normalizeUpdateNotes(payload);
  } catch {
    return normalizeUpdateNotes({});
  }
}

async function readRemoteUpdateNotes(net, latestRevision) {
  try {
    const payload = JSON.parse(await fetchText(net, REMOTE_UPDATE_NOTES_URL));
    return normalizeUpdateNotes(payload, latestRevision);
  } catch (error) {
    return {
      ...normalizeUpdateNotes({}, latestRevision),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function readCommitUpdateNotes(rootDir, currentRevision) {
  if (!canGitUpdate(rootDir) || !currentRevision) return normalizeUpdateNotes({});
  const log = await runCommand('git', ['log', '--oneline', `${currentRevision}..FETCH_HEAD`], rootDir);
  if (!log.ok) return normalizeUpdateNotes({});
  return normalizeUpdateNotes({
    items: log.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  });
}

async function buildUpdateNotes(rootDir, net, currentRevision, latestRevision) {
  const remoteNotes = await readRemoteUpdateNotes(net, latestRevision);
  if (remoteNotes.items.length) return { ...remoteNotes, source: 'update-notes.json' };

  const commitNotes = await readCommitUpdateNotes(rootDir, currentRevision);
  if (commitNotes.items.length) return { ...commitNotes, source: 'commit-log' };

  const localNotes = readLocalUpdateNotes(rootDir);
  return { ...localNotes, source: localNotes.items.length ? 'local-update-notes.json' : 'empty', error: remoteNotes.error };
}

function parseUpdateTimestamp(value) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function isRemoteNotesNewer(localNotes, remoteNotes) {
  if (remoteNotes.revision && localNotes.revision) return remoteNotes.revision !== localNotes.revision;

  const remoteTimestamp = parseUpdateTimestamp(remoteNotes.updatedAt);
  const localTimestamp = parseUpdateTimestamp(localNotes.updatedAt);
  if (remoteTimestamp && localTimestamp) return remoteTimestamp > localTimestamp;
  if (remoteNotes.updatedAt && localNotes.updatedAt) return remoteNotes.updatedAt > localNotes.updatedAt;

  if (remoteNotes.version && localNotes.version) return remoteNotes.version !== localNotes.version;
  if (remoteNotes.items?.length && localNotes.items?.length) return JSON.stringify(remoteNotes.items) !== JSON.stringify(localNotes.items);
  return Boolean(remoteNotes.items?.length && !localNotes.items?.length);
}

async function checkRemoteAhead(rootDir, currentRevision, latestRevision, localNotes, remoteNotes) {
  if (!canGitUpdate(rootDir)) {
    return { ok: true, updateAvailable: isRemoteNotesNewer(localNotes, remoteNotes) };
  }

  if (!currentRevision || !latestRevision || currentRevision === latestRevision) {
    return { ok: true, updateAvailable: false };
  }

  const fetch = await runCommand('git', ['fetch', '--quiet', 'origin', 'main'], rootDir);
  if (!fetch.ok) {
    return {
      ok: false,
      updateAvailable: false,
      error: fetch.error || fetch.stderr || 'git fetch failed',
    };
  }

  const ancestor = await runCommand('git', ['merge-base', '--is-ancestor', currentRevision, 'FETCH_HEAD'], rootDir);
  return {
    ok: true,
    updateAvailable: ancestor.ok,
  };
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
      detail: response.ok ? `HTTP ${response.status}` : `HTTP ${response.status}`,
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

async function appInfoPayload(rootDir) {
  const packageInfo = readPackageInfo(rootDir);
  const localRevision = await readLocalRevision(rootDir);
  const localNotes = readLocalUpdateNotes(rootDir);
  return {
    name: packageInfo.name,
    repoUrl: REPO_URL,
    updateUrl: REMOTE_COMMIT_URL,
    canGitUpdate: canGitUpdate(rootDir),
    currentRevision: localRevision.revision || localNotes.revision,
    currentUpdatedAt: localRevision.updatedAt || localNotes.updatedAt,
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
      const remoteRevision = await readRemoteRevision(net);
      if (!remoteRevision.revision) {
        return {
          ok: false,
          currentRevision: info.currentRevision,
          latestRevision: '',
          currentUpdatedAt: info.currentUpdatedAt,
          latestUpdatedAt: '',
          updateAvailable: false,
          canGitUpdate: info.canGitUpdate,
          repoUrl: REPO_URL,
          error: 'Remote commit is empty.',
        };
      }
      const localNotes = readLocalUpdateNotes(rootDir);
      const remoteNotes = await readRemoteUpdateNotes(net, remoteRevision.revision);
      const aheadCheck = await checkRemoteAhead(rootDir, info.currentRevision, remoteRevision.revision, localNotes, remoteNotes);
      if (!aheadCheck.ok) {
        return {
          ok: false,
          currentRevision: info.currentRevision,
          latestRevision: remoteRevision.revision,
          currentUpdatedAt: info.currentUpdatedAt,
          latestUpdatedAt: remoteRevision.updatedAt,
          updateAvailable: false,
          canGitUpdate: info.canGitUpdate,
          repoUrl: REPO_URL,
          error: aheadCheck.error || 'Could not compare local and remote revisions.',
        };
      }
      return {
        ok: true,
        currentRevision: info.currentRevision,
        latestRevision: remoteRevision.revision,
        currentUpdatedAt: info.currentUpdatedAt,
        latestUpdatedAt: remoteRevision.updatedAt,
        updateAvailable: aheadCheck.updateAvailable,
        canGitUpdate: info.canGitUpdate,
        repoUrl: REPO_URL,
        updateNotes: remoteNotes.items.length
          ? { ...remoteNotes, source: 'update-notes.json' }
          : await buildUpdateNotes(rootDir, net, info.currentRevision, remoteRevision.revision),
      };
    } catch (error) {
      return {
        ok: false,
        currentRevision: info.currentRevision,
        latestRevision: '',
        currentUpdatedAt: info.currentUpdatedAt,
        latestUpdatedAt: '',
        updateAvailable: false,
        canGitUpdate: info.canGitUpdate,
        repoUrl: REPO_URL,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('app:run-update', async () => {
    if (!canGitUpdate(rootDir)) {
      await shell.openExternal(REPO_URL);
      return { ok: false, restartRequired: false, error: 'Git working tree is not available. Opened project page instead.' };
    }

    const pull = await runCommand('git', ['pull', '--ff-only'], rootDir);
    if (!pull.ok) {
      return { ok: false, stdout: pull.stdout, stderr: pull.stderr, restartRequired: false, error: pull.error || 'git pull failed' };
    }

    const install = await runCommand('npm', ['install'], rootDir);
    return {
      ok: install.ok,
      stdout: `${pull.stdout || ''}${install.stdout || ''}`,
      stderr: `${pull.stderr || ''}${install.stderr || ''}`,
      restartRequired: install.ok,
      error: install.ok ? undefined : install.error || 'npm install failed',
    };
  });

  ipcMain.handle('app:update-connectivity', async () => {
    const results = await Promise.all([
      probeNet('GitHub commit API', net, REMOTE_COMMIT_URL),
      probeNet('GitHub update notes', net, REMOTE_UPDATE_NOTES_URL, false),
      probeCommand('Git command', 'git', ['--version'], rootDir),
      probeCommand('Git fetch origin/main', 'git', ['fetch', '--quiet', 'origin', 'main'], rootDir),
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
