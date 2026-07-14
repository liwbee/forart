const { BrowserWindow } = require('electron');
const path = require('path');

async function createWindow({ rootDir, isDev, BrowserWindow: BrowserWindowAdapter = BrowserWindow }) {
  const win = new BrowserWindowAdapter({
    width: 1180,
    height: 760,
    minWidth: 940,
    minHeight: 620,
    backgroundColor: '#f5f7fb',
    frame: false,
    icon: path.join(rootDir, 'build', 'icon.ico'),
    title: 'Forart',
    webPreferences: {
      preload: path.join(rootDir, 'electron', 'preload', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setMenuBarVisibility(false);

  function notifyMaximizedChanged() {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return;
    win.webContents.send('window:maximized-changed', win.isMaximized());
  }

  win.on('maximize', notifyMaximizedChanged);
  win.on('unmaximize', notifyMaximizedChanged);

  if (isDev) {
    await win.loadURL('http://127.0.0.1:6981');
  } else {
    await win.loadFile(path.join(rootDir, 'dist', 'index.html'));
  }

  return win;
}

function registerAppWindowIpc({ ipcMain, BrowserWindow: BrowserWindowAdapter = BrowserWindow }) {
  ipcMain.handle('window:is-maximized', (event) => {
    const win = BrowserWindowAdapter.fromWebContents(event.sender);
    if (!win) return { ok: false, maximized: false };
    return { ok: true, maximized: win.isMaximized() };
  });

  ipcMain.handle('window:minimize', (event) => {
    const win = BrowserWindowAdapter.fromWebContents(event.sender);
    if (win) win.minimize();
    return { ok: true };
  });

  ipcMain.handle('window:toggle-maximize', (event) => {
    const win = BrowserWindowAdapter.fromWebContents(event.sender);
    if (!win) return { ok: false };
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
    return { ok: true, maximized: win.isMaximized() };
  });

  ipcMain.handle('window:close', (event) => {
    const win = BrowserWindowAdapter.fromWebContents(event.sender);
    if (win) win.close();
    return { ok: true };
  });
}

module.exports = { createWindow, registerAppWindowIpc };
