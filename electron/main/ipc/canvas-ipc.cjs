const ACTIVE_GENERATION_STATUSES = new Set([
  'queued',
  'preparing',
  'submitting',
  'running',
  'result_processing',
]);

async function stopGenerationTasks(tasks, generationTaskService) {
  const taskIds = [...new Set((Array.isArray(tasks) ? tasks : [])
    .map((task) => String(task?.id || task?.taskId || '').trim())
    .filter(Boolean))];
  if (!taskIds.length || !generationTaskService?.stopTask) return [];
  return Promise.allSettled(taskIds.map((taskId) => (
    Promise.resolve().then(() => generationTaskService.stopTask(taskId))
  )));
}

async function stopMissingGenerationTargets(canvasId, canvasStore, generationTaskService) {
  if (!generationTaskService?.listTasksForCanvas || !canvasStore?.findMissingGenerationTargets) return [];
  const tasks = await Promise.resolve(generationTaskService.listTasksForCanvas(canvasId));
  const activeTasks = (Array.isArray(tasks) ? tasks : [])
    .filter((task) => ACTIVE_GENERATION_STATUSES.has(String(task?.status || '')))
    .map((task) => ({
      ...task,
      canvasId: String(task?.target?.canvasId || canvasId || ''),
      target: {
        ...(task?.target || {}),
        type: task?.target?.kind || task?.target?.type,
      },
    }));
  return stopGenerationTasks(canvasStore.findMissingGenerationTargets(activeTasks), generationTaskService);
}

function registerCanvasIpc({ ipcMain, app, canvasStore, assetStore, canvasPackageStore, generationTaskService }) {
  const canvasSaveSessions = new Map();
  ipcMain.handle('save-result', async (_event, payload) => assetStore.saveResult(payload, app.getPath('downloads')));
  ipcMain.handle('canvas:list', async () => ({ canvases: canvasStore.listCanvases(), projects: canvasStore.listProjects() }));
  ipcMain.handle('canvas:create', async (_event, payload) => canvasStore.createCanvas(payload));
  ipcMain.handle('canvas:create-project', async (_event, payload) => canvasStore.createProject(payload));
  ipcMain.handle('canvas:load', async (_event, canvasId) => canvasStore.readCanvas(canvasId));
  ipcMain.handle('canvas:save', async (_event, canvasId, payload = {}) => {
    const sessionId = String(payload.saveSessionId || '').trim();
    const sessionStartedAt = Number(payload.saveSessionStartedAt || 0);
    const saveSequence = Number(payload.saveSequence || 0);
    const previous = canvasSaveSessions.get(String(canvasId || ''));
    if (sessionId && previous) {
      const olderSession = sessionStartedAt > 0 && previous.startedAt > sessionStartedAt;
      const staleSequence = previous.sessionId === sessionId && saveSequence > 0 && previous.sequence >= saveSequence;
      if (olderSession || staleSequence) return { ok: true, skipped: true, stale: true };
    }
    // Task runners persist active anchors and terminal results directly.
    // A regular canvas save must not replay in-memory task state.
    const result = canvasStore.saveCanvas(canvasId, payload);
    try {
      await stopMissingGenerationTargets(canvasId, canvasStore, generationTaskService);
    } catch (error) {
      console.error('Generation target reconciliation failed after canvas save:', error);
    }
    if (sessionId) {
      canvasSaveSessions.set(String(canvasId || ''), {
        sessionId,
        startedAt: sessionStartedAt,
        sequence: saveSequence,
      });
    }
    return result;
  });
  ipcMain.handle('canvas:update-meta', async (_event, canvasId, patch) => canvasStore.updateCanvasMeta(canvasId, patch));
  ipcMain.handle('canvas:update-project', async (_event, projectId, patch) => canvasStore.updateProject(projectId, patch));
  ipcMain.handle('canvas:delete', async (_event, canvasId) => {
    try {
      const tasks = generationTaskService?.listTasksForCanvas
        ? await Promise.resolve(generationTaskService.listTasksForCanvas(canvasId))
        : [];
      await stopGenerationTasks(
        (Array.isArray(tasks) ? tasks : []).filter((task) => ACTIVE_GENERATION_STATUSES.has(String(task?.status || ''))),
        generationTaskService,
      );
    } catch (error) {
      console.error('Generation task stop failed before canvas deletion:', error);
    }
    return canvasStore.deleteCanvas(canvasId);
  });
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
  ipcMain.handle('canvas:save-asset-thumbnail', async (_event, payload) => assetStore.saveAssetThumbnail(payload));
  ipcMain.handle('canvas:ensure-asset-thumbnail', async (_event, payload) => assetStore.ensureAssetThumbnail(payload));
  ipcMain.handle('canvas:crop-asset', async (_event, payload) => assetStore.cropAsset(payload));
}

module.exports = { registerCanvasIpc, stopMissingGenerationTargets };
