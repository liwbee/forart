const { BrowserWindow } = require('electron');
const path = require('path');

async function createWindow({ rootDir, isDev }) {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 940,
    minHeight: 620,
    backgroundColor: '#f5f7fb',
    title: 'Forart',
    webPreferences: {
      preload: path.join(rootDir, 'electron', 'preload', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    await win.loadURL('http://127.0.0.1:5174');
  } else {
    await win.loadFile(path.join(rootDir, 'dist', 'index.html'));
  }
}

module.exports = { createWindow };
