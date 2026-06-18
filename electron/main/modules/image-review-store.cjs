const fs = require('fs');
const path = require('path');

const REVIEW_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);
const REVIEW_MIME_TYPES = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

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
      unknownImages: [],
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
    unknownImages: [],
  };

  for (const folderName of listReviewDirectories(productDir)) {
    const images = collectReviewImages(path.join(productDir, folderName), root);
    const normalized = normalizeReviewFolderName(folderName);
    if (modelFolderSet.has(normalized)) product.modelImages.push(...images);
    else if (detailFolderSet.has(normalized)) product.detailImages.push(...images);
    else product.unknownImages.push(...images);
  }

  product.modelImages.sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true, sensitivity: 'base' }));
  product.detailImages.sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true, sensitivity: 'base' }));
  product.unknownImages.sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true, sensitivity: 'base' }));
  product.hasModelImages = product.modelImages.length > 0;
  return product;
}

function issuePath(root) {
  return path.join(selectedReviewRoot(root), 'error.txt');
}

function readIssueText(root) {
  try {
    return fs.readFileSync(issuePath(root), 'utf8');
  } catch {
    return '';
  }
}

function findIssue({ root, path: imagePath }) {
  const normalizedPath = String(imagePath || '').trim();
  if (!normalizedPath) return '';
  const name = path.basename(normalizedPath);
  const line = readIssueText(root)
    .split(/\r?\n/)
    .find((item) => item.startsWith(`${normalizedPath}  `) || item.startsWith(`${name}  `));
  if (!line) return '';
  return line.startsWith(`${normalizedPath}  `) ? line.slice(normalizedPath.length).trim() : line.slice(name.length).trim();
}

function saveIssue({ root, path: imagePath, issue }) {
  const normalizedPath = String(imagePath || '').trim();
  const nextIssue = String(issue || '').trim();
  if (!normalizedPath) throw new Error('Image path is required');
  if (!nextIssue) throw new Error('Issue is required');
  reviewAbsolutePath(root, normalizedPath);
  const nextLine = `${normalizedPath}  ${nextIssue}`;
  const lines = readIssueText(root)
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.startsWith(`${normalizedPath}  `) && !line.startsWith(`${path.basename(normalizedPath)}  `));
  lines.push(nextLine);
  fs.writeFileSync(issuePath(root), `${lines.join('\n')}\n`, 'utf8');
}

function resolveImageUrl(urlText) {
  const url = new URL(urlText);
  const root = url.searchParams.get('root') || '';
  const imagePath = url.searchParams.get('path') || '';
  const filePath = reviewAbsolutePath(root, imagePath);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
  return filePath;
}

function imageMimeType(filePath) {
  return REVIEW_MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

module.exports = {
  createImageReviewStore: () => ({
    findIssue,
    imageMimeType,
    loadProductImages,
    loadProducts,
    resolveImageUrl,
    saveIssue,
  }),
};
