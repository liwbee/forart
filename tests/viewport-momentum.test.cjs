const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadViewportMomentum() {
  const filePath = path.join(
    __dirname,
    '..',
    'renderer',
    'src',
    'features',
    'infinite-canvas',
    'viewportMomentum.ts',
  );
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;
  const loaded = { exports: {} };
  const execute = new Function('require', 'module', 'exports', '__filename', '__dirname', output);
  execute(require, loaded, loaded.exports, filePath, path.dirname(filePath));
  return loaded.exports;
}

function createScheduler() {
  let now = 0;
  let nextId = 1;
  const frames = new Map();
  return {
    now: () => now,
    requestFrame(callback) {
      const id = nextId++;
      frames.set(id, callback);
      return id;
    },
    cancelFrame(id) {
      frames.delete(id);
    },
    advance(elapsed = 16) {
      now += elapsed;
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(now));
    },
    pendingCount() {
      return frames.size;
    },
  };
}

function createHarness() {
  const { ViewportMomentumController } = loadViewportMomentum();
  const scheduler = createScheduler();
  const applied = [];
  const settled = [];
  const controller = new ViewportMomentumController({
    initialViewport: { x: 0, y: 0, zoom: 1 },
    applyViewport: (viewport) => applied.push(viewport),
    settleViewport: (viewport) => settled.push(viewport),
    scheduler,
  });
  return { applied, controller, scheduler, settled };
}

function releaseFastDrag(harness, direction = 1) {
  const { controller, scheduler } = harness;
  controller.beginUserMove({ x: 0, y: 0, zoom: 1 });
  controller.updateUserMove({ x: 16 * direction, y: 0, zoom: 1 });
  scheduler.advance();
  controller.updateUserMove({ x: 32 * direction, y: 0, zoom: 1 });
  scheduler.advance();
  controller.endUserMove({ x: 32 * direction, y: 0, zoom: 1 });
}

test('fast user panning transitions from dragging to an independent camera slide', () => {
  const harness = createHarness();
  releaseFastDrag(harness);

  assert.equal(harness.controller.getState(), 'sliding');
  harness.scheduler.advance();
  assert.equal(harness.applied.length, 1);
  assert.ok(harness.applied[0].x > 32);
  assert.equal(harness.applied[0].zoom, 1);
  assert.equal(harness.controller.isInternalViewport({ x: 32, y: 0, zoom: 1 }), true);
  assert.equal(harness.controller.isInternalViewport(harness.applied[0]), true);
});

test('a new pointer gesture stops the old slide before sampling a new direction', () => {
  const harness = createHarness();
  releaseFastDrag(harness, 1);
  harness.scheduler.advance();
  const interruptedX = harness.controller.getViewport().x;

  harness.controller.stop();
  harness.controller.beginUserMove({ x: interruptedX, y: 0, zoom: 1 });
  harness.controller.updateUserMove({ x: interruptedX - 16, y: 0, zoom: 1 });
  harness.scheduler.advance();
  harness.controller.updateUserMove({ x: interruptedX - 32, y: 0, zoom: 1 });
  harness.scheduler.advance();
  harness.controller.endUserMove({ x: interruptedX - 32, y: 0, zoom: 1 });
  harness.scheduler.advance();

  assert.equal(harness.controller.getState(), 'sliding');
  assert.ok(harness.controller.getViewport().x < interruptedX - 32);
});

test('holding still before release decays pointer velocity and prevents a slide', () => {
  const harness = createHarness();
  harness.controller.beginUserMove({ x: 0, y: 0, zoom: 1 });
  harness.controller.updateUserMove({ x: 16, y: 0, zoom: 1 });
  harness.scheduler.advance();
  harness.scheduler.advance();
  harness.scheduler.advance();
  harness.scheduler.advance();
  harness.controller.endUserMove({ x: 16, y: 0, zoom: 1 });

  assert.equal(harness.controller.getState(), 'idle');
  assert.equal(harness.scheduler.pendingCount(), 0);
  assert.equal(harness.applied.length, 0);
});

test('zoom gestures never produce camera slide momentum', () => {
  const harness = createHarness();
  harness.controller.beginUserMove({ x: 0, y: 0, zoom: 1 });
  harness.controller.updateUserMove({ x: 20, y: 10, zoom: 1.2 });
  harness.scheduler.advance();
  harness.controller.endUserMove({ x: 20, y: 10, zoom: 1.2 });

  assert.equal(harness.controller.getState(), 'idle');
  assert.equal(harness.scheduler.pendingCount(), 0);
});

test('camera slide decays to idle and persists its final viewport once', () => {
  const harness = createHarness();
  releaseFastDrag(harness);
  const settledAtRelease = harness.settled.length;
  for (let index = 0; index < 120 && harness.controller.getState() === 'sliding'; index += 1) {
    harness.scheduler.advance();
  }

  assert.equal(harness.controller.getState(), 'idle');
  assert.equal(harness.scheduler.pendingCount(), 0);
  assert.equal(harness.settled.length, settledAtRelease + 1);
  assert.deepEqual(harness.settled.at(-1), harness.controller.getViewport());
});
