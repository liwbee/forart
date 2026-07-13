const fs = require('fs');
const path = require('path');

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

function listReviewDirectories(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
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

function hasReviewImageInDirectory(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).some((entry) => entry.isFile() && isReviewImageFile(path.join(dir, entry.name)));
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

function selectedReviewRoot(rootPath) {
  const root = path.resolve(String(rootPath || '').trim());
  if (!rootPath) throw new Error('Review root is required');
  if (!fs.existsSync(root)) throw new Error('Review root not found');
  if (!fs.statSync(root).isDirectory()) throw new Error('Review root is not a directory');
  return root;
}

function reviewAbsolutePath(rootPath, relativePath = '') {
  const root = selectedReviewRoot(rootPath);
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  return assertInsideRoot(root, path.resolve(root, ...normalized.split('/').filter(Boolean)));
}

function reviewRelativePath(rootPath, absolutePath) {
  return path.relative(selectedReviewRoot(rootPath), absolutePath).split(path.sep).join('/');
}

function productHasModelImages(productDir, modelFolderValue) {
  const modelFolders = parseReviewFolderNames(modelFolderValue);
  if (!modelFolders.size) return false;
  for (const folderName of listReviewDirectories(productDir)) {
    if (modelFolders.has(normalizeReviewFolderName(folderName)) && hasReviewImageInDirectory(path.join(productDir, folderName))) return true;
  }
  return false;
}

function collectReviewImages(dir, rootPath) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && isReviewImageFile(path.join(dir, entry.name)))
      .map((entry) => {
        const absolutePath = path.join(dir, entry.name);
        const stats = fs.statSync(absolutePath);
        const relativePath = reviewRelativePath(rootPath, absolutePath);
        return {
          id: `${relativePath}-${stats.mtimeMs}-${stats.size}`,
          name: entry.name,
          relativePath,
          url: `forart-review://image?root=${encodeURIComponent(path.resolve(rootPath))}&path=${encodeURIComponent(relativePath)}`,
          size: stats.size,
          lastModified: Math.round(stats.mtimeMs),
        };
      })
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true, sensitivity: 'base' }));
  } catch {
    return [];
  }
}

function loadProducts({ root, modelFolders }) {
  const reviewRoot = selectedReviewRoot(root);
  return listReviewDirectories(reviewRoot).map((productId) => {
    const productDir = path.join(reviewRoot, productId);
    return {
      id: productId,
      hasModelImages: productHasModelImages(productDir, modelFolders),
      modelImages: [],
      detailImages: [],
    };
  });
}

function loadProductImages({ root, productId, modelFolders, detailFolders }) {
  const productDir = reviewAbsolutePath(root, productId);
  if (!fs.existsSync(productDir) || !fs.statSync(productDir).isDirectory()) throw new Error('Product not found');
  const modelFolderSet = parseReviewFolderNames(modelFolders);
  const detailFolderSet = parseReviewFolderNames(detailFolders);
  const product = {
    id: productId,
    hasModelImages: false,
    modelImages: [],
    detailImages: [],
  };

  for (const folderName of listReviewDirectories(productDir)) {
    const normalized = normalizeReviewFolderName(folderName);
    if (!modelFolderSet.has(normalized) && !detailFolderSet.has(normalized)) continue;
    const images = collectReviewImages(path.join(productDir, folderName), root);
    if (modelFolderSet.has(normalized)) product.modelImages.push(...images);
    else product.detailImages.push(...images);
  }

  product.modelImages.sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true, sensitivity: 'base' }));
  product.detailImages.sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true, sensitivity: 'base' }));
  product.hasModelImages = product.modelImages.length > 0;
  return product;
}

function resolveImageUrl(urlText, authorizeRoot) {
  const url = new URL(urlText);
  const root = authorizeRoot(url.searchParams.get('root') || '');
  const imagePath = url.searchParams.get('path') || '';
  const filePath = reviewAbsolutePath(root, imagePath);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
  return filePath;
}

module.exports = {
  createImageReviewStore: () => {
    const authorizedRoots = new Set();

    function rootKey(rootPath) {
      const root = selectedReviewRoot(rootPath);
      return process.platform === 'win32' ? root.toLocaleLowerCase() : root;
    }

    function authorizeRoot(rootPath) {
      const root = selectedReviewRoot(rootPath);
      authorizedRoots.add(rootKey(root));
      return root;
    }

    function requireAuthorizedRoot(rootPath) {
      const root = selectedReviewRoot(rootPath);
      if (!authorizedRoots.has(rootKey(root))) throw new Error('Review root is not authorized');
      return root;
    }

    return {
      authorizeRoot,
      loadProductImages: (payload = {}) => loadProductImages({ ...payload, root: requireAuthorizedRoot(payload.root) }),
      loadProducts: (payload = {}) => loadProducts({ ...payload, root: requireAuthorizedRoot(payload.root) }),
      resolveImageUrl: (urlText) => resolveImageUrl(urlText, requireAuthorizedRoot),
    };
  },
};
