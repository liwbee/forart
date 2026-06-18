const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const REPO_URL = 'https://github.com/liwbee/forart';
const REMOTE_COMMIT_URL = 'https://api.github.com/repos/liwbee/forart/commits/main';

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

function canGitUpdate(rootDir) {
  return fs.existsSync(path.join(rootDir, '.git'));
}

function runCommand(command, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      shell: process.platform === 'win32',
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

async function checkRemoteAhead(rootDir, currentRevision, latestRevision) {
  if (!canGitUpdate(rootDir) || !currentRevision || !latestRevision || currentRevision === latestRevision) {
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

async function appInfoPayload(rootDir) {
  const packageInfo = readPackageInfo(rootDir);
  const localRevision = await readLocalRevision(rootDir);
  return {
    name: packageInfo.name,
    repoUrl: REPO_URL,
    updateUrl: REMOTE_COMMIT_URL,
    canGitUpdate: canGitUpdate(rootDir),
    currentRevision: localRevision.revision,
    currentUpdatedAt: localRevision.updatedAt,
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
      const aheadCheck = await checkRemoteAhead(rootDir, info.currentRevision, remoteRevision.revision);
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

  ipcMain.handle('app:open-update-page', async () => {
    await shell.openExternal(REPO_URL);
    return { ok: true };
  });

  return { getActiveConfig: () => activeAppConfig };
}

module.exports = { registerConfigIpc };
