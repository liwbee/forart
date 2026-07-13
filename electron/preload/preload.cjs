const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('forartWindow', {
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  onMaximizedChanged: (callback) => {
    const listener = (_event, maximized) => callback(Boolean(maximized));
    ipcRenderer.on('window:maximized-changed', listener);
    return () => ipcRenderer.removeListener('window:maximized-changed', listener);
  },
});

contextBridge.exposeInMainWorld('easyTool', {
  saveResult: (payload) => ipcRenderer.invoke('save-result', payload),
  listCanvases: () => ipcRenderer.invoke('canvas:list'),
  createCanvas: (payload) => ipcRenderer.invoke('canvas:create', payload),
  createCanvasProject: (payload) => ipcRenderer.invoke('canvas:create-project', payload),
  loadCanvas: (canvasId) => ipcRenderer.invoke('canvas:load', canvasId),
  saveCanvas: (canvasId, payload) => ipcRenderer.invoke('canvas:save', canvasId, payload),
  updateCanvasMeta: (canvasId, patch) => ipcRenderer.invoke('canvas:update-meta', canvasId, patch),
  updateCanvasProject: (projectId, patch) => ipcRenderer.invoke('canvas:update-project', projectId, patch),
  deleteCanvas: (canvasId) => ipcRenderer.invoke('canvas:delete', canvasId),
  deleteCanvasProject: (projectId) => ipcRenderer.invoke('canvas:delete-project', projectId),
  moveCanvasToProject: (canvasId, projectId) => ipcRenderer.invoke('canvas:move-to-project', canvasId, projectId),
  exportCanvasJson: (canvasId) => ipcRenderer.invoke('canvas:export-json', canvasId),
  exportCanvasPackage: (canvasId) => ipcRenderer.invoke('canvas:export-package', canvasId),
  importCanvas: (payload) => ipcRenderer.invoke('canvas:import', payload),
  createCanvasPackageForUpload: (canvasId) => ipcRenderer.invoke('canvas:create-package-for-upload', canvasId),
  importCanvasPackageFromPath: (payload) => ipcRenderer.invoke('canvas:import-package-from-path', payload),
  uploadCanvasPackageToRemote: (payload) => ipcRenderer.invoke('canvas:upload-package-to-remote', payload),
  downloadCanvasPackageFromRemote: (payload) => ipcRenderer.invoke('canvas:download-package-from-remote', payload),
  saveCanvasAsset: (payload) => ipcRenderer.invoke('canvas:save-asset', payload),
  saveCanvasAssetThumbnail: (payload) => ipcRenderer.invoke('canvas:save-asset-thumbnail', payload),
  ensureCanvasAssetThumbnail: (payload) => ipcRenderer.invoke('canvas:ensure-asset-thumbnail', payload),
  cropCanvasAsset: (payload) => ipcRenderer.invoke('canvas:crop-asset', payload),
  scanCanvasCache: () => ipcRenderer.invoke('canvas-cache:scan'),
  deleteCanvasCacheAssets: (payload) => ipcRenderer.invoke('canvas-cache:delete', payload),
  revealCanvasCacheAsset: (payload) => ipcRenderer.invoke('canvas-cache:reveal', payload),
  openCanvasCacheRoot: () => ipcRenderer.invoke('canvas-cache:open-root'),
  getGenerationTask: (taskId) => ipcRenderer.invoke('generation-tasks:get', taskId),
  createGenerationTask: (payload) => ipcRenderer.invoke('generation-tasks:create', payload),
  updateGenerationTask: (taskId, patch) => ipcRenderer.invoke('generation-tasks:update', taskId, patch),
  resumeGenerationTask: (taskId, payload) => ipcRenderer.invoke('generation-tasks:resume', taskId, payload),
  recoverGenerationTask: (payload) => ipcRenderer.invoke('generation-tasks:recover', payload),
  recoverCanvasGenerationTasks: (payload) => ipcRenderer.invoke('generation-tasks:recover-canvases', payload),
  stopGenerationTask: (taskId) => ipcRenderer.invoke('generation-tasks:stop', taskId),
  stopGenerationTasksForTarget: (canvasId, target) => ipcRenderer.invoke('generation-tasks:stop-for-target', canvasId, target),
  stopGenerationTasksForNode: (canvasId, nodeId) => ipcRenderer.invoke('generation-tasks:stop-for-node', canvasId, nodeId),
  stopGenerationTasksForCanvas: (canvasId) => ipcRenderer.invoke('generation-tasks:stop-for-canvas', canvasId),
  writeCanvasClipboard: (payload) => ipcRenderer.invoke('canvas:write-clipboard', payload),
});

