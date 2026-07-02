function registerLibtvIpc({ ipcMain, libtv, libtvGenerationRunner }) {
  ipcMain.handle('libtv:status', async () => libtv.status());
  ipcMain.handle('libtv:install', async () => libtv.install());
  ipcMain.handle('libtv:account', async () => libtv.account());
  ipcMain.handle('libtv:accounts', async () => libtv.accounts());
  ipcMain.handle('libtv:account-use', async (_event, account) => libtv.useAccount(account));
  ipcMain.handle('libtv:login-web', async () => libtv.loginWeb());
  ipcMain.handle('libtv:logout', async () => libtv.logout());
  ipcMain.handle('libtv:workspaces', async (_event, payload) => libtv.listWorkspaces(payload));
  ipcMain.handle('libtv:projects', async (_event, payload) => libtv.listProjects(payload));
  ipcMain.handle('libtv:image-models', async () => libtv.imageModels());
  ipcMain.handle('libtv:generate-image', async (_event, payload) => libtvGenerationRunner.generateImage(payload));
  ipcMain.handle('libtv:generate-batch', async (_event, payload) => libtvGenerationRunner.generateBatch(payload));
}

module.exports = { registerLibtvIpc };
