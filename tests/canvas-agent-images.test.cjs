const assert = require('node:assert/strict');
const test = require('node:test');
const { imageSourceForContext } = require('../electron/main/modules/canvas-agent/canvas-agent-images.cjs');

test('Canvas Agent resolves renderer image-generator reference fields', () => {
  assert.equal(imageSourceForContext({ imageUrl: 'forart-asset://canvas/input/a.png', title: 'A' }), 'forart-asset://canvas/input/a.png');
  assert.equal(imageSourceForContext({ assetUrl: 'forart-asset://canvas/input/b.png' }), 'forart-asset://canvas/input/b.png');
  assert.equal(imageSourceForContext({ localUrl: 'file:///tmp/c.png' }), 'file:///tmp/c.png');
  assert.equal(imageSourceForContext({ url: 'https://example.com/d.png' }), 'https://example.com/d.png');
});
