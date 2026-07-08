const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { dialog } = require('electron');

const SUPPORTED_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const PROMPT_LIMIT = 4000;
const DISCOVERY_PROGRESS_BATCH_SIZE = 250;
const ROW_PROGRESS_BATCH_SIZE = 40;

let activePreview = null;
const activeScans = new Map();

function compareByName(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function rowIdFor(value) {
  return crypto.createHash('sha1').update(`action-import-row:${value}`).digest('hex').slice(0, 24);
}

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function fileStem(fileName) {
  return String(fileName || '').replace(/\.[^.]+$/, '');
}

function isHiddenOrSystemName(fileName) {
  const name = String(fileName || '');
  return !name || name.startsWith('.') || name === 'Thumbs.db' || name === 'desktop.ini';
}

function collectWindowsHiddenOrSystemNames(sourceRoot) {
  if (process.platform !== 'win32') return new Set();
  try {
    const output = execFileSync('attrib', [path.join(sourceRoot, '*')], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    const ignored = new Set();
    for (const line of String(output || '').split(/\r?\n/)) {
      const flags = line.slice(0, 20).toUpperCase();
      if (!flags.includes('H') && !flags.includes('S')) continue;
      const filePath = line.slice(20).trim();
      if (filePath) ignored.add(path.basename(filePath));
    }
    return ignored;
  } catch {
    return new Set();
  }
}

function isIgnoredImportFile(fileName, ignoredAttributeNames = new Set()) {
  if (isHiddenOrSystemName(fileName)) return true;
  return ignoredAttributeNames.has(fileName);
}

function mimeTypeForImage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

function isDirectory(filePath) {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function isRegularFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function validateActionName(name, existingNames) {
  const errors = [];
  if (!name) errors.push({ code: 'invalid_name', message: 'Action name is required' });
  if (name.length > 80) errors.push({ code: 'invalid_name', message: 'Action name must be 80 characters or fewer' });
  if (/[<>:"/\\|?*\x00-\x1f]/.test(name)) errors.push({ code: 'invalid_name', message: 'Action name contains invalid filename characters' });
  if (name === '.' || name === '..' || /[ .]$/.test(name)) errors.push({ code: 'invalid_name', message: 'Action name cannot end with a space or period' });
  if (existingNames.has(name)) errors.push({ code: 'duplicate_name', message: 'Action name already exists in this project' });
  return errors;
}

function decodeTextBuffer(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
  } catch {
    try {
      return new TextDecoder('gb18030').decode(buffer).replace(/^\uFEFF/, '');
    } catch {
      return buffer.toString('utf8').replace(/^\uFEFF/, '');
    }
  }
}

function readPromptFile(filePath) {
  const text = decodeTextBuffer(fs.readFileSync(filePath));
  if (text.length <= PROMPT_LIMIT) return { prompt: text, truncated: false, originalLength: text.length };
  return { prompt: text.slice(0, PROMPT_LIMIT), truncated: true, originalLength: text.length };
}

function statusFor(errors, warnings) {
  if (errors.some((error) => error.code === 'missing_image')) return 'missing_image';
  if (errors.some((error) => error.code === 'missing_text')) return 'missing_text';
  if (errors.some((error) => error.code === 'duplicate_name')) return 'duplicate_name';
  if (errors.some((error) => error.code === 'ambiguous_image')) return 'ambiguous_image';
  if (errors.some((error) => error.code === 'invalid_name')) return 'invalid_name';
  if (errors.length) return 'unreadable';
  if (warnings.length) return 'warning';
  return 'ready';
}

function createSummary(projectId, sourceRoot, imageByStem, textByStem, rows = []) {
  const readyRows = rows.filter((row) => !row.errors.length);
  return {
    preview_id: '',
    source_path: sourceRoot,
    project_id: projectId,
    total_images: Array.from(imageByStem.values()).reduce((total, images) => total + images.length, 0),
    total_text_files: textByStem.size,
    ready_count: readyRows.length,
    selected_count: readyRows.length,
    blocking_error_count: rows.filter((row) => row.errors.length).length,
    warning_count: rows.filter((row) => row.warnings.length).length,
    rows,
  };
}

function buildImportRow({ sourceRoot, previewId, stem, images, text, existingNames, seenNames, duplicateInBatch, rowFiles }) {
  const image = images.length === 1 ? images[0] : null;
  const proposedName = normalizeName(stem);
  if (seenNames.has(proposedName)) duplicateInBatch.add(proposedName);
  seenNames.add(proposedName);

  const errors = [];
  const warnings = [];
  if (!images.length) errors.push({ code: 'missing_image', message: 'Missing matching image file' });
  if (images.length > 1) errors.push({ code: 'ambiguous_image', message: 'Multiple image files share the same filename stem' });
  if (!text) errors.push({ code: 'missing_text', message: 'Missing matching .txt file' });
  errors.push(...validateActionName(proposedName, existingNames));
  if (image?.path && !isRegularFile(image.path)) errors.push({ code: 'unreadable_image', message: 'Image file is unreadable' });
  if (text?.path) {
    try {
      const promptInfo = readPromptFile(text.path);
      if (promptInfo.truncated) {
        warnings.push({ code: 'prompt_truncated', message: `Prompt is ${promptInfo.originalLength} characters and will be truncated to ${PROMPT_LIMIT}` });
      }
    } catch (error) {
      errors.push({ code: 'unreadable_text', message: error instanceof Error ? error.message : String(error) });
    }
  }

  const rowSeed = image?.path || text?.path || stem;
  const id = rowIdFor(path.relative(sourceRoot, rowSeed) || stem);
  const relativePath = image?.path
    ? path.relative(sourceRoot, image.path)
    : text?.path
      ? path.relative(sourceRoot, text.path)
      : stem;
  rowFiles.set(id, { imagePath: image?.path || '', textPath: text?.path || '' });
  return {
    id,
    stem,
    filename: image?.fileName || text?.fileName || stem,
    relative_path: relativePath,
    image_path: null,
    text_path: null,
    proposed_name: proposedName,
    thumbnail_url: image?.path ? `forart-asset://action-folder-import-preview/${encodeURIComponent(previewId)}/${encodeURIComponent(id)}` : '',
    selectable: true,
    selected: errors.length === 0,
    status: statusFor(errors, warnings),
    errors,
    warnings,
  };
}

function applyDuplicateInBatchErrors(rows, duplicateInBatch) {
  for (const row of rows) {
    if (duplicateInBatch.has(row.proposed_name)) {
      row.errors.push({ code: 'duplicate_name', message: 'Duplicate action name in selected folder' });
      row.status = 'duplicate_name';
      row.selected = false;
    }
  }
}

function scanDirectory(sourcePath) {
  const sourceRoot = path.resolve(String(sourcePath || '').trim());
  if (!sourceRoot || !fs.existsSync(sourceRoot) || !isDirectory(sourceRoot)) {
    throw new Error('Import folder does not exist or is not a folder');
  }

  const imageByStem = new Map();
  const textByStem = new Map();
  const ignoredAttributeNames = collectWindowsHiddenOrSystemNames(sourceRoot);
  const entries = fs.readdirSync(sourceRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((fileName) => !isIgnoredImportFile(fileName, ignoredAttributeNames))
    .sort(compareByName);

  for (const fileName of entries) {
    const ext = path.extname(fileName).toLowerCase();
    const stem = fileStem(fileName);
    const absolutePath = path.join(sourceRoot, fileName);
    if (SUPPORTED_IMAGE_EXTENSIONS.has(ext)) {
      const list = imageByStem.get(stem) || [];
      list.push({ fileName, path: absolutePath });
      imageByStem.set(stem, list);
    } else if (ext === '.txt') {
      textByStem.set(stem, { fileName, path: absolutePath });
    }
  }

  return { sourceRoot, imageByStem, textByStem };
}

function assertImportFolder(sourcePath) {
  const sourceRoot = path.resolve(String(sourcePath || '').trim());
  if (!sourceRoot || !fs.existsSync(sourceRoot) || !isDirectory(sourceRoot)) {
    throw new Error('Import folder does not exist or is not a folder');
  }
  return sourceRoot;
}

function emitScan(sender, channel, payload) {
  if (!sender || sender.isDestroyed()) return;
  sender.send(channel, payload);
}

function scanIsCanceled(scanId) {
  return activeScans.get(scanId)?.canceled !== false;
}

function delayToRenderer() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createActionFolderImportStore() {
  async function chooseFolder(payload = {}) {
    const result = await dialog.showOpenDialog({
      title: payload.title || 'Choose import folder',
      properties: ['openDirectory'],
    });
    return {
      canceled: Boolean(result.canceled),
      path: result.filePaths?.[0] || '',
    };
  }

  function scan(payload = {}) {
    const projectId = String(payload.projectId || '');
    const { sourceRoot, imageByStem, textByStem } = scanDirectory(payload.sourcePath);
    const existingNames = new Set((payload.existingActionNames || []).map(normalizeName));
    const stems = Array.from(new Set([...imageByStem.keys(), ...textByStem.keys()])).sort(compareByName);
    const duplicateInBatch = new Set();
    const seenNames = new Set();
    const previewId = crypto.randomUUID().replace(/-/g, '');
    const rowFiles = new Map();
    const rows = [];

    for (const stem of stems) {
      rows.push(buildImportRow({
        sourceRoot,
        previewId,
        stem,
        images: imageByStem.get(stem) || [],
        text: textByStem.get(stem) || null,
        existingNames,
        seenNames,
        duplicateInBatch,
        rowFiles,
      }));
    }

    applyDuplicateInBatchErrors(rows, duplicateInBatch);

    activePreview = { id: previewId, sourceRoot, rowFiles };
    return {
      ...createSummary(projectId, sourceRoot, imageByStem, textByStem, rows),
      preview_id: previewId,
    };
  }

  async function runScan(scanId, sender, payload = {}) {
    const projectId = String(payload.projectId || '');
    try {
      const sourceRoot = assertImportFolder(payload.sourcePath);
      const existingNames = new Set((payload.existingActionNames || []).map(normalizeName));
      const previewId = crypto.randomUUID().replace(/-/g, '');
      const imageByStem = new Map();
      const textByStem = new Map();
      const rowFiles = new Map();
      activePreview = { id: previewId, sourceRoot, rowFiles };
      const ignoredAttributeNames = collectWindowsHiddenOrSystemNames(sourceRoot);
      const dirEntries = await fs.promises.readdir(sourceRoot, { withFileTypes: true });
      const entries = dirEntries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((fileName) => !isIgnoredImportFile(fileName, ignoredAttributeNames))
        .sort(compareByName);

      emitScan(sender, 'action-import:scan-progress', {
        scanId,
        phase: 'discovering',
        sourcePath: sourceRoot,
        processedFiles: 0,
        totalFiles: entries.length,
        rows: [],
        summary: createSummary(projectId, sourceRoot, imageByStem, textByStem),
      });

      for (const [index, fileName] of entries.entries()) {
        if (scanIsCanceled(scanId)) return;
        const ext = path.extname(fileName).toLowerCase();
        const stem = fileStem(fileName);
        const absolutePath = path.join(sourceRoot, fileName);
        if (SUPPORTED_IMAGE_EXTENSIONS.has(ext)) {
          const list = imageByStem.get(stem) || [];
          list.push({ fileName, path: absolutePath });
          imageByStem.set(stem, list);
        } else if (ext === '.txt') {
          textByStem.set(stem, { fileName, path: absolutePath });
        }

        if ((index + 1) % DISCOVERY_PROGRESS_BATCH_SIZE === 0 || index === entries.length - 1) {
          emitScan(sender, 'action-import:scan-progress', {
            scanId,
            phase: 'discovering',
            sourcePath: sourceRoot,
            processedFiles: index + 1,
            totalFiles: entries.length,
            rows: [],
            summary: createSummary(projectId, sourceRoot, imageByStem, textByStem),
          });
          await delayToRenderer();
        }
      }

      if (scanIsCanceled(scanId)) return;
      const stems = Array.from(new Set([...imageByStem.keys(), ...textByStem.keys()])).sort(compareByName);
      const duplicateInBatch = new Set();
      const seenNames = new Set();
      const rows = [];
      let pendingRows = [];

      for (const [index, stem] of stems.entries()) {
        if (scanIsCanceled(scanId)) return;
        const row = buildImportRow({
          sourceRoot,
          previewId,
          stem,
          images: imageByStem.get(stem) || [],
          text: textByStem.get(stem) || null,
          existingNames,
          seenNames,
          duplicateInBatch,
          rowFiles,
        });
        rows.push(row);
        pendingRows.push(row);

        if (pendingRows.length >= ROW_PROGRESS_BATCH_SIZE || index === stems.length - 1) {
          emitScan(sender, 'action-import:scan-progress', {
            scanId,
            phase: 'building',
            sourcePath: sourceRoot,
            processedFiles: entries.length,
            totalFiles: entries.length,
            builtRows: rows.length,
            totalRows: stems.length,
            rows: pendingRows,
            summary: createSummary(projectId, sourceRoot, imageByStem, textByStem, rows),
          });
          pendingRows = [];
          await delayToRenderer();
        }
      }

      if (scanIsCanceled(scanId)) return;
      applyDuplicateInBatchErrors(rows, duplicateInBatch);
      const preview = {
        ...createSummary(projectId, sourceRoot, imageByStem, textByStem, rows),
        preview_id: previewId,
      };
      emitScan(sender, 'action-import:scan-complete', { scanId, preview });
    } catch (error) {
      if (!scanIsCanceled(scanId)) {
        emitScan(sender, 'action-import:scan-error', {
          scanId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      activeScans.delete(scanId);
    }
  }

  function startScan(sender, payload = {}) {
    const scanId = String(payload.scanId || crypto.randomUUID().replace(/-/g, ''));
    activeScans.set(scanId, { canceled: false });
    setImmediate(() => {
      void runScan(scanId, sender, payload);
    });
    return { scanId };
  }

  function cancelScan(payload = {}) {
    const scanId = String(payload.scanId || '');
    if (scanId && activeScans.has(scanId)) {
      activeScans.set(scanId, { canceled: true });
    }
    return { ok: true };
  }

  function readEntry(payload = {}) {
    const previewId = String(payload.previewId || '');
    const rowId = String(payload.rowId || '');
    if (!activePreview || activePreview.id !== previewId) throw new Error('Import preview is no longer active. Rescan the folder.');
    const rowFiles = activePreview.rowFiles.get(rowId);
    if (!rowFiles?.imagePath || !rowFiles?.textPath) throw new Error('Selected row is not importable');
    const promptInfo = readPromptFile(rowFiles.textPath);
    const imageBuffer = fs.readFileSync(rowFiles.imagePath);
    return {
      data: imageBuffer.toString('base64'),
      filename: path.basename(rowFiles.imagePath),
      mime_type: mimeTypeForImage(rowFiles.imagePath),
      prompt: promptInfo.prompt,
    };
  }

  function resolvePreviewUrl(urlText) {
    let url;
    try {
      url = new URL(urlText);
    } catch {
      return '';
    }
    if (url.protocol !== 'forart-asset:' || url.host !== 'action-folder-import-preview') return '';
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const previewId = parts[0] || '';
    const rowId = parts[1] || '';
    if (!activePreview || activePreview.id !== previewId || !rowId) return '';
    return activePreview.rowFiles.get(rowId)?.imagePath || '';
  }

  function clearPreview() {
    activePreview = null;
    return { ok: true };
  }

  return {
    cancelScan,
    chooseFolder,
    clearPreview,
    readEntry,
    resolvePreviewUrl,
    scan,
    startScan,
  };
}

module.exports = { createActionFolderImportStore };