contextBridge.exposeInMainWorld('forartConfig', {
  load: () => ipcRenderer.invoke('config:load'),
  save: (payload) => ipcRenderer.invoke('config:save', payload),
  loadApiSettings: () => ipcRenderer.invoke('config:load-api-settings'),
  saveApiSettings: (payload) => ipcRenderer.invoke('config:save-api-settings', payload),
  loadImageReviewSettings: () => ipcRenderer.invoke('config:load-image-review-settings'),
  saveImageReviewSettings: (payload) => ipcRenderer.invoke('config:save-image-review-settings', payload),
  defaultPaths: () => ipcRenderer.invoke('config:default-paths'),
  chooseDirectory: (payload) => ipcRenderer.invoke('dialog:choose-directory', payload),
  testServer: (serverUrl) => ipcRenderer.invoke('server:test-remote', serverUrl),
  localServerStatus: () => ipcRenderer.invoke('server:local-status'),
  appInfo: () => ipcRenderer.invoke('app:info'),
  checkUpdate: () => ipcRenderer.invoke('app:check-update'),
  runUpdate: () => ipcRenderer.invoke('app:run-update'),
  onUpdateProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('app:update-progress', listener);
    return () => ipcRenderer.removeListener('app:update-progress', listener);
  },
  updateConnectivity: () => ipcRenderer.invoke('app:update-connectivity'),
});

contextBridge.exposeInMainWorld('forartReview', {
  chooseRoot: (payload) => ipcRenderer.invoke('image-review:choose-root', payload),
  products: (payload) => ipcRenderer.invoke('image-review:products', payload),
  productImages: (payload) => ipcRenderer.invoke('image-review:product-images', payload),
});

contextBridge.exposeInMainWorld('forartActionImport', {
  chooseFolder: (payload) => ipcRenderer.invoke('action-import:choose-folder', payload),
  scan: (payload) => ipcRenderer.invoke('action-import:scan', payload),
  startScan: (payload) => ipcRenderer.invoke('action-import:start-scan', payload),
  cancelScan: (payload) => ipcRenderer.invoke('action-import:cancel-scan', payload),
  readEntry: (payload) => ipcRenderer.invoke('action-import:read-entry', payload),
  clearPreview: () => ipcRenderer.invoke('action-import:clear-preview'),
  onScanProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('action-import:scan-progress', listener);
    return () => ipcRenderer.removeListener('action-import:scan-progress', listener);
  },
  onScanComplete: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('action-import:scan-complete', listener);
    return () => ipcRenderer.removeListener('action-import:scan-complete', listener);
  },
  onScanError: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('action-import:scan-error', listener);
    return () => ipcRenderer.removeListener('action-import:scan-error', listener);
  },
});

contextBridge.exposeInMainWorld('forartLocalApi', {
  request: (payload) => ipcRenderer.invoke('local-api:request', payload),
});

contextBridge.exposeInMainWorld('libtv', {
  status: () => ipcRenderer.invoke('libtv:status'),
  install: () => ipcRenderer.invoke('libtv:install'),
  account: () => ipcRenderer.invoke('libtv:account'),
  accounts: () => ipcRenderer.invoke('libtv:accounts'),
  useAccount: (account) => ipcRenderer.invoke('libtv:account-use', account),
  loginWeb: () => ipcRenderer.invoke('libtv:login-web'),
  logout: () => ipcRenderer.invoke('libtv:logout'),
  workspaces: (payload) => ipcRenderer.invoke('libtv:workspaces', payload),
  projects: (payload) => ipcRenderer.invoke('libtv:projects', payload),
  imageModels: () => ipcRenderer.invoke('libtv:image-models'),
  imageModelSchema: (payload) => ipcRenderer.invoke('libtv:image-model-schema', payload),
  startImageTask: (payload) => ipcRenderer.invoke('libtv:image-task-start', payload),
  startImageTasks: (payloads) => ipcRenderer.invoke('libtv:image-tasks-start', payloads),
  getImageTask: (taskId) => ipcRenderer.invoke('libtv:image-task-get', taskId),
  recoverImageTask: (payload) => ipcRenderer.invoke('libtv:image-task-recover', payload),
  recoverCanvasImageTasks: () => ipcRenderer.invoke('libtv:image-tasks-recover-canvases'),
  stopImageTask: (taskId) => ipcRenderer.invoke('libtv:image-task-stop', taskId),
  ensureReadyProject: (payload) => ipcRenderer.invoke('libtv:ensure-ready-project', payload),
  generateImage: (payload) => ipcRenderer.invoke('libtv:generate-image', payload),
  generateBatch: (payload) => ipcRenderer.invoke('libtv:generate-batch', payload),
});
