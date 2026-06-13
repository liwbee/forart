function registerLovartIpc({ ipcMain, lovartClient }) {
  ipcMain.handle('lovart:generate', async (_event, payload) => lovartClient.generate(payload));
  ipcMain.handle('lovart:test', async (_event, payload) => lovartClient.testConnection(payload));
  ipcMain.handle('lovart:status', async (_event, payload) => lovartClient.status(payload));
}

module.exports = { registerLovartIpc };
