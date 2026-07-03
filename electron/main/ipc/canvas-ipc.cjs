function registerCanvasIpc({ ipcMain, app, canvasStore, assetStore, canvasPackageStore, generationTaskStore, imageGenerationRunner }) {
  ipcMain.handle('save-result', async (_event, payload) => assetStore.saveResult(payload, app.getPath('downloads')));
  ipcMain.handle('canvas:list', async () => ({ canvases: canvasStore.listCanvases(), projects: canvasStore.listProjects() }));
  ipcMain.handle('canvas:create', async (_event, payload) => canvasStore.createCanvas(payload));
  ipcMain.handle('canvas:create-project', async (_event, payload) => canvasStore.createProject(payload));
  ipcMain.handle('canvas:load', async (_event, canvasId) => canvasStore.readCanvas(canvasId));
  ipcMain.handle('canvas:save', async (_event, canvasId, payload) => canvasStore.saveCanvas(canvasId, payload));
  ipcMain.handle('canvas:update-meta', async (_event, canvasId, patch) => canvasStore.updateCanvasMeta(canvasId, patch));
  ipcMain.handle('canvas:update-project', async (_event, projectId, patch) => canvasStore.updateProject(projectId, patch));
  ipcMain.handle('canvas:delete', async (_event, canvasId) => canvasStore.deleteCanvas(canvasId));
  ipcMain.handle('canvas:delete-project', async (_event, projectId) => canvasStore.deleteProject(projectId));
  ipcMain.handle('canvas:move-to-project', async (_event, canvasId, projectId) => canvasStore.moveCanvasToProject(canvasId, projectId));
  ipcMain.handle('canvas:export-json', async (_event, canvasId) => canvasPackageStore.exportJson(canvasId));
  ipcMain.handle('canvas:export-package', async (_event, canvasId) => canvasPackageStore.exportPackage(canvasId));
  ipcMain.handle('canvas:import', async (_event, payload) => canvasPackageStore.importCanvas(payload));
  ipcMain.handle('canvas:create-package-for-upload', async (_event, canvasId) => canvasPackageStore.createPackageForUpload(canvasId));
  ipcMain.handle('canvas:import-package-from-path', async (_event, payload = {}) => canvasPackageStore.importPackageFile(payload.filePath, payload.projectId));
  ipcMain.handle('canvas:upload-package-to-remote', async (_event, payload = {}) => canvasPackageStore.uploadPackageToRemote(payload));
  ipcMain.handle('canvas:download-package-from-remote', async (_event, payload = {}) => canvasPackageStore.downloadPackageFromRemote(payload));
  ipcMain.handle('canvas:save-asset', async (_event, payload) => assetStore.saveAsset(payload));
  ipcMain.handle('generation-tasks:get', async (_event, taskId) => generationTaskStore.getTask(taskId));
  ipcMain.handle('generation-tasks:create', async (_event, payload) => imageGenerationRunner.startTask(payload));
  ipcMain.handle('generation-tasks:update', async (_event, taskId, patch) => generationTaskStore.updateTask(taskId, patch));
  ipcMain.handle('generation-tasks:resume', async (_event, taskId, payload) => imageGenerationRunner.resumeTask(taskId, payload));
  ipcMain.handle('generation-tasks:stop', async (_event, taskId) => imageGenerationRunner.stopTask(taskId));
  ipcMain.handle('generation-tasks:stop-for-target', async (_event, canvasId, target) => imageGenerationRunner.stopTasksForTarget(canvasId, target));
  ipcMain.handle('generation-tasks:stop-for-node', async (_event, canvasId, nodeId) => imageGenerationRunner.stopTasksForNode(canvasId, nodeId));
  ipcMain.handle('generation-tasks:stop-for-canvas', async (_event, canvasId) => imageGenerationRunner.stopTasksForCanvas(canvasId));
}

module.exports = { registerCanvasIpc };
