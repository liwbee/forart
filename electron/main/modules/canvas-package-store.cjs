const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { upgradeCanvasDocument } = require('./canvas-schema.cjs');

const PACKAGE_FORMAT = 'forart.canvas.package';
const PACKAGE_VERSION = 1;
const PACKAGE_URL_PREFIX = 'forart-package://asset/';

function nowMs() {
  return Date.now();
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

function safePackagePath(value) {
  const normalized = String(value || '').replace(/\\/g, '/');
  const clean = path.posix.normalize(normalized);
  if (!clean || clean.startsWith('../') || clean.includes('/../') || clean.startsWith('/') || /^[a-zA-Z]:/.test(clean)) return '';
  return clean;
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

function writeJsonFile(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
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

function createCanvasPackageStore({ rootDir, dialog, canvasStore, assetStore }) {
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

  function exportJson(canvasId) {
    const canvas = canvasStore.readCanvas(canvasId);
    if (!canvas) throw new Error('Canvas not found.');
    const defaultPath = path.join(process.env.USERPROFILE || process.env.HOME || rootDir, `${safeFileBaseName(canvas.title)}.forart-canvas.json`);
    const result = dialog.showSaveDialogSync({
      title: 'Export canvas JSON',
      defaultPath,
      filters: [{ name: 'Forart canvas JSON', extensions: ['forart-canvas.json', 'json'] }],
    });
    if (!result) return { ok: true, canceled: true };
    const cleaned = sanitizeCanvasForJsonOnly(canvas);
    writeJsonFile(result, cleaned);
    return { ok: true, canceled: false, filePath: result, warnings: [] };
  }

  function exportPackage(canvasId) {
    const canvas = canvasStore.readCanvas(canvasId);
    if (!canvas) throw new Error('Canvas not found.');
    const defaultPath = path.join(process.env.USERPROFILE || process.env.HOME || rootDir, `${safeFileBaseName(canvas.title)}.forartcanvas`);
    const result = dialog.showSaveDialogSync({
      title: 'Export canvas with resources',
      defaultPath,
      filters: [{ name: 'Forart canvas package', extensions: ['forartcanvas'] }],
    });
    if (!result) return { ok: true, canceled: true };

    const collected = collectAssets(canvas);
    const rewritten = rewriteCanvasAssetUrls(canvas, collected.assets);
    const cleanedCanvas = sanitizeCanvasForPackage(rewritten.canvas, { preservePackageUrls: true });
    const zip = new AdmZip();
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
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8'));
    zip.addFile('canvas.json', Buffer.from(JSON.stringify(cleanedCanvas, null, 2) + '\n', 'utf8'));
    for (const asset of rewritten.manifestAssets) {
      zip.addFile(asset.packagePath, fs.readFileSync(asset.sourceFilePath));
    }
    zip.writeZip(result);
    return { ok: true, canceled: false, filePath: result, warnings: collected.warnings };
  }

  function writeCanvasPackageToPath(canvasId, targetPath) {
    const canvas = canvasStore.readCanvas(canvasId);
    if (!canvas) throw new Error('Canvas not found.');
    if (!targetPath) throw new Error('Target package path is required.');
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const collected = collectAssets(canvas);
    const rewritten = rewriteCanvasAssetUrls(canvas, collected.assets);
    const cleanedCanvas = sanitizeCanvasForPackage(rewritten.canvas, { preservePackageUrls: true });
    const zip = new AdmZip();
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
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8'));
    zip.addFile('canvas.json', Buffer.from(JSON.stringify(cleanedCanvas, null, 2) + '\n', 'utf8'));
    for (const asset of rewritten.manifestAssets) {
      zip.addFile(asset.packagePath, fs.readFileSync(asset.sourceFilePath));
    }
    zip.writeZip(targetPath);
    return { ok: true, canceled: false, filePath: targetPath, warnings: collected.warnings };
  }

  function createPackageForUpload(canvasId) {
    const targetPath = path.join(
      canvasAssetsRoot(),
      'tmp',
      `${safeFileBaseName(canvasId || 'canvas')}-${Date.now().toString(36)}.forartcanvas`,
    );
    return writeCanvasPackageToPath(canvasId, targetPath);
  }

  async function uploadPackageToRemote(payload = {}) {
    const filePath = String(payload.filePath || '');
    const uploadUrl = String(payload.uploadUrl || '');
    if (!filePath || !fs.existsSync(filePath)) throw new Error('Canvas package file not found.');
    if (!/^https?:\/\//i.test(uploadUrl)) throw new Error('Remote upload URL is invalid.');
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: fs.readFileSync(filePath),
    });
    const contentType = response.headers.get('content-type') || '';
    const body = contentType.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) {
      const message = body && typeof body === 'object' && 'detail' in body ? String(body.detail) : String(body || `Upload failed with ${response.status}`);
      throw new Error(message);
    }
    return body;
  }

  async function downloadPackageFromRemote(payload = {}) {
    const downloadUrl = String(payload.downloadUrl || '');
    if (!/^https?:\/\//i.test(downloadUrl)) throw new Error('Remote download URL is invalid.');
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(text || `Download failed with ${response.status}`);
    }
    const directory = path.join(canvasAssetsRoot(), 'tmp');
    fs.mkdirSync(directory, { recursive: true });
    const targetPath = uniqueFilePath(directory, `remote-canvas-${Date.now().toString(36)}.forartcanvas`);
    fs.writeFileSync(targetPath, Buffer.from(await response.arrayBuffer()));
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

  function importJsonFile(filePath, projectId) {
    const parsed = readJsonFile(filePath);
    const cleaned = sanitizeCanvasForJsonOnly(upgradeCanvasDocument(parsed).canvas);
    return createImportedCanvas(cleaned, projectId);
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

  function importPackageFile(filePath, projectId) {
    const zip = new AdmZip(filePath);
    const manifestEntry = zip.getEntry('manifest.json');
    const canvasEntry = zip.getEntry('canvas.json');
    if (!manifestEntry || !canvasEntry) throw new Error('Invalid Forart canvas package.');
    const manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
    if (manifest?.format !== PACKAGE_FORMAT) throw new Error('Unsupported canvas package format.');
    const canvas = upgradeCanvasDocument(JSON.parse(canvasEntry.getData().toString('utf8'))).canvas;
    const urlByAssetId = new Map();
    const urlByOriginalUrl = new Map();
    for (const asset of Array.isArray(manifest.assets) ? manifest.assets : []) {
      const packagePath = safePackagePath(asset.packagePath);
      const entry = packagePath ? zip.getEntry(packagePath) : null;
      if (!entry) continue;
      const kind = asset.kind === 'output' ? 'output' : 'input';
      const directory = assetStore.assetDirectory(kind);
      const sourceName = path.basename(asset.fileName || packagePath);
      const fileName = safeFileBaseName(path.basename(sourceName, path.extname(sourceName)), 'canvas-image') + extensionFromPath(sourceName);
      const target = uniqueFilePath(directory, fileName);
      fs.writeFileSync(target, entry.getData());
      const nextUrl = assetStore.assetUrl(target);
      if (asset.id) urlByAssetId.set(String(asset.id), nextUrl);
      if (asset.originalUrl) urlByOriginalUrl.set(String(asset.originalUrl), nextUrl);
    }
    const rewritten = rewriteImportedPackageUrls(canvas, urlByAssetId, urlByOriginalUrl);
    const created = createImportedCanvas(sanitizeCanvasForPackage(rewritten, { preserveLocalAssetUrls: true, preservePackageUrls: false }), projectId);
    return {
      ...created,
      warnings: Array.isArray(manifest.warnings) ? manifest.warnings : [],
    };
  }

  function importCanvas(payload = {}) {
    const selected = dialog.showOpenDialogSync({
      title: 'Import canvas',
      properties: ['openFile'],
      filters: [
        { name: 'Forart canvas files', extensions: ['forartcanvas', 'json'] },
        { name: 'Forart canvas package', extensions: ['forartcanvas'] },
        { name: 'Forart canvas JSON', extensions: ['json'] },
      ],
    });
    if (!selected?.length) return { ok: true, canceled: true };
    const filePath = selected[0];
    const ext = path.extname(filePath).toLowerCase();
    const result = ext === '.forartcanvas'
      ? importPackageFile(filePath, payload.projectId)
      : importJsonFile(filePath, payload.projectId);
    return { ...result, canceled: false };
  }

  return {
    createPackageForUpload,
    downloadPackageFromRemote,
    exportJson,
    exportPackage,
    importCanvas,
    importPackageFile: (filePath, projectId) => ({ ...importPackageFile(filePath, projectId), canceled: false }),
    uploadPackageToRemote,
  };
}

module.exports = {
  createCanvasPackageStore,
  sanitizeCanvasForJsonOnly,
  sanitizeCanvasForPackage,
};
