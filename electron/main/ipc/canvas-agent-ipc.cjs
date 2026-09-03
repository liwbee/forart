const SENSITIVE_KEYS = new Set(['apikey', 'accesskey', 'secretkey', 'authorization']);

function assertNoSecrets(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item) => assertNoSecrets(item, seen));
    return;
  }
  Object.entries(value).forEach(([key, nested]) => {
    if (SENSITIVE_KEYS.has(key.replace(/[^a-z0-9]/gi, '').toLowerCase())) {
      throw new Error('Canvas Agent request contains a secret field.');
    }
    assertNoSecrets(nested, seen);
  });
}

function registerCanvasAgentIpc({ ipcMain, canvasAgentRuntime }) {
  ipcMain.handle('canvas-agent:run', async (event, request = {}) => {
    assertNoSecrets(request);
    return canvasAgentRuntime.run(request, (progress) => {
      if (!event.sender.isDestroyed?.()) event.sender.send('canvas-agent:progress', progress);
    });
  });

  ipcMain.handle('canvas-agent:cancel', async (_event, runId) => canvasAgentRuntime.cancel(runId));
  ipcMain.handle('canvas-agent:list-active', async (_event, canvasId) => canvasAgentRuntime.listActive(canvasId));
}

module.exports = { registerCanvasAgentIpc };
