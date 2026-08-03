const CANVAS_NODES_CLIPBOARD_KIND = 'forart.reactflow.nodes';

function hasCanvasNodes(text) {
  if (!text) return false;
  try {
    const payload = JSON.parse(text);
    return payload?.kind === CANVAS_NODES_CLIPBOARD_KIND
      && payload?.version === 1
      && Array.isArray(payload?.nodes)
      && payload.nodes.length > 0
      && Array.isArray(payload?.edges);
  } catch {
    return false;
  }
}

function inspectCanvasClipboard(clipboard) {
  let hasNodes = false;
  let hasImage = false;
  try {
    hasNodes = hasCanvasNodes(clipboard.readText());
  } catch {
    hasNodes = false;
  }
  try {
    hasImage = !clipboard.readImage().isEmpty();
  } catch {
    hasImage = false;
  }
  return { hasImage, hasNodes };
}

function registerCanvasClipboardIpc({ clipboard, ipcMain }) {
  ipcMain.handle('canvas:write-clipboard', async (_event, payload = {}) => {
    clipboard.writeText(JSON.stringify({
      kind: CANVAS_NODES_CLIPBOARD_KIND,
      version: 1,
      ...payload,
    }));
    return { ok: true };
  });
  ipcMain.handle('canvas:clipboard-status', async () => inspectCanvasClipboard(clipboard));
  ipcMain.handle('canvas:paste-clipboard', async (event) => {
    event.sender.paste();
    return { ok: true };
  });
}

module.exports = {
  CANVAS_NODES_CLIPBOARD_KIND,
  inspectCanvasClipboard,
  registerCanvasClipboardIpc,
};
