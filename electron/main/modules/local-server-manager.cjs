const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function createLocalServerManager({ app, rootDir, fetchImpl = fetch, port = 6980, nodeExe = process.env.FORART_SERVER_NODE || 'node' }) {
  const bundledServerDir = path.join(rootDir, 'server');
  const bundledServerEntry = path.join(bundledServerDir, 'forart-server.mjs');
  let serverProcess = null;
  let activeLocalServerConfig = null;
  let startingServerPromise = null;

  function localServerEnv(config) {
    const libraryRoot = path.resolve(config.localLibraryPath || path.join(app.getPath('userData'), 'library'));
    return {
      ...process.env,
      FORART_LANGUAGE: config.language === 'en-US' ? 'en-US' : 'zh-CN',
      HOST: '127.0.0.1',
      PORT: String(port),
      FORART_DATABASE_DIR: path.join(libraryRoot, '.forart', 'database'),
      FORART_DATA_DIR: libraryRoot,
    };
  }

  async function checkHealth(baseUrl) {
    try {
      const response = await fetchImpl(baseUrl.replace(/\/+$/, '') + '/api/health');
      if (!response.ok) return { ok: false, status: response.status };
      return { ok: true, payload: await response.json() };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async function waitForReady() {
    const baseUrl = 'http://127.0.0.1:' + port;
    for (let i = 0; i < 30; i += 1) {
      const health = await checkHealth(baseUrl);
      if (health.ok) return health;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return { ok: false, error: 'Local server did not become ready in time' };
  }

  async function ensure(config) {
    if (config.mode !== 'local' || !config.localLibraryPath) {
      stop();
      return { ok: false, skipped: true };
    }

    const currentHealth = await checkHealth('http://127.0.0.1:' + port);
    if (currentHealth.ok && serverProcess) return currentHealth;
    if (currentHealth.ok && !serverProcess) return { ...currentHealth, external: true };
    if (startingServerPromise) return startingServerPromise;
    if (serverProcess) {
      startingServerPromise = waitForReady().finally(() => {
        startingServerPromise = null;
      });
      return startingServerPromise;
    }

    if (!fs.existsSync(bundledServerEntry)) {
      return { ok: false, error: 'Bundled server not found: ' + bundledServerEntry };
    }

    fs.mkdirSync(config.localLibraryPath, { recursive: true });
    activeLocalServerConfig = config;
    serverProcess = spawn(nodeExe, [bundledServerEntry], {
      cwd: bundledServerDir,
      env: localServerEnv(config),
      windowsHide: true,
    });

    serverProcess.stdout.on('data', (data) => console.log('[forart-server] ' + data));
    serverProcess.stderr.on('data', (data) => console.error('[forart-server] ' + data));
    serverProcess.on('exit', (code) => {
      console.log('[forart-server] exited ' + code);
      serverProcess = null;
      startingServerPromise = null;
    });

    startingServerPromise = waitForReady().finally(() => {
      startingServerPromise = null;
    });
    return startingServerPromise;
  }

  function stop() {
    if (serverProcess) {
      serverProcess.kill();
      serverProcess = null;
    }
    activeLocalServerConfig = null;
    startingServerPromise = null;
  }

  async function localStatus() {
    const health = await checkHealth('http://127.0.0.1:' + port);
    return {
      ...health,
      managed: Boolean(serverProcess),
      localLibraryPath: activeLocalServerConfig?.localLibraryPath || '',
    };
  }

  return { checkHealth, ensure, localStatus, stop };
}

module.exports = { createLocalServerManager };
