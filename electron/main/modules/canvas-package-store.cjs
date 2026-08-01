const fs = require('fs');
const path = require('path');
const { Worker } = require('node:worker_threads');
const { upgradeCanvasDocument } = require('./canvas-schema.cjs');

const PACKAGE_FORMAT = 'forart.canvas.package';
const PACKAGE_VERSION = 1;
const PACKAGE_URL_PREFIX = 'forart-package://asset/';

function nowMs() {
  return Date.now();
}

function abortError() {
  const error = new Error('Canvas transfer canceled.');
  error.name = 'AbortError';
  return error;
}

function reportProgress(onProgress, phase, percent, loadedBytes = 0, totalBytes = 0) {
  onProgress?.({
    phase,
    percent: Math.max(0, Math.min(100, Math.round(Number(percent || 0)))),
    loadedBytes: Math.max(0, Number(loadedBytes || 0)),
    totalBytes: Math.max(0, Number(totalBytes || 0)),
  });
}

function mapWorkerProgress(onProgress, rangeStart = 0, rangeEnd = 100) {
  return (progress) => {
    const workerPercent = Math.max(0, Math.min(100, Number(progress?.percent || 0)));
    reportProgress(
      onProgress,
      progress?.phase || 'working',
      rangeStart + ((rangeEnd - rangeStart) * workerPercent) / 100,
      progress?.loadedBytes,
      progress?.totalBytes,
    );
  };
}

function runPackageWorker(payload, options = {}) {
  const { signal, onProgress } = options;
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'canvas-package-worker.cjs'), { workerData: payload });
    let settled = false;
    let aborting = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () => {
      aborting = true;
      void worker.terminate().finally(() => finish(() => reject(abortError())));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.on('message', (message) => {
      if (message?.type === 'progress') {
        onProgress?.(message.progress || {});
        return;
      }
      if (message?.type === 'result') finish(() => resolve(message.result));
      else if (message?.type === 'error') finish(() => reject(new Error(String(message.error || 'Canvas package worker failed.'))));
    });
    worker.once('error', (error) => finish(() => reject(error)));
    worker.once('exit', (code) => {
      if (!settled && !aborting && code !== 0) finish(() => reject(new Error(`Canvas package worker exited with code ${code}.`)));
    });
  });
}

function isRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function cloneSerializable(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeFileBaseName(value, fallback = 'canvas') {
  return String(value || fallback)
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 80) || fallback;
}

function uniqueFilePath(directory, fileName) {
  const parsed = path.parse(fileName || 'canvas-image.png');
  const safeBase = safeFileBaseName(parsed.name, 'canvas-image');
  const ext = parsed.ext || '.png';
  let candidate = path.join(directory, `${safeBase}${ext}`);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(directory, `${safeBase}-${index}${ext}`);
    index += 1;
  }
  return candidate;
}

function isInsideOrEqual(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return !relative || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function extensionFromPath(value) {
  const ext = path.extname(String(value || '')).toLowerCase();
  return ext || '.png';
}

function isRemoteResourceUrl(value) {
  const text = String(value || '');
  return /^https?:\/\//i.test(text) || /^\/api(?:\/|$)/i.test(text);
}

function isLocalUrlLike(value) {
  const text = String(value || '');
  return /^forart-asset:\/\/canvas\//i.test(text)
    || /^blob:/i.test(text)
    || /^file:\/\//i.test(text)
    || /^[a-zA-Z]:[\\/]/.test(text)
    || /^\/[^/]/.test(text);
}

function packageAssetUrl(assetId) {
  return PACKAGE_URL_PREFIX + encodeURIComponent(assetId);
}

function packageAssetIdFromUrl(value) {
  const text = String(value || '');
  if (!text.startsWith(PACKAGE_URL_PREFIX)) return '';
  return decodeURIComponent(text.slice(PACKAGE_URL_PREFIX.length));
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function appVersion(rootDir) {
  try {
    const pkg = readJsonFile(path.join(rootDir, 'package.json'));
    return String(pkg.version || '');
  } catch {
    return '';
  }
}

function walk(value, visitor, key = '') {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const next = visitor(value[index], String(index));
      value[index] = next;
      if (isRecord(next) || Array.isArray(next)) walk(next, visitor, String(index));
    }
    return value;
  }
  if (!isRecord(value)) return value;
  for (const currentKey of Object.keys(value)) {
    const next = visitor(value[currentKey], currentKey);
    if (next === undefined) {
      delete value[currentKey];
      continue;
    }
    value[currentKey] = next;
    if (isRecord(next) || Array.isArray(next)) walk(next, visitor, currentKey);
  }
  return value;
}

