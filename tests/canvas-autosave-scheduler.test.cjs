const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadSchedulerModule() {
  const filePath = path.join(
    __dirname,
    '..',
    'renderer',
    'src',
    'features',
    'infinite-canvas',
    'canvasAutosaveScheduler.ts',
  );
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filePath,
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', '__filename', '__dirname', output)(
    require,
    loaded,
    loaded.exports,
    filePath,
    path.dirname(filePath),
  );
  return loaded.exports;
}

function createFakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  const setTimer = (callback, delay) => {
    const id = nextId++;
    timers.set(id, { at: now + delay, callback });
    return id;
  };
  const clearTimer = (id) => timers.delete(id);
  const advance = async (milliseconds) => {
    const target = now + milliseconds;
    while (true) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!due) break;
      const [id, timer] = due;
      timers.delete(id);
      now = timer.at;
      timer.callback();
      await Promise.resolve();
      await Promise.resolve();
    }
    now = target;
  };
  return { advance, clearTimer, now: () => now, setTimer };
}

test('autosave uses trailing debounce and maxWait', async () => {
  const { createCanvasAutosaveScheduler } = loadSchedulerModule();
  const clock = createFakeClock();
  const saves = [];
  const scheduler = createCanvasAutosaveScheduler({
    save: async () => {
      saves.push(clock.now());
      return true;
    },
    debounceMs: 2_000,
    maxWaitMs: 10_000,
    settleMs: 400,
    ...clock,
  });

  scheduler.markDirty();
  await clock.advance(1_500);
  scheduler.markDirty();
  await clock.advance(1_500);
  scheduler.markDirty();
  await clock.advance(1_999);
  assert.deepEqual(saves, []);
  await clock.advance(1);
  assert.deepEqual(saves, [5_000]);

  scheduler.markDirty();
  for (let index = 0; index < 5; index += 1) {
    await clock.advance(1_900);
    scheduler.markDirty();
  }
  await clock.advance(500);
  assert.deepEqual(saves, [5_000, 15_000]);
});

test('autosave waits until an active canvas interaction settles', async () => {
  const { createCanvasAutosaveScheduler } = loadSchedulerModule();
  const clock = createFakeClock();
  const saves = [];
  const scheduler = createCanvasAutosaveScheduler({
    save: async () => {
      saves.push(clock.now());
      return true;
    },
    debounceMs: 2_000,
    maxWaitMs: 10_000,
    settleMs: 400,
    ...clock,
  });

  scheduler.setInteracting(true);
  scheduler.markDirty();
  await clock.advance(12_000);
  assert.deepEqual(saves, []);

  scheduler.setInteracting(false);
  await clock.advance(100);
  scheduler.markDirty();
  await clock.advance(399);
  assert.deepEqual(saves, []);
  await clock.advance(1);
  assert.deepEqual(saves, [12_500]);
});

test('autosave keeps at most one latest save pending', async () => {
  const { createCanvasAutosaveScheduler } = loadSchedulerModule();
  const clock = createFakeClock();
  const completions = [];
  const saveStarts = [];
  const scheduler = createCanvasAutosaveScheduler({
    save: () => new Promise((resolve) => {
      saveStarts.push(clock.now());
      completions.push(resolve);
    }),
    debounceMs: 2_000,
    maxWaitMs: 10_000,
    settleMs: 400,
    ...clock,
  });

  scheduler.markDirty();
  await clock.advance(2_000);
  assert.deepEqual(saveStarts, [2_000]);

  scheduler.markDirty();
  await clock.advance(2_000);
  scheduler.markDirty();
  await clock.advance(2_000);
  assert.deepEqual(saveStarts, [2_000]);

  completions.shift()(true);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(saveStarts, [2_000, 6_000]);
  assert.equal(completions.length, 1);
});
