const { Menu, Tray } = require('electron');

const TRAY_LABELS = {
  'zh-CN': {
    open: '打开 Forart',
    quit: '退出',
  },
  'en-US': {
    open: 'Open Forart',
    quit: 'Exit',
  },
};

function isUsableWindow(win) {
  return Boolean(win) && !(typeof win.isDestroyed === 'function' && win.isDestroyed());
}

function showAppWindow(win) {
  if (!isUsableWindow(win)) return false;
  if (typeof win.isMinimized === 'function' && win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return true;
}

function registerCloseToTray(win, { shouldQuit = () => false } = {}) {
  if (!isUsableWindow(win)) return () => {};

  const handleClose = (event) => {
    if (shouldQuit()) return;
    event.preventDefault();
    win.hide();
  };

  win.on('close', handleClose);
  return () => win.removeListener?.('close', handleClose);
}

function createAppTray({
  app,
  mainWindow,
  iconPath,
  language = 'zh-CN',
  Tray: TrayAdapter = Tray,
  Menu: MenuAdapter = Menu,
}) {
  const labels = TRAY_LABELS[language] || TRAY_LABELS['zh-CN'];
  const tray = new TrayAdapter(iconPath);
  const showWindow = () => showAppWindow(mainWindow);
  const menu = MenuAdapter.buildFromTemplate([
    { label: labels.open, click: showWindow },
    { type: 'separator' },
    { label: labels.quit, click: () => app.quit() },
  ]);

  tray.setToolTip('Forart');
  tray.setContextMenu(menu);
  tray.on('click', showWindow);

  return {
    tray,
    showWindow,
    destroy() {
      if (typeof tray.isDestroyed !== 'function' || !tray.isDestroyed()) tray.destroy();
    },
  };
}

module.exports = {
  createAppTray,
  registerCloseToTray,
  showAppWindow,
};
