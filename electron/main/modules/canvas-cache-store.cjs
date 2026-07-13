const fs = require('fs');
const path = require('path');

const IMAGE_EXTENSIONS = new Set(['.avif', '.bmp', '.gif', '.heic', '.heif', '.jpg', '.jpeg', '.png', '.svg', '.webp']);

function isRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function safeString(value) {
  return String(value || '').trim();
}

function isInsideOrEqual(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return !relative || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function fileNameFromUrl(url) {
  try {
    const parsed = new URL(url);
    return decodeURIComponent(path.basename(parsed.pathname || ''));
  } catch {
    return path.basename(String(url || ''));
  }
}

function formatAssetId(filePath) {
  return path.resolve(filePath).replace(/\\/g, '/');
}

function isThumbPath(filePath) {
  return path.basename(path.dirname(filePath)).toLowerCase() === 'thumb';
}

function thumbPathForAsset(filePath) {
  const directory = path.dirname(filePath);
  const parsed = path.parse(filePath);
  return path.join(directory, 'thumb', `${parsed.name}.webp`);
}

function collectTasksFromUnknown(value, tasks = []) {
  if (!value) return tasks;
  if (Array.isArray(value)) {
    value.forEach((item) => collectTasksFromUnknown(item, tasks));
    return tasks;
  }
  if (!isRecord(value)) return tasks;
  if (isRecord(value.result) || Array.isArray(value.referenceImages)) tasks.push(value);
  Object.values(value).forEach((item) => collectTasksFromUnknown(item, tasks));
  return tasks;
}

function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function createCanvasCacheStore({ rootDir, assetStore, canvasStore, shell }) {
  function rootPath() {
    return assetStore.canvasAssetsRoot();
  }

  function inputRoot() {
    return assetStore.assetDirectory('input');
  }

  function outputRoot() {
    return assetStore.assetDirectory('output');
  }

  function isCleanupTarget(filePath) {
    const target = path.resolve(filePath);
    return isInsideOrEqual(inputRoot(), target) || isInsideOrEqual(outputRoot(), target);
  }

  function kindForPath(filePath) {
    const target = path.resolve(filePath);
    if (isInsideOrEqual(outputRoot(), target)) return 'output';
    return 'input';
  }

  function resolveLocalAsset(source) {
    const text = safeString(source);
    if (!text) return null;
    const assetPath = assetStore.resolveAssetUrl(text);
    if (assetPath && isCleanupTarget(assetPath)) {
      return {
        url: assetStore.assetUrl(assetPath),
        filePath: path.resolve(assetPath),
      };
    }
    const target = path.resolve(text);
    if (path.isAbsolute(text) && isCleanupTarget(target)) {
      return {
        url: assetStore.assetUrl(target),
        filePath: target,
      };
    }
    return null;
  }

  function addReference(referenceMap, source, reference) {
    const local = resolveLocalAsset(source);
    if (!local) return;
    const key = formatAssetId(local.filePath);
    const current = referenceMap.get(key) || {
      url: local.url,
      filePath: local.filePath,
      references: [],
    };
    current.references.push(reference);
    referenceMap.set(key, current);
  }

  function collectCanvasReferences(referenceMap) {
    const listed = canvasStore.listCanvases();
    for (const record of listed) {
      const canvas = canvasStore.readCanvas(record.id);
      if (!canvas || !Array.isArray(canvas.nodes)) continue;
      for (const node of canvas.nodes) {
        const nodeReference = (source) => ({
          canvasId: canvas.id,
          canvasTitle: canvas.title,
          nodeId: safeString(node.id),
          nodeTitle: safeString(node.title),
          source,
        });
        addReference(referenceMap, node.url, nodeReference('node.url'));
        addReference(referenceMap, node.filePath, nodeReference('node.filePath'));
        addReference(referenceMap, node.generationTask?.result?.localUrl, nodeReference('node.generationTask.result.localUrl'));
        if (Array.isArray(node.generationTask?.referenceImages)) {
          node.generationTask.referenceImages.forEach((url) => addReference(referenceMap, url, nodeReference('task.referenceImages')));
        }
        addReference(referenceMap, node.libtvImageGeneration?.latestRun?.localUrl, nodeReference('node.libtvImageGeneration.latestRun.localUrl'));
        addReference(referenceMap, node.libtvImageGeneration?.latestRun?.resultUrl, nodeReference('node.libtvImageGeneration.latestRun.localUrl'));

        const rows = Array.isArray(node.actionFission?.rows) ? node.actionFission.rows : [];
        for (const row of rows) {
          const rowReference = (source) => ({
            canvasId: canvas.id,
            canvasTitle: canvas.title,
            nodeId: safeString(node.id),
            nodeTitle: safeString(node.title || row.name || row.title),
            source,
          });
          addReference(referenceMap, row.resultUrl, rowReference('actionFission.row.resultUrl'));
          addReference(referenceMap, row.generationTask?.result?.localUrl, rowReference('actionFission.row.generationTask.result.localUrl'));
          if (Array.isArray(row.generationTask?.referenceImages)) {
            row.generationTask.referenceImages.forEach((url) => addReference(referenceMap, url, rowReference('task.referenceImages')));
          }
        }
      }
    }
  }

  function collectTaskRegistryReferences(referenceMap) {
    const registryPath = path.join(rootDir, 'CanvasAssests', 'tasks', 'generation-task-registry.json');
    const registry = readJson(registryPath);
    if (!registry) return;
    const tasks = collectTasksFromUnknown(registry);
    for (const task of tasks) {
      const reference = (source) => ({
        canvasId: safeString(task.canvasId),
        canvasTitle: safeString(task.canvasTitle || task.canvasId || 'Task registry'),
        nodeId: safeString(task.nodeId || task.target?.nodeId),
        nodeTitle: safeString(task.nodeTitle),
        source,
      });
      addReference(referenceMap, task.result?.localUrl, reference('task.result.localUrl'));
      if (Array.isArray(task.referenceImages)) {
        task.referenceImages.forEach((url) => addReference(referenceMap, url, reference('task.referenceImages')));
      }
    }
  }

  function enumerateAssetFiles(directory) {
    if (!fs.existsSync(directory)) return [];
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        files.push(...enumerateAssetFiles(filePath));
      } else if (entry.isFile() && !isThumbPath(filePath) && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(filePath);
      }
    }
    return files;
  }

  function assetRecord(filePath, referenceMap) {
    const stats = fs.statSync(filePath);
    const thumbPath = thumbPathForAsset(filePath);
    const thumbStats = fs.existsSync(thumbPath) ? fs.statSync(thumbPath) : null;
    const key = formatAssetId(filePath);
    const referenceEntry = referenceMap.get(key);
    return {
      id: key,
      kind: kindForPath(filePath),
      url: assetStore.assetUrl(filePath),
      filePath,
      fileName: path.basename(filePath),
      sizeBytes: stats.size,
      thumbUrl: thumbStats ? assetStore.assetUrl(thumbPath) : '',
      thumbFilePath: thumbStats ? thumbPath : '',
      thumbSizeBytes: thumbStats ? thumbStats.size : 0,
      modifiedAt: stats.mtimeMs,
      exists: true,
      referenced: Boolean(referenceEntry?.references.length),
      references: referenceEntry?.references || [],
    };
  }

  function missingReferenceRecord(referenceEntry) {
    return {
      id: formatAssetId(referenceEntry.filePath),
      kind: 'missing',
      url: referenceEntry.url,
      filePath: referenceEntry.filePath,
      fileName: fileNameFromUrl(referenceEntry.url) || path.basename(referenceEntry.filePath),
      sizeBytes: 0,
      modifiedAt: 0,
      exists: false,
      referenced: true,
      references: referenceEntry.references,
    };
  }

  function totalsFor(assets, missingReferences) {
    const totals = {
      inputCount: 0,
      inputBytes: 0,
      outputCount: 0,
      outputBytes: 0,
      referencedCount: 0,
      referencedBytes: 0,
      cleanableCount: 0,
      cleanableBytes: 0,
      missingReferenceCount: missingReferences.length,
    };
    for (const asset of assets) {
      if (asset.kind === 'input') {
        totals.inputCount += 1;
        totals.inputBytes += asset.sizeBytes + Number(asset.thumbSizeBytes || 0);
      }
      if (asset.kind === 'output') {
        totals.outputCount += 1;
        totals.outputBytes += asset.sizeBytes + Number(asset.thumbSizeBytes || 0);
      }
      if (asset.referenced) {
        totals.referencedCount += 1;
        totals.referencedBytes += asset.sizeBytes + Number(asset.thumbSizeBytes || 0);
      } else {
        totals.cleanableCount += 1;
        totals.cleanableBytes += asset.sizeBytes + Number(asset.thumbSizeBytes || 0);
      }
    }
    return totals;
  }

  function scan() {
    const referenceMap = new Map();
    collectCanvasReferences(referenceMap);
    collectTaskRegistryReferences(referenceMap);
    const files = [...enumerateAssetFiles(inputRoot()), ...enumerateAssetFiles(outputRoot())];
    const assets = files.map((filePath) => assetRecord(filePath, referenceMap));
    const existingIds = new Set(assets.map((asset) => asset.id));
    const missingReferences = Array.from(referenceMap.values())
      .filter((entry) => !existingIds.has(formatAssetId(entry.filePath)) && isCleanupTarget(entry.filePath))
      .map(missingReferenceRecord);
    assets.sort((a, b) => b.modifiedAt - a.modifiedAt);
    missingReferences.sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: 'base' }));
    return {
      rootPath: rootPath(),
      scannedAt: Date.now(),
      assets,
      missingReferences,
      totals: totalsFor(assets, missingReferences),
    };
  }

  function deleteAssets(payload = {}) {
    const ids = new Set(Array.isArray(payload.ids) ? payload.ids.map(formatAssetId) : []);
    const current = scan();
    const byId = new Map(current.assets.map((asset) => [asset.id, asset]));
    let deletedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    let freedBytes = 0;
    const failures = [];

    for (const id of ids) {
      const asset = byId.get(id);
      if (!asset || !asset.exists || asset.referenced || !isCleanupTarget(asset.filePath)) {
        skippedCount += 1;
        continue;
      }
      try {
        const stats = fs.existsSync(asset.filePath) ? fs.statSync(asset.filePath) : null;
        if (!stats) {
          skippedCount += 1;
          continue;
        }
        fs.unlinkSync(asset.filePath);
        const thumbPath = thumbPathForAsset(asset.filePath);
        if (fs.existsSync(thumbPath)) {
          const thumbStats = fs.statSync(thumbPath);
          fs.unlinkSync(thumbPath);
          freedBytes += thumbStats.size;
        }
        deletedCount += 1;
        freedBytes += stats.size;
      } catch (error) {
        failedCount += 1;
        failures.push({ id, message: error instanceof Error ? error.message : String(error) });
      }
    }

    return { ok: true, deletedCount, skippedCount, failedCount, freedBytes, failures };
  }

  function revealAsset(payload = {}) {
    const target = path.resolve(String(payload.filePath || payload.id || ''));
    if (!isCleanupTarget(target)) throw new Error('Asset is outside the canvas cache.');
    if (fs.existsSync(target)) {
      shell.showItemInFolder(target);
      return { ok: true };
    }
    shell.openPath(path.dirname(target));
    return { ok: true };
  }

  function openRoot() {
    shell.openPath(rootPath());
    return { ok: true };
  }

  return {
    deleteAssets,
    openRoot,
    revealAsset,
    scan,
  };
}

module.exports = { createCanvasCacheStore };
