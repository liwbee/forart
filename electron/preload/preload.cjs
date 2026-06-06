const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('easyTool', {
  saveResult: (payload) => ipcRenderer.invoke('save-result', payload),
});

contextBridge.exposeInMainWorld('forartConfig', {
  load: () => ipcRenderer.invoke('config:load'),
  save: (payload) => ipcRenderer.invoke('config:save', payload),
  chooseDirectory: () => ipcRenderer.invoke('dialog:choose-directory'),
  testServer: (serverUrl) => ipcRenderer.invoke('server:test-remote', serverUrl),
  localServerStatus: () => ipcRenderer.invoke('server:local-status'),
});
