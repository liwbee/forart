const test = require('node:test');
const assert = require('node:assert/strict');

const { createWindow, registerAppWindowIpc } = require('../electron/main/app-window.cjs');
const { registerUpdaterIpc } = require('../electron/main/ipc/updater-ipc.cjs');

function createIpcHarness() {
  const handlers = new Map();
  return {
    handlers,
    ipcMain: {
      handle(channel, handler) {
        assert.equal(handlers.has(channel), false, `duplicate IPC handler: ${channel}`);
        handlers.set(channel, handler);
      },
    },
  };
}

test('app window IPC delegates to the sender window', async () => {
  const { handlers, ipcMain } = createIpcHarness();
  const calls = [];
  let maximized = false;
  const win = {
    close: () => calls.push('close'),
    isMaximized: () => maximized,
    maximize: () => { maximized = true; calls.push('maximize'); },
    minimize: () => calls.push('minimize'),
    unmaximize: () => { maximized = false; calls.push('unmaximize'); },
  };
  const BrowserWindow = { fromWebContents: () => win };

  registerAppWindowIpc({ ipcMain, BrowserWindow });

  assert.deepEqual(await handlers.get('window:is-maximized')({ sender: {} }), { ok: true, maximized: false });
  assert.deepEqual(await handlers.get('window:minimize')({ sender: {} }), { ok: true });
  assert.deepEqual(await handlers.get('window:toggle-maximize')({ sender: {} }), { ok: true, maximized: true });
  assert.deepEqual(await handlers.get('window:toggle-maximize')({ sender: {} }), { ok: true, maximized: false });
  assert.deepEqual(await handlers.get('window:close')({ sender: {} }), { ok: true });
  assert.deepEqual(calls, ['minimize', 'maximize', 'unmaximize', 'close']);
});

test('app window IPC tolerates a missing sender window', async () => {
  const { handlers, ipcMain } = createIpcHarness();
  registerAppWindowIpc({ ipcMain, BrowserWindow: { fromWebContents: () => null } });

  assert.deepEqual(await handlers.get('window:is-maximized')({ sender: {} }), { ok: false, maximized: false });
  assert.deepEqual(await handlers.get('window:minimize')({ sender: {} }), { ok: true });
  assert.deepEqual(await handlers.get('window:toggle-maximize')({ sender: {} }), { ok: false });
  assert.deepEqual(await handlers.get('window:close')({ sender: {} }), { ok: true });
});

test('app window publishes maximize and restore changes to the renderer', async () => {
  const sent = [];
  class FakeBrowserWindow {
    constructor() {
      this.listeners = new Map();
      this.maximized = false;
      this.webContents = {
        isDestroyed: () => false,
        send: (...args) => sent.push(args),
      };
    }
    isDestroyed() { return false; }
    isMaximized() { return this.maximized; }
    setMenuBarVisibility() {}
    loadURL() { return Promise.resolve(); }
    on(event, listener) { this.listeners.set(event, listener); }
    emit(event, maximized) {
      this.maximized = maximized;
      this.listeners.get(event)?.();
    }
  }

  const win = await createWindow({ rootDir: 'D:/Forart', isDev: true, BrowserWindow: FakeBrowserWindow });
  win.emit('maximize', true);
  win.emit('unmaximize', false);
  assert.deepEqual(sent, [
    ['window:maximized-changed', true],
    ['window:maximized-changed', false],
  ]);
});

test('updater IPC preserves channels and progress events', async () => {
  const { handlers, ipcMain } = createIpcHarness();
  const sent = [];
  const updater = {
    appInfo: async () => ({ name: 'Forart' }),
    check: async () => ({ ok: true }),
    checkConnectivity: async () => ({ ok: true, results: [] }),
    run: async ({ onProgress }) => {
      onProgress({ phase: 'downloading', percent: 50 });
      return { ok: true };
    },
  };

  registerUpdaterIpc({ ipcMain, updater });

  assert.deepEqual(await handlers.get('app:info')(), { name: 'Forart' });
  assert.deepEqual(await handlers.get('app:check-update')(), { ok: true });
  assert.deepEqual(await handlers.get('app:update-connectivity')(), { ok: true, results: [] });
  assert.deepEqual(await handlers.get('app:run-update')({ sender: { send: (...args) => sent.push(args) } }), { ok: true });
  assert.deepEqual(sent, [['app:update-progress', { phase: 'downloading', percent: 50 }]]);
});
