const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('easyTool', {
  saveResult: (payload) => ipcRenderer.invoke('save-result', payload),
  loadCanvas: () => ipcRenderer.invoke('canvas:load'),
  saveCanvas: (payload) => ipcRenderer.invoke('canvas:save', payload),
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
  chooseDirectory: () => ipcRenderer.invoke('dialog:choose-directory'),
  testServer: (serverUrl) => ipcRenderer.invoke('server:test-remote', serverUrl),
  localServerStatus: () => ipcRenderer.invoke('server:local-status'),
});
