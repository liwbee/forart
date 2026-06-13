function registerCanvasIpc({ ipcMain, app, canvasStore, assetStore }) {
  ipcMain.handle('save-result', async (_event, payload) => assetStore.saveResult(payload, app.getPath('downloads')));
  ipcMain.handle('canvas:list', async () => ({ canvases: canvasStore.listProjects() }));
  ipcMain.handle('canvas:create', async (_event, payload) => canvasStore.createProject(payload));
  ipcMain.handle('canvas:load-project', async (_event, canvasId) => canvasStore.readProject(canvasId));
  ipcMain.handle('canvas:save-project', async (_event, canvasId, payload) => canvasStore.saveProject(canvasId, payload));
  ipcMain.handle('canvas:update-meta', async (_event, canvasId, patch) => canvasStore.updateMeta(canvasId, patch));
  ipcMain.handle('canvas:delete-project', async (_event, canvasId) => canvasStore.deleteProject(canvasId));
  ipcMain.handle('canvas:save-asset', async (_event, payload) => assetStore.saveAsset(payload));
}

module.exports = { registerCanvasIpc };
