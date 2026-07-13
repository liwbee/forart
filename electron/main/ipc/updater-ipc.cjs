function registerUpdaterIpc({ ipcMain, updater }) {
  ipcMain.handle('app:info', async () => updater.appInfo());

  ipcMain.handle('app:check-update', async () => updater.check());

  ipcMain.handle('app:run-update', async (event) => updater.run({
    onProgress: (payload) => event.sender.send('app:update-progress', payload),
  }));

  ipcMain.handle('app:update-connectivity', async () => updater.checkConnectivity());
}

module.exports = { registerUpdaterIpc };
