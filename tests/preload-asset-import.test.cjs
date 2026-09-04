const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

test('asset imports use bytes only when the browser file has no disk path', async () => {
  const exposedApis = new Map();
  const invocations = [];
  const originalLoad = Module._load;
  const preloadPath = path.resolve(__dirname, '../electron/preload/preload.cjs');

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return {
        contextBridge: {
          exposeInMainWorld(name, api) {
            exposedApis.set(name, api);
          },
        },
        ipcRenderer: {
          invoke(channel, payload) {
            invocations.push({ channel, payload });
            return Promise.resolve({});
          },
          on() {},
          removeListener() {},
        },
        webUtils: {
          getPathForFile(file) {
            return file.diskPath || '';
          },
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[preloadPath];
    require(preloadPath);

    const pngBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const file = {
      name: 'clipboard.png',
      type: 'image/png',
      arrayBuffer: async () => pngBytes.buffer,
    };
    await exposedApis.get('easyTool').importCanvasAssetFile({ file });

    assert.equal(invocations.length, 1);
    assert.equal(invocations[0].channel, 'canvas:import-asset-file');
    assert.equal(invocations[0].payload.filePath, '');
    assert.equal(invocations[0].payload.fileName, 'clipboard.png');
    assert.equal(invocations[0].payload.mimeType, 'image/png');
    assert.deepEqual(invocations[0].payload.bytes, pngBytes);

    const diskFile = {
      diskPath: 'D:\\assets\\reference.png',
      name: 'reference.png',
      type: 'image/png',
      arrayBuffer: async () => { throw new Error('Disk-backed files must not be buffered.'); },
    };
    await exposedApis.get('easyTool').importCanvasAssetFile({ file: diskFile });

    assert.equal(invocations.length, 2);
    assert.equal(invocations[1].payload.filePath, diskFile.diskPath);
    assert.equal(invocations[1].payload.bytes, undefined);
  } finally {
    Module._load = originalLoad;
    delete require.cache[preloadPath];
  }
});
