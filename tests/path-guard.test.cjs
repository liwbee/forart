const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { isInside, isInsideOrEqual } = require('../electron/main/modules/path-guard.cjs');

const isWindows = process.platform === 'win32';
const parent = isWindows ? 'C:\\forart\\assets' : '/forart/assets';

test('isInside accepts child paths and rejects the parent itself', () => {
  assert.equal(isInside(parent, path.join(parent, 'input', 'image.png')), true);
  assert.equal(isInside(parent, path.join(parent, 'a', 'b', 'c.png')), true);
  assert.equal(isInside(parent, parent), false);
  assert.equal(isInside(parent, path.join(parent, path.sep)), false);
});

test('isInsideOrEqual accepts child paths and the parent itself', () => {
  assert.equal(isInsideOrEqual(parent, path.join(parent, 'input', 'image.png')), true);
  assert.equal(isInsideOrEqual(parent, parent), true);
  assert.equal(isInsideOrEqual(parent, path.join(parent, path.sep)), true);
});

test('sibling directory with shared name prefix is not inside', () => {
  const sibling = `${parent}-${path.sep}escape.png`;
  assert.equal(isInside(parent, sibling), false);
  assert.equal(isInsideOrEqual(parent, sibling), false);
});

test('dot-dot traversal out of the parent is rejected', () => {
  const escape = path.resolve(parent, '..', '..', 'etc', 'secret.png');
  assert.equal(isInside(parent, escape), false);
  assert.equal(isInsideOrEqual(parent, escape), false);
});

test('absolute target on another drive is rejected on windows', () => {
  if (!isWindows) return;
  const otherDrive = 'D:\\Windows\\system32\\config';
  assert.equal(isInside(parent, otherDrive), false);
  assert.equal(isInsideOrEqual(parent, otherDrive), false);
});

test('unnormalized inputs are resolved before checking', () => {
  const child = path.join(parent, 'input', 'image.png');
  const dotted = path.join(parent, '.', 'input', '..', 'input', 'image.png');
  assert.equal(isInside(parent, dotted), true);
  assert.equal(isInside(parent, `${child}${path.sep}`), true);
  assert.equal(isInsideOrEqual(parent, `${parent}${path.sep}${path.sep}`), true);
});
