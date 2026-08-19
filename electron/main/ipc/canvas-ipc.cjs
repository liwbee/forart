const ACTIVE_GENERATION_STATUSES = new Set([
  'queued',
  'preparing',
  'uploading',
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
  const listTargets = generationTaskService?.listActiveTaskRefsForCanvas
    || generationTaskService?.listActiveTasksForCanvas;
  if (!listTargets || !canvasStore?.findMissingGenerationTargets) return [];
  const tasks = await Promise.resolve(listTargets.call(generationTaskService, canvasId));
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
  const heads = generationTaskService?.listTargetHeadsForCanvas
    ? await Promise.resolve(generationTaskService.listTargetHeadsForCanvas(canvasId))
    : [];
  const missingTargets = canvasStore.findMissingGenerationTargets([...activeTasks, ...heads]);
  const stopResults = await stopGenerationTasks(
    missingTargets.filter((target) => ACTIVE_GENERATION_STATUSES.has(String(target?.status || ''))),
    generationTaskService,
  );
  const missingHeadKeys = [...new Set(missingTargets.map((target) => String(target?.targetKey || '').trim()).filter(Boolean))];
  if (missingHeadKeys.length) generationTaskService?.removeTargetHeads?.(missingHeadKeys);
  return stopResults;
}

function registerCanvasIpc({ ipcMain, app, canvasStore, assetStore, canvasPackageStore, generationTaskService }) {
  const canvasSaveSessions = new Map();
  const canvasSaveQueues = new Map();
  const pendingTargetReconciliations = new Map();
  const canvasTransferJobs = new Map();
  const scheduleMissingGenerationTargetReconciliation = (canvasId) => {
    const key = String(canvasId || '').trim();
    if (!key) return;
    const pending = pendingTargetReconciliations.get(key);
    if (pending) {
      // A save can happen while the previous reconciliation is reading the
      // canvas. Do not drop that save: the completed pass must be followed by
      // one more pass against the newest canvas snapshot.
      pending.rerun = true;
      return;
    }
    const state = { rerun: false };
    pendingTargetReconciliations.set(key, state);
    const run = () => {
      void stopMissingGenerationTargets(key, canvasStore, generationTaskService).catch((error) => {
        console.error('Generation target reconciliation failed after canvas save:', error);
      }).finally(() => {
        if (state.rerun) {
          state.rerun = false;
          setImmediate(run);
          return;
        }
        if (pendingTargetReconciliations.get(key) === state) pendingTargetReconciliations.delete(key);
      });
    };
    setImmediate(run);
  };
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
    const key = String(canvasId || '');
    const preceding = canvasSaveQueues.get(key) || Promise.resolve();
    const operation = preceding.catch(() => undefined).then(async () => {
      const sessionId = String(payload.saveSessionId || '').trim();
      const sessionStartedAt = Number(payload.saveSessionStartedAt || 0);
      const saveSequence = Number(payload.saveSequence || 0);
      const previous = canvasSaveSessions.get(key);
      if (sessionId && previous) {
        const olderSession = sessionStartedAt > 0 && previous.startedAt > sessionStartedAt;
        const staleSequence = previous.sessionId === sessionId && saveSequence > 0 && previous.sequence >= saveSequence;
        if (olderSession || staleSequence) return { ok: true, skipped: true, stale: true };
      }
      // Task runners persist active anchors and terminal results directly.
      // A regular canvas save must not replay in-memory task state.
      const result = await canvasStore.saveCanvasText(canvasId, payload);
      // Reconciliation is deliberately outside the save response path. It uses
      // the lightweight active-target index and can safely lag because result
      // commits reject missing canvas targets as a second line of defense.
      scheduleMissingGenerationTargetReconciliation(canvasId);
      if (sessionId) {
        canvasSaveSessions.set(key, {
          sessionId,
          startedAt: sessionStartedAt,
          sequence: saveSequence,
        });
      }
      return {
        ok: result?.ok !== false,
        ...(result?.record ? { record: result.record } : {}),
      };
    });
    canvasSaveQueues.set(key, operation);
    try {
      return await operation;
    } finally {
      if (canvasSaveQueues.get(key) === operation) canvasSaveQueues.delete(key);
    }
  });
  ipcMain.handle('canvas:update-meta', async (_event, canvasId, patch) => canvasStore.updateCanvasMeta(canvasId, patch));
  ipcMain.handle('canvas:update-project', async (_event, projectId, patch) => canvasStore.updateProject(projectId, patch));
  ipcMain.handle('canvas:delete', async (_event, canvasId) => {
    try {
      const listTasks = generationTaskService?.listActiveTaskRefsForCanvas
        || generationTaskService?.listActiveTasksForCanvas;
      const tasks = listTasks
        ? await Promise.resolve(listTasks.call(generationTaskService, canvasId))
        : [];
      await stopGenerationTasks(
        (Array.isArray(tasks) ? tasks : []).filter((task) => ACTIVE_GENERATION_STATUSES.has(String(task?.status || ''))),
        generationTaskService,
      );
    } catch (error) {
      console.error('Generation task stop failed before canvas deletion:', error);
    }
    const result = canvasStore.deleteCanvas(canvasId);
    try {
      generationTaskService?.removeTargetHeadsForCanvas?.(canvasId);
    } catch (error) {
      console.error('Generation target head cleanup failed after canvas deletion:', error);
    }
    return result;
  });
  ipcMain.handle('canvas:delete-project', async (_event, projectId) => {
    const canvasIds = (canvasStore.listCanvases?.() || [])
      .filter((canvas) => String(canvas?.projectId || '') === String(projectId || ''))
      .map((canvas) => String(canvas.id || ''))
      .filter(Boolean);
    try {
      const listTasks = generationTaskService?.listActiveTaskRefsForCanvas
        || generationTaskService?.listActiveTasksForCanvas;
      if (listTasks) {
        const taskGroups = await Promise.all(canvasIds.map((canvasId) => (
          Promise.resolve(listTasks.call(generationTaskService, canvasId))
        )));
        await stopGenerationTasks(taskGroups.flat(), generationTaskService);
      }
    } catch (error) {
      console.error('Generation task stop failed before canvas project deletion:', error);
    }
    const result = await canvasStore.deleteProject(projectId);
    for (const canvasId of result?.deletedCanvasIds || canvasIds) {
      try {
        generationTaskService?.removeTargetHeadsForCanvas?.(canvasId);
      } catch (error) {
        console.error('Generation target head cleanup failed after canvas project deletion:', error);
      }
    }
    return result;
  });
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
  ipcMain.handle('canvas:upload-to-remote', async (event, payload = {}) => (
    runCanvasTransfer(event, payload.operationId, 'upload', (options) => canvasPackageStore.uploadCanvasToRemote(payload, options))
  ));
  ipcMain.handle('canvas:download-package-from-remote', async (event, payload = {}) => (
    runCanvasTransfer(event, payload.operationId, 'import', (options) => canvasPackageStore.downloadPackageFromRemote(payload, {
      ...options,
      rangeStart: 0,
      rangeEnd: 50,
    }))
  ));
  ipcMain.handle('canvas:copy-remote-to-local', async (event, payload = {}) => (
    runCanvasTransfer(event, payload.operationId, 'import', (options) => canvasPackageStore.copyRemoteCanvasToLocal(payload, options))
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
