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
  const canvasTransferJobs = new Map();
  const runCanvasTransfer = async (event, operationId, transferType, work) => {
    const id = String(operationId || '').trim();
    const controller = new AbortController();
    if (id) {
      canvasTransferJobs.get(id)?.abort();
      canvasTransferJobs.set(id, controller);
    }
    const onProgress = (progress) => {
      if (!id || event.sender.isDestroyed()) return;
      event.sender.send('canvas:transfer-progress', {
        operationId: id,
        transferType,
        ...progress,
      });
    };
    try {
      return await work({ signal: controller.signal, onProgress });
    } finally {
      if (id && canvasTransferJobs.get(id) === controller) canvasTransferJobs.delete(id);
    }
  };
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
  ipcMain.handle('canvas:export-json', async (event, canvasId, operationId) => (
    runCanvasTransfer(event, operationId, 'export', (options) => canvasPackageStore.exportJson(canvasId, options))
  ));
  ipcMain.handle('canvas:export-package', async (event, canvasId, operationId) => (
    runCanvasTransfer(event, operationId, 'export', (options) => canvasPackageStore.exportPackage(canvasId, options))
  ));
  ipcMain.handle('canvas:import', async (event, payload = {}) => (
    runCanvasTransfer(event, payload.operationId, 'import', (options) => canvasPackageStore.importCanvas(payload, options))
  ));
  ipcMain.handle('canvas:create-package-for-upload', async (event, canvasId, operationId) => (
    runCanvasTransfer(event, operationId, 'upload', (options) => canvasPackageStore.createPackageForUpload(canvasId, {
      ...options,
      rangeStart: 0,
      rangeEnd: 55,
    }))
  ));
  ipcMain.handle('canvas:import-package-from-path', async (event, payload = {}) => (
    runCanvasTransfer(event, payload.operationId, 'import', (options) => canvasPackageStore.importPackageFile(payload.filePath, payload.projectId, {
      ...options,
      rangeStart: payload.operationId ? 50 : 0,
      rangeEnd: 100,
    }))
  ));
  ipcMain.handle('canvas:upload-package-to-remote', async (event, payload = {}) => (
    runCanvasTransfer(event, payload.operationId, 'upload', (options) => canvasPackageStore.uploadPackageToRemote(payload, {
      ...options,
      rangeStart: 55,
      rangeEnd: 100,
    }))
  ));
  ipcMain.handle('canvas:download-package-from-remote', async (event, payload = {}) => (
    runCanvasTransfer(event, payload.operationId, 'import', (options) => canvasPackageStore.downloadPackageFromRemote(payload, {
      ...options,
      rangeStart: 0,
      rangeEnd: 50,
    }))
  ));
  ipcMain.handle('canvas:cancel-transfer', async (_event, operationId) => {
    const controller = canvasTransferJobs.get(String(operationId || '').trim());
    controller?.abort();
    return { ok: true, canceled: Boolean(controller) };
  });
  ipcMain.handle('canvas:save-asset', async (_event, payload) => assetStore.saveAsset(payload));
  ipcMain.handle('canvas:save-asset-thumbnail', async (_event, payload) => assetStore.saveAssetThumbnail(payload));
  ipcMain.handle('canvas:ensure-asset-thumbnail', async (_event, payload) => assetStore.ensureAssetThumbnail(payload));
  ipcMain.handle('canvas:crop-asset', async (_event, payload) => assetStore.cropAsset(payload));
}

module.exports = { registerCanvasIpc, stopMissingGenerationTargets };
