const fs = require('node:fs');
const { execFile: defaultExecFile, spawn: defaultSpawn } = require('node:child_process');

const PHOTOSHOP_REGISTRY_KEYS = [
  'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Photoshop.exe',
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Photoshop.exe',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Photoshop.exe',
];

function readPhotoshopRegistryPath(execFile, registryKey) {
  return new Promise((resolve) => {
    execFile('reg.exe', ['query', registryKey, '/ve'], { windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve('');
        return;
      }
      const match = String(stdout || '').match(/\sREG_[A-Z_]+\s+([^\r\n]+)\s*$/im);
      resolve(match ? match[1].trim().replace(/^"|"$/g, '') : '');
    });
  });
}

async function findPhotoshopExecutable({ configuredPath, execFile, existsSync }) {
  const normalizedConfiguredPath = String(configuredPath || '').trim();
  if (normalizedConfiguredPath && existsSync(normalizedConfiguredPath)) return normalizedConfiguredPath;

  for (const registryKey of PHOTOSHOP_REGISTRY_KEYS) {
    const executablePath = await readPhotoshopRegistryPath(execFile, registryKey);
    if (executablePath && existsSync(executablePath)) return executablePath;
  }
  return '';
}

function launchDetached(spawn, executablePath, imagePath) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(executablePath, [imagePath], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
    } catch (error) {
      reject(error);
      return;
    }
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

function registerImageReviewIpc({
  ipcMain,
  dialog,
  imageReviewStore,
  imageReviewScaledImageStore,
  shell,
  getPhotoshopExecutablePath = () => '',
  processTools = {},
}) {
  const execFile = processTools.execFile || defaultExecFile;
  const spawn = processTools.spawn || defaultSpawn;
  const existsSync = processTools.existsSync || fs.existsSync;
  const platform = processTools.platform || process.platform;

  ipcMain.handle('image-review:choose-root', async (_event, payload = {}) => {
    const result = await dialog.showOpenDialog({
      title: String(payload?.title || 'Choose image review folder'),
      properties: ['openDirectory'],
    });
    const selectedPath = result.filePaths[0] || '';
    if (result.canceled || !selectedPath) return { canceled: true, path: '' };
    return { canceled: false, path: imageReviewStore.authorizeRoot(selectedPath) };
  });

  ipcMain.handle('image-review:restore-root', async (_event, payload = {}) => {
    try {
      return { ok: true, path: imageReviewStore.authorizeRoot(payload.root) };
    } catch {
      return { ok: false, path: '' };
    }
  });

  ipcMain.handle('image-review:products', async (_event, payload = {}) => ({
    products: await imageReviewStore.loadProducts({
      root: payload.root,
      modelFolders: payload.modelFolders,
    }),
  }));

  ipcMain.handle('image-review:product-images', async (_event, payload = {}) => ({
    product: await imageReviewStore.loadProductImages({
      root: payload.root,
      productId: String(payload.productId || ''),
      modelFolders: payload.modelFolders,
      detailFolders: payload.detailFolders,
    }),
  }));

  ipcMain.handle('image-review:set-review-status', async (_event, payload = {}) => ({
    ok: true,
    review: await imageReviewStore.setImageReviewStatus({
      root: payload.root,
      productId: String(payload.productId || ''),
      imageRelativePath: String(payload.imageRelativePath || ''),
      status: payload.status === null ? null : String(payload.status || ''),
    }),
  }));

  ipcMain.handle('image-review:clear-scaled-image-cache', async () => {
    imageReviewScaledImageStore?.clear?.();
    return { ok: true };
  });

  ipcMain.handle('image-review:open-product-folder', async (_event, payload = {}) => {
    let productDirectory = '';
    try {
      productDirectory = imageReviewStore.resolveProductDirectory({
        root: payload.root,
        productId: payload.productId,
      }) || '';
    } catch {
      return { ok: false, reason: 'product-folder-not-found' };
    }
    if (!productDirectory) return { ok: false, reason: 'product-folder-not-found' };

    try {
      const errorMessage = await shell.openPath(productDirectory);
      return errorMessage
        ? { ok: false, reason: 'open-failed' }
        : { ok: true };
    } catch {
      return { ok: false, reason: 'open-failed' };
    }
  });

  ipcMain.handle('image-review:open-in-photoshop', async (_event, payload = {}) => {
    if (platform !== 'win32') return { ok: false, reason: 'unsupported-platform' };

    let imagePath = '';
    try {
      imagePath = imageReviewStore.resolveImageUrl(String(payload.originalUrl || '')) || '';
    } catch {
      return { ok: false, reason: 'image-not-found' };
    }
    if (!imagePath || !existsSync(imagePath)) return { ok: false, reason: 'image-not-found' };

    const photoshopPath = await findPhotoshopExecutable({
      configuredPath: getPhotoshopExecutablePath(),
      execFile,
      existsSync,
    });
    if (!photoshopPath) return { ok: false, reason: 'photoshop-not-found' };

    try {
      await launchDetached(spawn, photoshopPath, imagePath);
      return { ok: true };
    } catch (error) {
      console.error('Failed to open image in Photoshop:', error);
      return { ok: false, reason: 'launch-failed' };
    }
  });
}

module.exports = { registerImageReviewIpc };
