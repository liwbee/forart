const test = require('node:test');
const assert = require('node:assert/strict');

const { createAppTray, registerCloseToTray, showAppWindow } = require('../electron/main/app-tray.cjs');

function createWindowHarness() {
  const listeners = new Map();
  const calls = [];
  let minimized = false;
  let destroyed = false;
  return {
    calls,
    listeners,
    win: {
      focus: () => calls.push('focus'),
      hide: () => calls.push('hide'),
      isDestroyed: () => destroyed,
      isMinimized: () => minimized,
      on: (event, listener) => listeners.set(event, listener),
      removeListener: (event, listener) => {
        if (listeners.get(event) === listener) listeners.delete(event);
      },
      restore: () => { minimized = false; calls.push('restore'); },
      show: () => calls.push('show'),
    },
    setDestroyed(value) { destroyed = value; },
    setMinimized(value) { minimized = value; },
  };
}

test('showAppWindow restores, shows, and focuses the existing window', () => {
  const harness = createWindowHarness();
  harness.setMinimized(true);

  assert.equal(showAppWindow(harness.win), true);
  assert.deepEqual(harness.calls, ['restore', 'show', 'focus']);

  harness.setDestroyed(true);
  assert.equal(showAppWindow(harness.win), false);
});

test('registerCloseToTray hides normal closes and allows real app quits', () => {
  const harness = createWindowHarness();
  let quitting = false;
  const dispose = registerCloseToTray(harness.win, { shouldQuit: () => quitting });
  const normalClose = { prevented: false, preventDefault() { this.prevented = true; } };

  harness.listeners.get('close')(normalClose);
  assert.equal(normalClose.prevented, true);
  assert.deepEqual(harness.calls, ['hide']);

  quitting = true;
  const appQuitClose = { prevented: false, preventDefault() { this.prevented = true; } };
  harness.listeners.get('close')(appQuitClose);
  assert.equal(appQuitClose.prevented, false);
  assert.deepEqual(harness.calls, ['hide']);

  dispose();
  assert.equal(harness.listeners.has('close'), false);
});

test('createAppTray wires open and exit actions', () => {
  const harness = createWindowHarness();
  const trayCalls = [];
  let menuTemplate = null;
  let quitCalls = 0;

  class FakeTray {
    constructor(iconPath) {
      trayCalls.push(['construct', iconPath]);
      this.listeners = new Map();
      this.destroyed = false;
    }
    destroy() { this.destroyed = true; trayCalls.push(['destroy']); }
    isDestroyed() { return this.destroyed; }
    on(event, listener) { this.listeners.set(event, listener); }
    setContextMenu(menu) { trayCalls.push(['menu', menu]); }
    setToolTip(value) { trayCalls.push(['tooltip', value]); }
  }

  const Menu = {
    buildFromTemplate(template) {
      menuTemplate = template;
      return { template };
    },
  };

  const controller = createAppTray({
    app: { quit: () => { quitCalls += 1; } },
    mainWindow: harness.win,
    iconPath: 'D:/Forart/build/icon.ico',
    language: 'en-US',
    Tray: FakeTray,
    Menu,
  });

  assert.equal(menuTemplate[0].label, 'Open Forart');
  assert.equal(menuTemplate[2].label, 'Exit');
  controller.tray.listeners.get('click')();
  assert.deepEqual(harness.calls, ['show', 'focus']);
  menuTemplate[2].click();
  assert.equal(quitCalls, 1);
  controller.destroy();
  assert.equal(controller.tray.isDestroyed(), true);
  assert.deepEqual(trayCalls[0], ['construct', 'D:/Forart/build/icon.ico']);
});
