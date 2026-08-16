const fs = require('fs');
const path = require('path');
const fsp = fs.promises;

const REVIEW_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);
const REVIEW_STATUSES = new Set(['approved', 'rejected']);

function reviewStatusFilePath(productDir) {
  const productId = path.basename(path.resolve(productDir));
  return path.join(productDir, `${productId}-review.json`);
}

function emptyReviewStatusDocument() {
  return { schemaVersion: 1, images: Object.create(null) };
}

async function readReviewStatusDocument(productDir, strict = false) {
  const statusPath = reviewStatusFilePath(productDir);
  let parsed;
  try {
    parsed = JSON.parse(await fsp.readFile(statusPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyReviewStatusDocument();
    if (strict) throw new Error('Image review status file is invalid');
    return emptyReviewStatusDocument();
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    if (strict) throw new Error('Image review status file is invalid');
    return emptyReviewStatusDocument();
  }

  const images = Object.create(null);
  if (parsed.images && typeof parsed.images === 'object' && !Array.isArray(parsed.images)) {
    for (const [relativePath, record] of Object.entries(parsed.images)) {
      if (!record || typeof record !== 'object' || !REVIEW_STATUSES.has(record.status)) continue;
      images[relativePath] = { status: record.status };
    }
  }
  return {
    schemaVersion: 1,
    images,
  };
}

async function writeReviewStatusDocument(productDir, document) {
  const statusPath = reviewStatusFilePath(productDir);
  const temporaryPath = `${statusPath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await fsp.writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
    await fsp.rename(temporaryPath, statusPath);
  } catch (error) {
    await fsp.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

function normalizeReviewFolderName(value) {
  return String(value || '').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function parseReviewFolderNames(value) {
  return new Set(
    String(value || '')
      .split(/[,，、\n]/)
      .map(normalizeReviewFolderName)
      .filter(Boolean)
  );
}

async function listReviewDirectories(dir) {
  try {
    return (await fsp.readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  } catch {
    return [];
  }
}

function isReviewImageFile(filePath) {
  return REVIEW_IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function hasReviewImageInDirectory(dir) {
  try {
    return (await fsp.readdir(dir, { withFileTypes: true })).some((entry) => entry.isFile() && isReviewImageFile(path.join(dir, entry.name)));
  } catch {
    return false;
  }
}

function assertInsideRoot(root, absolutePath) {
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(absolutePath);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('Invalid review path');
  }
  return resolvedPath;
}

function validatedReviewRoot(rootPath) {
  const root = path.resolve(String(rootPath || '').trim());
  if (!rootPath) throw new Error('Review root is required');
  if (!fs.existsSync(root)) throw new Error('Review root not found');
  if (!fs.statSync(root).isDirectory()) throw new Error('Review root is not a directory');
  return root;
}

function reviewAbsolutePath(rootPath, relativePath = '') {
  const root = path.resolve(String(rootPath || '').trim());
  if (!rootPath) throw new Error('Review root is required');
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  return assertInsideRoot(root, path.resolve(root, ...normalized.split('/').filter(Boolean)));
}

function reviewRelativePath(rootPath, absolutePath) {
  return path.relative(path.resolve(rootPath), assertInsideRoot(rootPath, absolutePath)).split(path.sep).join('/');
}

async function productHasModelImages(productDir, modelFolders) {
  if (!modelFolders.size) return false;
  for (const folderName of await listReviewDirectories(productDir)) {
    if (modelFolders.has(normalizeReviewFolderName(folderName)) && await hasReviewImageInDirectory(path.join(productDir, folderName))) return true;
  }
  return false;
}

async function collectReviewImages(dir, rootPath, productDir, reviewRecords, requestPriority) {
  try {
    const entries = (await fsp.readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && isReviewImageFile(path.join(dir, entry.name)));
    const images = await Promise.all(entries.map(async (entry) => {
        const absolutePath = path.join(dir, entry.name);
        const stats = await fsp.stat(absolutePath);
        const relativePath = reviewRelativePath(rootPath, absolutePath);
        const productRelativePath = reviewRelativePath(productDir, absolutePath);
        const reviewRecord = reviewRecords[productRelativePath];
        const encodedRoot = encodeURIComponent(path.resolve(rootPath));
        const encodedPath = encodeURIComponent(relativePath);
        const versionQuery = `mtime=${Math.round(stats.mtimeMs)}&bytes=${stats.size}&priority=${requestPriority}`;
        const originalUrl = `forart-review://image?root=${encodedRoot}&path=${encodedPath}&${versionQuery}`;
        const thumbnailUrl = `forart-review-thumb://image?root=${encodedRoot}&path=${encodedPath}&size=132&${versionQuery}`;
        const previewUrl = `forart-review-preview://image?root=${encodedRoot}&path=${encodedPath}&size=700&${versionQuery}`;
        return {
          id: `${relativePath}-${stats.mtimeMs}-${stats.size}`,
          name: entry.name,
          relativePath,
          originalUrl,
          thumbnailUrl,
          previewUrl,
          size: stats.size,
          lastModified: Math.round(stats.mtimeMs),
          reviewStatus: reviewRecord?.status || null,
        };
      }));
    return images.sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true, sensitivity: 'base' }));
  } catch {
    return [];
  }
}

async function loadProducts({ root, modelFolders }) {
  const reviewRoot = path.resolve(root);
  const productIds = await listReviewDirectories(reviewRoot);
  const modelFolderSet = parseReviewFolderNames(modelFolders);
  return Promise.all(productIds.map(async (productId) => {
    const productDir = path.join(reviewRoot, productId);
    return {
      id: productId,
      hasModelImages: await productHasModelImages(productDir, modelFolderSet),
      modelImages: [],
      detailImages: [],
    };
  }));
}

