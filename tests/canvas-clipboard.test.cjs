const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CANVAS_NODES_CLIPBOARD_KIND,
  inspectCanvasClipboard,
  registerCanvasClipboardIpc,
} = require('../electron/main/modules/canvas-clipboard.cjs');

function createClipboard({ text = '', hasImage = false } = {}) {
  let writtenText = '';
  return {
    readImage: () => ({ isEmpty: () => !hasImage }),
    readText: () => text,
    writeText: (value) => { writtenText = value; },
    writtenText: () => writtenText,
  };
}

test('clipboard status only enables paste for canvas nodes or images', () => {
  const nodeClipboard = createClipboard({
    text: JSON.stringify({
      kind: CANVAS_NODES_CLIPBOARD_KIND,
      version: 1,
      nodes: [{ id: 'node-1' }],
      edges: [],
    }),
  });
  assert.deepEqual(inspectCanvasClipboard(nodeClipboard), { hasImage: false, hasNodes: true });

  const imageClipboard = createClipboard({ text: 'ordinary text', hasImage: true });
  assert.deepEqual(inspectCanvasClipboard(imageClipboard), { hasImage: true, hasNodes: false });

  const emptyClipboard = createClipboard({ text: 'ordinary text' });
  assert.deepEqual(inspectCanvasClipboard(emptyClipboard), { hasImage: false, hasNodes: false });
});

test('clipboard IPC writes the current canvas format and delegates paste to WebContents', async () => {
  const handlers = new Map();
  const clipboard = createClipboard();
  registerCanvasClipboardIpc({
    clipboard,
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
  });

  await handlers.get('canvas:write-clipboard')({}, { nodes: [{ id: 'node-1' }], edges: [] });
  assert.deepEqual(JSON.parse(clipboard.writtenText()), {
    kind: CANVAS_NODES_CLIPBOARD_KIND,
    version: 1,
    nodes: [{ id: 'node-1' }],
    edges: [],
  });

  let pasteCount = 0;
  assert.deepEqual(await handlers.get('canvas:paste-clipboard')({
    sender: { paste: () => { pasteCount += 1; } },
  }), { ok: true });
  assert.equal(pasteCount, 1);
});
