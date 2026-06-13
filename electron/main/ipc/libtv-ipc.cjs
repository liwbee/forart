function registerLibtvIpc({ ipcMain, libtv }) {
  ipcMain.handle('libtv:status', async () => libtv.status());
  ipcMain.handle('libtv:install', async () => libtv.install());
  ipcMain.handle('libtv:image-models', async () => libtv.imageModels());
  ipcMain.handle('libtv:search-projects', async (_event, payload = {}) => libtv.searchProjects(payload));
  ipcMain.handle('libtv:account', async () => libtv.account());
  ipcMain.handle('libtv:accounts', async () => libtv.accounts());
  ipcMain.handle('libtv:account-use', async (_event, account) => libtv.useAccount(account));
  ipcMain.handle('libtv:login-web', async () => libtv.loginWeb());
  ipcMain.handle('libtv:logout', async () => libtv.logout());
  ipcMain.handle('libtv:import-project', async (_event, projectId) => {
    const id = String(projectId || '').trim();
    if (!id) throw new Error('LibTV project id is required.');
    return libtv.importProject(id, (payload) => {
      _event.sender.send('libtv:import-progress', payload);
    });
  });
  ipcMain.handle('libtv:sync-node', async (_event, payload = {}) => {
    const projectId = String(payload.projectId || '').trim();
    const nodeId = String(payload.nodeId || '').trim();
    if (!projectId || !nodeId) throw new Error('LibTV project id and node id are required.');
    return libtv.syncNode(projectId, nodeId);
  });
  ipcMain.handle('libtv:update-node', async (_event, payload = {}) => {
    const projectId = String(payload.projectId || '').trim();
    const nodeId = String(payload.nodeId || '').trim();
    if (!projectId || !nodeId) throw new Error('LibTV project id and node id are required.');
    return libtv.updateNode(projectId, nodeId, payload);
  });
  ipcMain.handle('libtv:create-node', async (_event, payload = {}) => {
    const projectId = String(payload.projectId || '').trim();
    const type = String(payload.type || '').trim();
    if (!projectId || !type) throw new Error('LibTV project id and node type are required.');
    return libtv.createNode(projectId, payload);
  });
  ipcMain.handle('libtv:delete-node', async (_event, payload = {}) => {
    const projectId = String(payload.projectId || '').trim();
    const nodeId = String(payload.nodeId || '').trim();
    if (!projectId || !nodeId) throw new Error('LibTV project id and node id are required.');
    return libtv.deleteNode(projectId, payload);
  });
  ipcMain.handle('libtv:upload-node', async (_event, payload = {}) => {
    const projectId = String(payload.projectId || '').trim();
    const filePath = String(payload.filePath || '').trim();
    if (!projectId || !filePath) throw new Error('LibTV project id and upload file are required.');
    return libtv.uploadNode(projectId, filePath, payload);
  });
  ipcMain.handle('libtv:run-image-node', async (_event, payload = {}) => {
    const projectId = String(payload.projectId || '').trim();
    const nodeId = String(payload.nodeId || '').trim();
    if (!projectId || !nodeId) throw new Error('LibTV project id and node id are required.');
    return libtv.runImageNode(projectId, nodeId);
  });
}

module.exports = { registerLibtvIpc };