function cleanGenerationTask(value) {
  if (!isRecord(value)) return value;
  delete value.latestGenerationTaskId;
  delete value.running;
  return value;
}

function cleanActionFissionForJsonOnly(actionFission) {
  if (!isRecord(actionFission)) return actionFission;
  const next = cloneSerializable(actionFission);
  next.rows = Array.isArray(next.rows) ? next.rows.map((row) => {
    const cleanRow = { ...row };
    delete cleanRow.resultUrl;
    delete cleanRow.resultThumbUrl;
    delete cleanRow.resultFileName;
    delete cleanRow.resultWidth;
    delete cleanRow.resultHeight;
    delete cleanRow.resultDownloadState;
    delete cleanRow.resultDownloadedAt;
    delete cleanRow.latestGenerationTaskId;
    if (isLocalUrlLike(cleanRow.selectedActionAssetUrl) && !isRemoteResourceUrl(cleanRow.selectedActionAssetUrl)) {
      cleanRow.selectedActionAssetUrl = null;
    }
    return cleanRow;
  }) : [];
  return next;
}

function cleanActionFissionForPackage(actionFission) {
  if (!isRecord(actionFission)) return actionFission;
  const next = cloneSerializable(actionFission);
  next.rows = Array.isArray(next.rows) ? next.rows.map((row) => {
    const cleanRow = { ...row };
    delete cleanRow.resultThumbUrl;
    delete cleanRow.latestGenerationTaskId;
    return cleanRow;
  }) : [];
  return next;
}

function sanitizeCanvasForJsonOnly(canvas) {
  const next = cloneSerializable(canvas);
  next.nodes = Array.isArray(next.nodes) ? next.nodes.map((node) => {
    const cleanNode = cleanGenerationTask({ ...node });
    if (isLocalUrlLike(cleanNode.url) && !isRemoteResourceUrl(cleanNode.url)) delete cleanNode.url;
    delete cleanNode.thumbUrl;
    delete cleanNode.filePath;
    delete cleanNode.thumbFilePath;
    delete cleanNode.fileName;
    delete cleanNode.imageNaturalWidth;
    delete cleanNode.imageNaturalHeight;
    delete cleanNode.outputDownloadState;
    delete cleanNode.outputDownloadedAt;
    cleanNode.actionFission = cleanActionFissionForJsonOnly(cleanNode.actionFission);
    if (isRecord(cleanNode.data)) {
      const cleanData = cleanGenerationTask({ ...cleanNode.data });
      delete cleanData.thumbUrl;
      cleanData.actionFission = cleanActionFissionForJsonOnly(cleanData.actionFission);
      cleanNode.data = cleanData;
    }
    return cleanNode;
  }) : [];
  return walk(next, (value, key) => {
    if (typeof value !== 'string') return value;
    if (isRemoteResourceUrl(value)) return value;
    if (isLocalUrlLike(value)) return undefined;
    if (/path$/i.test(key) || /filePath/i.test(key) || /localPath/i.test(key)) return undefined;
    return value;
  });
}

