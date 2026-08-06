const fs = require('fs');
const path = require('path');
const fsp = fs.promises;

const REVIEW_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);
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

async function collectReviewImages(dir, rootPath) {
  try {
    const entries = (await fsp.readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && isReviewImageFile(path.join(dir, entry.name)));
    const images = await Promise.all(entries.map(async (entry) => {
        const absolutePath = path.join(dir, entry.name);
        const stats = await fsp.stat(absolutePath);
        const relativePath = reviewRelativePath(rootPath, absolutePath);
        const encodedRoot = encodeURIComponent(path.resolve(rootPath));
        const encodedPath = encodeURIComponent(relativePath);
        const originalUrl = `forart-review://image?root=${encodedRoot}&path=${encodedPath}`;
        const thumbnailUrl = `forart-review-thumb://image?root=${encodedRoot}&path=${encodedPath}&size=132&mtime=${Math.round(stats.mtimeMs)}&bytes=${stats.size}`;
        const previewUrl = `forart-review-preview://image?root=${encodedRoot}&path=${encodedPath}&size=700&mtime=${Math.round(stats.mtimeMs)}&bytes=${stats.size}`;
        return {
          id: `${relativePath}-${stats.mtimeMs}-${stats.size}`,
          name: entry.name,
          relativePath,
          originalUrl,
          thumbnailUrl,
          previewUrl,
          size: stats.size,
          lastModified: Math.round(stats.mtimeMs),
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

async function loadProductImages({ root, productId, modelFolders, detailFolders }) {
  const productDir = reviewAbsolutePath(root, productId);
  const productStats = await fsp.stat(productDir).catch(() => null);
  if (!productStats?.isDirectory()) throw new Error('Product not found');
  const modelFolderSet = parseReviewFolderNames(modelFolders);
  const detailFolderSet = parseReviewFolderNames(detailFolders);
  const product = {
    id: productId,
    hasModelImages: false,
    modelImages: [],
    detailImages: [],
  };

  for (const folderName of await listReviewDirectories(productDir)) {
    const normalized = normalizeReviewFolderName(folderName);
    if (!modelFolderSet.has(normalized) && !detailFolderSet.has(normalized)) continue;
    const images = await collectReviewImages(path.join(productDir, folderName), root);
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
  };
}

module.exports = {
  createImageReviewStore: () => {
    const authorizedRoots = new Set();

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

    return {
      authorizeRoot,
      loadProductImages: (payload = {}) => loadProductImages({ ...payload, root: requireAuthorizedRoot(payload.root) }),
      loadProducts: (payload = {}) => loadProducts({ ...payload, root: requireAuthorizedRoot(payload.root) }),
      resolveProductDirectory: (payload = {}) => resolveProductDirectory({ ...payload, root: requireAuthorizedRoot(payload.root) }),
      resolveImageUrl: (urlText) => resolveImageUrl(urlText, requireAuthorizedRoot),
      resolveScaledImageUrl: (urlText) => resolveScaledImageUrl(urlText, requireAuthorizedRoot),
    };
  },
};