async function loadProductImages({ root, productId, modelFolders, detailFolders, requestPriority = 0 }) {
  const productDir = reviewAbsolutePath(root, productId);
  const productStats = await fsp.stat(productDir).catch(() => null);
  if (!productStats?.isDirectory()) throw new Error('Product not found');
  const modelFolderSet = parseReviewFolderNames(modelFolders);
  const detailFolderSet = parseReviewFolderNames(detailFolders);
  const reviewStatusDocument = await readReviewStatusDocument(productDir);
  const product = {
    id: productId,
    hasModelImages: false,
    modelImages: [],
    detailImages: [],
  };

  for (const folderName of await listReviewDirectories(productDir)) {
    const normalized = normalizeReviewFolderName(folderName);
    if (!modelFolderSet.has(normalized) && !detailFolderSet.has(normalized)) continue;
    const images = await collectReviewImages(
      path.join(productDir, folderName),
      root,
      productDir,
      reviewStatusDocument.images,
      Math.max(0, Number(requestPriority) || 0),
    );
    if (modelFolderSet.has(normalized)) product.modelImages.push(...images);
    else product.detailImages.push(...images);
  }

  product.hasModelImages = product.modelImages.length > 0;
  return product;
}

function resolveProductDirectory({ root, productId }) {
  const normalizedProductId = String(productId || '').trim();
  if (!normalizedProductId || normalizedProductId === '.' || normalizedProductId === '..' || /[\\/]/.test(normalizedProductId)) {
    throw new Error('Invalid product path');
  }
  const productDir = reviewAbsolutePath(root, normalizedProductId);
  if (!fs.existsSync(productDir) || !fs.statSync(productDir).isDirectory()) return null;
  return productDir;
}

async function setImageReviewStatus({ root, productId, imageRelativePath, status }) {
  if (status !== null && !REVIEW_STATUSES.has(status)) throw new Error('Invalid image review status');
  const productDir = resolveProductDirectory({ root, productId });
  if (!productDir) throw new Error('Product not found');
  const imagePath = reviewAbsolutePath(root, imageRelativePath);
  assertInsideRoot(productDir, imagePath);
  const stats = await fsp.stat(imagePath).catch(() => null);
  if (!stats?.isFile() || !isReviewImageFile(imagePath)) throw new Error('Review image not found');

  const document = await readReviewStatusDocument(productDir, true);
  const reviewPath = reviewRelativePath(productDir, imagePath);
  if (status === null) {
    if (!Object.hasOwn(document.images, reviewPath)) return { status: null };
    delete document.images[reviewPath];
  } else {
    document.images[reviewPath] = { status };
  }
  await writeReviewStatusDocument(productDir, document);
  return { status };
}

function resolveImageUrl(urlText, authorizeRoot) {
  const url = new URL(urlText);
  const root = authorizeRoot(url.searchParams.get('root') || '');
  const imagePath = url.searchParams.get('path') || '';
  const filePath = reviewAbsolutePath(root, imagePath);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
  return filePath;
}

function resolveScaledImageUrl(urlText, authorizeRoot) {
  const url = new URL(urlText);
  const root = authorizeRoot(url.searchParams.get('root') || '');
  const imagePath = url.searchParams.get('path') || '';
  const filePath = reviewAbsolutePath(root, imagePath);
  const requestedSize = Number(url.searchParams.get('size') || 132);
  return {
    filePath,
    size: Number.isFinite(requestedSize) ? Math.max(48, Math.min(2048, Math.round(requestedSize))) : 132,
    priority: Math.max(0, Number(url.searchParams.get('priority')) || 0),
  };
}

module.exports = {
  createImageReviewStore: () => {
    const authorizedRoots = new Set();
    const reviewStatusWriteQueues = new Map();

    function rootKey(rootPath) {
      const root = path.resolve(String(rootPath || '').trim());
      return process.platform === 'win32' ? root.toLocaleLowerCase() : root;
    }

    function authorizeRoot(rootPath) {
      const root = validatedReviewRoot(rootPath);
      authorizedRoots.add(rootKey(root));
      return root;
    }

    function requireAuthorizedRoot(rootPath) {
      const root = path.resolve(String(rootPath || '').trim());
      if (!rootPath) throw new Error('Review root is required');
      if (!authorizedRoots.has(rootKey(root))) throw new Error('Review root is not authorized');
      return root;
    }

    async function queueImageReviewStatus(payload = {}) {
      const root = requireAuthorizedRoot(payload.root);
      const productId = String(payload.productId || '');
      const queueKey = rootKey(path.join(root, productId));
      const previousWrite = reviewStatusWriteQueues.get(queueKey) || Promise.resolve();
      const currentWrite = previousWrite
        .catch(() => {})
        .then(() => setImageReviewStatus({ ...payload, root, productId }));
      reviewStatusWriteQueues.set(queueKey, currentWrite);
      try {
        return await currentWrite;
      } finally {
        if (reviewStatusWriteQueues.get(queueKey) === currentWrite) reviewStatusWriteQueues.delete(queueKey);
      }
    }

    return {
      authorizeRoot,
      loadProductImages: (payload = {}) => loadProductImages({ ...payload, root: requireAuthorizedRoot(payload.root) }),
      loadProducts: (payload = {}) => loadProducts({ ...payload, root: requireAuthorizedRoot(payload.root) }),
      resolveProductDirectory: (payload = {}) => resolveProductDirectory({ ...payload, root: requireAuthorizedRoot(payload.root) }),
      setImageReviewStatus: queueImageReviewStatus,
      resolveImageUrl: (urlText) => resolveImageUrl(urlText, requireAuthorizedRoot),
      resolveScaledImageUrl: (urlText) => resolveScaledImageUrl(urlText, requireAuthorizedRoot),
    };
  },
};