function sanitizeCanvasForPackage(canvas, options = {}) {
  const preserveLocalAssetUrls = Boolean(options.preserveLocalAssetUrls);
  const preservePackageUrls = options.preservePackageUrls !== false;
  const next = cloneSerializable(canvas);
  next.nodes = Array.isArray(next.nodes) ? next.nodes.map((node) => {
    const cleanNode = cleanGenerationTask({ ...node });
    delete cleanNode.thumbUrl;
    delete cleanNode.filePath;
    delete cleanNode.thumbFilePath;
    cleanNode.actionFission = cleanActionFissionForPackage(cleanNode.actionFission);
    if (isRecord(cleanNode.data)) {
      const cleanData = cleanGenerationTask({ ...cleanNode.data });
      delete cleanData.thumbUrl;
      cleanData.actionFission = cleanActionFissionForPackage(cleanData.actionFission);
      cleanNode.data = cleanData;
    }
    return cleanNode;
  }) : [];
  return walk(next, (value, key) => {
    if (/path$/i.test(key) || /filePath/i.test(key) || /localPath/i.test(key)) return undefined;
    if (typeof value === 'string') {
      if (value.startsWith(PACKAGE_URL_PREFIX)) return preservePackageUrls ? value : undefined;
      if (isLocalUrlLike(value) && !isRemoteResourceUrl(value)) return preserveLocalAssetUrls ? value : undefined;
    }
    return value;
  });
}

