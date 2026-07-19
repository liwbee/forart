function registerGenerationTaskIpc({ ipcMain, generationTaskService, getWebContents }) {
  ipcMain.handle('generation-task-system:get', async (_event, taskId) => generationTaskService.getTask(taskId));
  ipcMain.handle('generation-task-system:get-many', async (_event, taskIds = []) => (
    (Array.isArray(taskIds) ? taskIds : [])
      .map((taskId) => generationTaskService.getTask(taskId))
      .filter(Boolean)
  ));
  ipcMain.handle('generation-task-system:list-for-canvas', async (_event, canvasId) => (
    generationTaskService.listTasksForCanvas(canvasId)
  ));
  ipcMain.handle('generation-task-system:list-recent', async (_event, limit) => (
    generationTaskService.listRecentTasks(limit)
  ));
  ipcMain.handle('generation-task-system:start', async (_event, executorKind, payload) => {
    const task = await generationTaskService.startTask(executorKind, payload);
    return task?.id ? generationTaskService.getTask(task.id) : null;
  });
  ipcMain.handle('generation-task-system:start-many', async (_event, executorKind, payloads) => {
    const tasks = await generationTaskService.startTasks(executorKind, payloads);
    return (Array.isArray(tasks) ? tasks : [])
      .map((task) => task?.id ? generationTaskService.getTask(task.id) : null)
      .filter(Boolean);
  });
  ipcMain.handle('generation-task-system:stop', async (_event, taskId) => generationTaskService.stopTask(taskId));

  return generationTaskService.subscribe((task) => {
    const webContents = getWebContents?.();
    if (!webContents || webContents.isDestroyed?.()) return;
    webContents.send('generation-task:changed', task);
  });
}

module.exports = { registerGenerationTaskIpc };
