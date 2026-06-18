const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('easyTool', {
  saveResult: (payload) => ipcRenderer.invoke('save-result', payload),
  listCanvases: () => ipcRenderer.invoke('canvas:list'),
  createCanvas: (payload) => ipcRenderer.invoke('canvas:create', payload),
  loadCanvasProject: (canvasId) => ipcRenderer.invoke('canvas:load-project', canvasId),
  saveCanvasProject: (canvasId, payload) => ipcRenderer.invoke('canvas:save-project', canvasId, payload),
  updateCanvasMeta: (canvasId, patch) => ipcRenderer.invoke('canvas:update-meta', canvasId, patch),
  deleteCanvas: (canvasId) => ipcRenderer.invoke('canvas:delete-project', canvasId),
  saveCanvasAsset: (payload) => ipcRenderer.invoke('canvas:save-asset', payload),
});

contextBridge.exposeInMainWorld('forartConfig', {
  load: () => ipcRenderer.invoke('config:load'),
  save: (payload) => ipcRenderer.invoke('config:save', payload),
  loadApiSettings: () => ipcRenderer.invoke('config:load-api-settings'),
  saveApiSettings: (payload) => ipcRenderer.invoke('config:save-api-settings', payload),
  chooseDirectory: (payload) => ipcRenderer.invoke('dialog:choose-directory', payload),
  testServer: (serverUrl) => ipcRenderer.invoke('server:test-remote', serverUrl),
  localServerStatus: () => ipcRenderer.invoke('server:local-status'),
  appInfo: () => ipcRenderer.invoke('app:info'),
  checkUpdate: () => ipcRenderer.invoke('app:check-update'),
  runUpdate: () => ipcRenderer.invoke('app:run-update'),
  openUpdatePage: () => ipcRenderer.invoke('app:open-update-page'),
});

contextBridge.exposeInMainWorld('forartReview', {
  products: (payload) => ipcRenderer.invoke('image-review:products', payload),
  productImages: (payload) => ipcRenderer.invoke('image-review:product-images', payload),
  loadIssue: (payload) => ipcRenderer.invoke('image-review:load-issue', payload),
  saveIssue: (payload) => ipcRenderer.invoke('image-review:save-issue', payload),
});

contextBridge.exposeInMainWorld('libtv', {
  status: () => ipcRenderer.invoke('libtv:status'),
  install: () => ipcRenderer.invoke('libtv:install'),
  account: () => ipcRenderer.invoke('libtv:account'),
  accounts: () => ipcRenderer.invoke('libtv:accounts'),
  useAccount: (account) => ipcRenderer.invoke('libtv:account-use', account),
  loginWeb: () => ipcRenderer.invoke('libtv:login-web'),
  logout: () => ipcRenderer.invoke('libtv:logout'),
  imageModels: () => ipcRenderer.invoke('libtv:image-models'),
  searchProjects: (payload) => ipcRenderer.invoke('libtv:search-projects', payload),
  importProject: (projectId) => ipcRenderer.invoke('libtv:import-project', projectId),
  onImportProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('libtv:import-progress', listener);
    return () => ipcRenderer.removeListener('libtv:import-progress', listener);
  },
  createNode: (payload) => ipcRenderer.invoke('libtv:create-node', payload),
  deleteNode: (payload) => ipcRenderer.invoke('libtv:delete-node', payload),
  runImageNode: (payload) => ipcRenderer.invoke('libtv:run-image-node', payload),
  updateNode: (payload) => ipcRenderer.invoke('libtv:update-node', payload),
  uploadNode: (payload) => ipcRenderer.invoke('libtv:upload-node', payload),
  syncNode: (payload) => ipcRenderer.invoke('libtv:sync-node', payload),
});
