function registerCanvasTaskIpc({ ipcMain, repository }) {
  ipcMain.handle('canvas-task:list-page', async (_event, payload = {}) => repository.listPage({
    ...payload,
    category: 'image',
  }));
}

module.exports = { registerCanvasTaskIpc };