function createCanvasPackageStore({ rootDir, dialog, canvasStore, assetStore, net }) {
  const canvasAssetsRoot = () => assetStore.canvasAssetsRoot();
  const inputRoot = () => assetStore.assetDirectory('input');
  const outputRoot = () => assetStore.assetDirectory('output');

  function isCanvasAssetPath(filePath) {
    const target = path.resolve(filePath);
    return isInsideOrEqual(inputRoot(), target) || isInsideOrEqual(outputRoot(), target);
  }

  function kindForAssetPath(filePath) {
    const target = path.resolve(filePath);
    return isInsideOrEqual(outputRoot(), target) ? 'output' : 'input';
  }

  function resolveLocalAsset(source) {
    const text = String(source || '').trim();
    if (!text || /^blob:/i.test(text)) return null;
    const assetPath = assetStore.resolveAssetUrl(text);
    if (assetPath && isCanvasAssetPath(assetPath)) {
      return {
        url: assetStore.assetUrl(assetPath),
        filePath: path.resolve(assetPath),
        kind: kindForAssetPath(assetPath),
      };
    }
    if (path.isAbsolute(text) && isCanvasAssetPath(text)) {
      const filePath = path.resolve(text);
      return {
        url: assetStore.assetUrl(filePath),
        filePath,
        kind: kindForAssetPath(filePath),
      };
    }
    return null;
  }

  function addAsset(assetsByPath, source, warnings, sourceLabel) {
    const text = String(source || '').trim();
    if (!text) return;
    if (/^blob:/i.test(text)) {
      warnings.push({ source: sourceLabel, message: 'Blob image URLs are not persisted and were not exported.' });
      return;
    }
    const asset = resolveLocalAsset(text);
    if (!asset) {
      if (isLocalUrlLike(text) && !isRemoteResourceUrl(text)) {
        warnings.push({ source: sourceLabel, url: text, message: 'Referenced local asset is unavailable or outside the canvas asset directory.' });
      }
      return;
    }
    const key = asset.filePath.toLowerCase();
    const existing = assetsByPath.get(key);
    if (existing) return;
    if (!fs.existsSync(asset.filePath)) {
      warnings.push({ source: sourceLabel, url: asset.url, message: 'Referenced local asset is missing.' });
      return;
    }
    assetsByPath.set(key, {
      ...asset,
      originalSources: [text],
    });
  }

  function collectGenerationResultAssets(result, add, prefix) {
    if (!isRecord(result)) return;
    add(result.localUrl, `${prefix}.localUrl`);
    add(result.url, `${prefix}.url`);
    if (Array.isArray(result.results)) {
      result.results.forEach((item, index) => collectGenerationResultAssets(item, add, `${prefix}.results.${index}`));
    }
  }

  function collectActionFissionAssets(actionFission, add, prefix) {
    if (!isRecord(actionFission)) return;
    for (const row of Array.isArray(actionFission.rows) ? actionFission.rows : []) {
      const rowPrefix = `${prefix}.row:${row?.id || ''}`;
      add(row?.resultUrl, `${rowPrefix}.resultUrl`);
      add(row?.selectedActionAssetUrl, `${rowPrefix}.selectedActionAssetUrl`);
    }
  }

  function collectAssets(canvas) {
    const assetsByPath = new Map();
    const warnings = [];
    const add = (source, label) => addAsset(assetsByPath, source, warnings, label);
    for (const node of Array.isArray(canvas.nodes) ? canvas.nodes : []) {
      const prefix = `node:${node.id || ''}`;
      add(node.url, `${prefix}.url`);
      add(node.filePath, `${prefix}.filePath`);
      collectActionFissionAssets(node.actionFission, add, `${prefix}.actionFission`);

      const data = isRecord(node.data) ? node.data : {};
      add(data.imageUrl, `${prefix}.data.imageUrl`);
      if (Array.isArray(data.generatedImages)) {
        data.generatedImages.forEach((result, index) => {
          collectGenerationResultAssets(result, add, `${prefix}.data.generatedImages.${index}`);
        });
      }
      collectActionFissionAssets(data.actionFission, add, `${prefix}.data.actionFission`);
    }
    return { assets: Array.from(assetsByPath.values()), warnings };
  }

  function rewriteCanvasAssetUrls(canvas, assets) {
    const byResolvedSource = new Map();
    const manifestAssets = assets.map((asset, index) => {
      const assetId = `asset_${String(index + 1).padStart(3, '0')}`;
      const ext = extensionFromPath(asset.filePath);
      const fileName = `image_${String(index + 1).padStart(3, '0')}${ext}`;
      const packagePath = `assets/${asset.kind}/${fileName}`;
      const placeholderUrl = packageAssetUrl(assetId);
      byResolvedSource.set(asset.url, placeholderUrl);
      byResolvedSource.set(asset.filePath, placeholderUrl);
      return {
        id: assetId,
        kind: asset.kind,
        originalUrl: asset.url,
        originalRelativePath: path.relative(canvasAssetsRoot(), asset.filePath).replace(/\\/g, '/'),
        sourceFilePath: asset.filePath,
        packagePath,
        fileName,
        sizeBytes: fs.existsSync(asset.filePath) ? fs.statSync(asset.filePath).size : 0,
      };
    });

    const rewritten = walk(cloneSerializable(canvas), (value) => {
      if (typeof value !== 'string') return value;
      const local = resolveLocalAsset(value);
      if (!local) return value;
      return byResolvedSource.get(local.url) || byResolvedSource.get(local.filePath) || value;
    });

    return { canvas: rewritten, manifestAssets };
  }

  async function exportJson(canvasId, options = {}) {
    const canvas = canvasStore.readCanvas(canvasId);
    if (!canvas) throw new Error('Canvas not found.');
    const defaultPath = path.join(process.env.USERPROFILE || process.env.HOME || rootDir, `${safeFileBaseName(canvas.title)}.forart-canvas.json`);
    const result = await dialog.showSaveDialog({
      title: 'Export canvas JSON',
      defaultPath,
      filters: [{ name: 'Forart canvas JSON', extensions: ['forart-canvas.json', 'json'] }],
    });
    if (result.canceled || !result.filePath) return { ok: true, canceled: true };
    const cleaned = sanitizeCanvasForJsonOnly(canvas);
    reportProgress(options.onProgress, 'preparing', 5);
    try {
      await runPackageWorker({
        operation: 'write-json',
        targetPath: result.filePath,
        json: JSON.stringify(cleaned, null, 2) + '\n',
      }, {
        signal: options.signal,
        onProgress: mapWorkerProgress(options.onProgress, 5, 100),
      });
    } catch (error) {
      await fs.promises.rm(`${result.filePath}.part`, { force: true }).catch(() => undefined);
      throw error;
    }
    return { ok: true, canceled: false, filePath: result.filePath, warnings: [] };
  }

  function packagePayload(canvas) {
    const collected = collectAssets(canvas);
    const rewritten = rewriteCanvasAssetUrls(canvas, collected.assets);
    const cleanedCanvas = sanitizeCanvasForPackage(rewritten.canvas, { preservePackageUrls: true });
    const manifestAssets = rewritten.manifestAssets.map(({ sourceFilePath: _sourceFilePath, ...asset }) => asset);
    const manifest = {
      format: PACKAGE_FORMAT,
      version: PACKAGE_VERSION,
      exportedAt: nowMs(),
      appVersion: appVersion(rootDir),
      mode: 'with-resources',
      canvas: {
        id: canvas.id,
        title: canvas.title,
        nodeCount: Array.isArray(canvas.nodes) ? canvas.nodes.length : 0,
      },
      assets: manifestAssets,
      warnings: collected.warnings,
    };
    return {
      assets: rewritten.manifestAssets.map((asset) => ({
        sourceFilePath: asset.sourceFilePath,
        packagePath: asset.packagePath,
        sizeBytes: asset.sizeBytes,
      })),
      canvasJson: JSON.stringify(cleanedCanvas, null, 2) + '\n',
      manifestJson: JSON.stringify(manifest, null, 2) + '\n',
      warnings: collected.warnings,
    };
  }

  async function writeCanvasPackageToPath(canvasId, targetPath, options = {}) {
    const canvas = canvasStore.readCanvas(canvasId);
    if (!canvas) throw new Error('Canvas not found.');
    if (!targetPath) throw new Error('Target package path is required.');
    reportProgress(options.onProgress, 'scanning', options.rangeStart || 0);
    const payload = packagePayload(canvas);
    const rangeStart = Number(options.rangeStart || 0);
    const rangeEnd = Number(options.rangeEnd ?? 100);
    try {
      await runPackageWorker({
        operation: 'pack',
        targetPath,
        manifestJson: payload.manifestJson,
        canvasJson: payload.canvasJson,
        assets: payload.assets,
      }, {
        signal: options.signal,
        onProgress: mapWorkerProgress(options.onProgress, Math.min(rangeEnd, rangeStart + 5), rangeEnd),
      });
      return { ok: true, canceled: false, filePath: targetPath, warnings: payload.warnings };
    } catch (error) {
      await fs.promises.rm(`${targetPath}.part`, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async function exportPackage(canvasId, options = {}) {
    const canvas = canvasStore.readCanvas(canvasId);
    if (!canvas) throw new Error('Canvas not found.');
    const defaultPath = path.join(process.env.USERPROFILE || process.env.HOME || rootDir, `${safeFileBaseName(canvas.title)}.forartcanvas`);
    const result = await dialog.showSaveDialog({
      title: 'Export canvas with resources',
      defaultPath,
      filters: [{ name: 'Forart canvas package', extensions: ['forartcanvas'] }],
    });
    if (result.canceled || !result.filePath) return { ok: true, canceled: true };
    return writeCanvasPackageToPath(canvasId, result.filePath, options);
  }

  function createPackageForUpload(canvasId, options = {}) {
    const targetPath = path.join(
      canvasAssetsRoot(),
      'tmp',
      `${safeFileBaseName(canvasId || 'canvas')}-${Date.now().toString(36)}.forartcanvas`,
    );
    return writeCanvasPackageToPath(canvasId, targetPath, options);
  }

  async function uploadPackageToRemote(payload = {}, options = {}) {
    const filePath = String(payload.filePath || '');
    const uploadUrl = String(payload.uploadUrl || '');
    if (!filePath || !fs.existsSync(filePath)) throw new Error('Canvas package file not found.');
    const temporaryRoot = path.join(canvasAssetsRoot(), 'tmp');
    try {
      if (!/^https?:\/\//i.test(uploadUrl)) throw new Error('Remote upload URL is invalid.');
      if (!net?.request) throw new Error('Electron network service is unavailable.');
      const stat = await fs.promises.stat(filePath);
      const rangeStart = Number(options.rangeStart || 0);
      const rangeEnd = Number(options.rangeEnd ?? 100);
      return await new Promise((resolve, reject) => {
        if (options.signal?.aborted) return reject(abortError());
        const request = net.request({ method: 'POST', url: uploadUrl });
        const stream = fs.createReadStream(filePath);
        let uploadedBytes = 0;
        const onAbort = () => {
          stream.destroy(abortError());
          request.abort();
          reject(abortError());
        };
        options.signal?.addEventListener('abort', onAbort, { once: true });
        request.setHeader('Content-Type', 'application/octet-stream');
        request.on('response', (response) => {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          response.on('end', () => {
            options.signal?.removeEventListener('abort', onAbort);
            const text = Buffer.concat(chunks).toString('utf8');
            const contentType = String(response.headers['content-type'] || '');
            let body = text;
            if (contentType.includes('application/json')) {
              try { body = JSON.parse(text); } catch { body = text; }
            }
            if (response.statusCode < 200 || response.statusCode >= 300) {
              const message = body && typeof body === 'object' && 'detail' in body ? String(body.detail) : String(body || `Upload failed with ${response.statusCode}`);
              reject(new Error(message));
              return;
            }
            reportProgress(options.onProgress, 'uploading', rangeEnd, stat.size, stat.size);
            resolve(body);
          });
        });
        request.on('error', (error) => {
          options.signal?.removeEventListener('abort', onAbort);
          reject(error);
        });
        stream.on('data', (chunk) => {
          uploadedBytes += chunk.length;
          const ratio = stat.size > 0 ? uploadedBytes / stat.size : 1;
          reportProgress(options.onProgress, 'uploading', rangeStart + ((rangeEnd - rangeStart) * ratio), uploadedBytes, stat.size);
        });
        stream.on('error', reject);
        reportProgress(options.onProgress, 'uploading', rangeStart, 0, stat.size);
        stream.pipe(request);
      });
    } finally {
      if (isInsideOrEqual(temporaryRoot, filePath)) {
        await fs.promises.rm(filePath, { force: true }).catch(() => undefined);
      }
    }
  }

  async function downloadPackageFromRemote(payload = {}, options = {}) {
    const downloadUrl = String(payload.downloadUrl || '');
    if (!/^https?:\/\//i.test(downloadUrl)) throw new Error('Remote download URL is invalid.');
    if (!net?.request) throw new Error('Electron network service is unavailable.');
    const directory = path.join(canvasAssetsRoot(), 'tmp');
    await fs.promises.mkdir(directory, { recursive: true });
    const targetPath = uniqueFilePath(directory, `remote-canvas-${Date.now().toString(36)}.forartcanvas`);
    const partPath = `${targetPath}.part`;
    await new Promise((resolve, reject) => {
      if (options.signal?.aborted) return reject(abortError());
      const request = net.request({ method: 'GET', url: downloadUrl });
      let output = null;
      const rangeStart = Number(options.rangeStart || 0);
      const rangeEnd = Number(options.rangeEnd ?? 100);
      const onAbort = () => {
        output?.destroy(abortError());
        request.abort();
        reject(abortError());
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });
      request.on('response', (response) => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          response.on('end', () => reject(new Error(Buffer.concat(chunks).toString('utf8') || `Download failed with ${response.statusCode}`)));
          return;
        }
        const totalBytes = Number(response.headers['content-length'] || 0);
        let loadedBytes = 0;
        output = fs.createWriteStream(partPath);
        response.on('data', (chunk) => {
          loadedBytes += chunk.length;
          const ratio = totalBytes > 0 ? loadedBytes / totalBytes : 0;
          reportProgress(options.onProgress, 'downloading', rangeStart + ((rangeEnd - rangeStart) * ratio), loadedBytes, totalBytes);
        });
        response.pipe(output);
        output.on('close', () => {
          options.signal?.removeEventListener('abort', onAbort);
          resolve();
        });
        output.on('error', reject);
      });
      request.on('error', reject);
      reportProgress(options.onProgress, 'downloading', rangeStart);
      request.end();
    }).catch(async (error) => {
      await fs.promises.rm(partPath, { force: true }).catch(() => undefined);
      throw error;
    });
    await fs.promises.rename(partPath, targetPath);
    return { ok: true, filePath: targetPath };
  }

  function projectIdOrDefault(projectId) {
    const requested = String(projectId || '').trim();
    const projects = canvasStore.listProjects();
    if (requested && projects.some((project) => project.id === requested)) return requested;
    return projects[0]?.id || '';
  }

  function createImportedCanvas(canvas, projectId) {
    const targetProjectId = projectIdOrDefault(projectId);
    return canvasStore.createCanvas({
      title: canvas.title || 'Imported canvas',
      icon: canvas.icon || 'layers',
      canvasType: 'forart',
      projectId: targetProjectId,
      nodes: Array.isArray(canvas.nodes) ? canvas.nodes : [],
      connections: Array.isArray(canvas.connections) ? canvas.connections : [],
      groups: Array.isArray(canvas.groups) ? canvas.groups : [],
      viewport: canvas.viewport || { x: 0, y: 0, scale: 1 },
    });
  }

  async function importJsonFile(filePath, projectId, options = {}) {
    const rangeStart = Number(options.rangeStart || 0);
    const rangeEnd = Number(options.rangeEnd ?? 100);
    const parsed = await runPackageWorker({ operation: 'read-json', filePath }, {
      signal: options.signal,
      onProgress: mapWorkerProgress(options.onProgress, rangeStart, Math.max(rangeStart, rangeEnd - 10)),
    });
    reportProgress(options.onProgress, 'saving', Math.max(rangeStart, rangeEnd - 5));
    const cleaned = sanitizeCanvasForJsonOnly(upgradeCanvasDocument(parsed.value).canvas);
    const created = createImportedCanvas(cleaned, projectId);
    reportProgress(options.onProgress, 'saving', rangeEnd);
    return created;
  }

  function rewriteImportedPackageUrls(canvas, urlByAssetId, urlByOriginalUrl) {
    return walk(cloneSerializable(canvas), (value, key) => {
      if (/path$/i.test(key) || /filePath/i.test(key) || /localPath/i.test(key)) return undefined;
      if (typeof value !== 'string') return value;
      const packageId = packageAssetIdFromUrl(value);
      if (packageId && urlByAssetId.has(packageId)) return urlByAssetId.get(packageId);
      if (urlByOriginalUrl.has(value)) return urlByOriginalUrl.get(value);
      return value;
    });
  }

  async function importPackageFile(filePath, projectId, options = {}) {
    const rangeStart = Number(options.rangeStart || 0);
    const rangeEnd = Number(options.rangeEnd ?? 100);
    const stagingRoot = path.join(canvasAssetsRoot(), 'tmp', `import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
    const temporaryPackage = isInsideOrEqual(path.join(canvasAssetsRoot(), 'tmp'), filePath);
    try {
      const unpacked = await runPackageWorker({ operation: 'unpack', filePath, stagingRoot }, {
        signal: options.signal,
        onProgress: mapWorkerProgress(options.onProgress, rangeStart, Math.max(rangeStart, rangeEnd - 10)),
      });
      const canvas = upgradeCanvasDocument(unpacked.canvas).canvas;
      const urlByAssetId = new Map();
      const urlByOriginalUrl = new Map();
      reportProgress(options.onProgress, 'saving', Math.max(rangeStart, rangeEnd - 10));
      for (const asset of unpacked.extractedAssets || []) {
        if (options.signal?.aborted) throw abortError();
        const directory = assetStore.assetDirectory(asset.kind);
        const sourceName = path.basename(asset.fileName || asset.stagedFilePath);
        const fileName = safeFileBaseName(path.basename(sourceName, path.extname(sourceName)), 'canvas-image') + extensionFromPath(sourceName);
        const target = uniqueFilePath(directory, fileName);
        await fs.promises.rename(asset.stagedFilePath, target);
        const nextUrl = assetStore.assetUrl(target);
        if (asset.id) urlByAssetId.set(String(asset.id), nextUrl);
        if (asset.originalUrl) urlByOriginalUrl.set(String(asset.originalUrl), nextUrl);
      }
      const rewritten = rewriteImportedPackageUrls(canvas, urlByAssetId, urlByOriginalUrl);
      const created = createImportedCanvas(sanitizeCanvasForPackage(rewritten, { preserveLocalAssetUrls: true, preservePackageUrls: false }), projectId);
      reportProgress(options.onProgress, 'saving', rangeEnd);
      return {
        ...created,
        warnings: Array.isArray(unpacked.manifest?.warnings) ? unpacked.manifest.warnings : [],
      };
    } finally {
      await fs.promises.rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
      if (temporaryPackage) await fs.promises.rm(filePath, { force: true }).catch(() => undefined);
    }
  }

  async function importCanvas(payload = {}, options = {}) {
    const selected = await dialog.showOpenDialog({
      title: 'Import canvas',
      properties: ['openFile'],
      filters: [
        { name: 'Forart canvas files', extensions: ['forartcanvas', 'json'] },
        { name: 'Forart canvas package', extensions: ['forartcanvas'] },
        { name: 'Forart canvas JSON', extensions: ['json'] },
      ],
    });
    if (selected.canceled || !selected.filePaths?.length) return { ok: true, canceled: true };
    const filePath = selected.filePaths[0];
    const ext = path.extname(filePath).toLowerCase();
    const result = ext === '.forartcanvas'
      ? await importPackageFile(filePath, payload.projectId, options)
      : await importJsonFile(filePath, payload.projectId, options);
    return { ...result, canceled: false };
  }

  async function cleanupTemporaryFiles(maxAgeMs = 24 * 60 * 60 * 1000) {
    const directory = path.join(canvasAssetsRoot(), 'tmp');
    const entries = await fs.promises.readdir(directory, { withFileTypes: true }).catch(() => []);
    const cutoff = Date.now() - maxAgeMs;
    await Promise.all(entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      const removablePart = entry.isFile() && entry.name.endsWith('.part');
      const removableImportDirectory = entry.isDirectory() && entry.name.startsWith('import-');
      const removablePackage = entry.isFile() && entry.name.endsWith('.forartcanvas');
      if (!removablePart && !removableImportDirectory && !removablePackage) return;
      const stat = await fs.promises.stat(target).catch(() => null);
      if (!stat || stat.mtimeMs > cutoff) return;
      await fs.promises.rm(target, { recursive: entry.isDirectory(), force: true }).catch(() => undefined);
    }));
  }

  return {
    cleanupTemporaryFiles,
    createPackageForUpload,
    downloadPackageFromRemote,
    exportJson,
    exportPackage,
    importCanvas,
    importPackageFile: async (filePath, projectId, options) => ({ ...await importPackageFile(filePath, projectId, options), canceled: false }),
    uploadPackageToRemote,
  };
}

module.exports = {
  createCanvasPackageStore,
  sanitizeCanvasForJsonOnly,
  sanitizeCanvasForPackage,
};
