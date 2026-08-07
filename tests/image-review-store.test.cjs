const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createImageReviewStore } = require('../electron/main/modules/image-review-store.cjs');
const { registerImageReviewIpc } = require('../electron/main/ipc/image-review-ipc.cjs');

test('image review only reads roots explicitly authorized by the main process', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-image-review-'));
  const reviewRoot = path.join(tempRoot, 'review');
  const outsideRoot = path.join(tempRoot, 'outside');
  const productRoot = path.join(reviewRoot, 'SKU-001');
  const modelRoot = path.join(productRoot, '模特图');
  const detailRoot = path.join(productRoot, '详情图');
  fs.mkdirSync(modelRoot, { recursive: true });
  fs.mkdirSync(detailRoot, { recursive: true });
  fs.mkdirSync(outsideRoot, { recursive: true });
  fs.writeFileSync(path.join(modelRoot, 'model.jpg'), Buffer.from('model'));
  fs.writeFileSync(path.join(detailRoot, 'detail.png'), Buffer.from('detail'));
  fs.writeFileSync(path.join(outsideRoot, 'secret.jpg'), Buffer.from('secret'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const store = createImageReviewStore();
  assert.throws(() => store.loadProducts({ root: reviewRoot, modelFolders: '模特图' }), /not authorized/);
  assert.equal(store.authorizeRoot(reviewRoot), path.resolve(reviewRoot));

  const products = await store.loadProducts({ root: reviewRoot, modelFolders: '主图，模特图' });
  assert.deepEqual(products.map((product) => ({ id: product.id, hasModelImages: product.hasModelImages })), [
    { id: 'SKU-001', hasModelImages: true },
  ]);

  const product = await store.loadProductImages({
    root: reviewRoot,
    productId: 'SKU-001',
    modelFolders: '模特图',
    detailFolders: '详情图',
  });
  assert.equal(product.modelImages.length, 1);
  assert.equal(product.detailImages.length, 1);
  assert.equal(store.resolveImageUrl(product.modelImages[0].originalUrl), path.join(modelRoot, 'model.jpg'));
  assert.equal(store.resolveProductDirectory({ root: reviewRoot, productId: 'SKU-001' }), productRoot);
  assert.throws(() => store.resolveProductDirectory({ root: reviewRoot, productId: '../outside' }), /Invalid product path/);

  assert.throws(() => store.resolveImageUrl(`forart-review://image?root=${encodeURIComponent(outsideRoot)}&path=secret.jpg`), /not authorized/);
  await assert.rejects(store.loadProductImages({ root: reviewRoot, productId: '../outside', modelFolders: '', detailFolders: '' }), /Invalid review path/);

  const handlers = new Map();
  registerImageReviewIpc({
    ipcMain: { handle(channel, handler) { handlers.set(channel, handler); } },
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [reviewRoot] }) },
    imageReviewStore: createImageReviewStore(),
  });
  await assert.rejects(
    handlers.get('image-review:products')({}, { root: reviewRoot, modelFolders: 'model' }),
    /not authorized/,
  );
  const restored = await handlers.get('image-review:restore-root')({}, { root: reviewRoot });
  assert.deepEqual(restored, { ok: true, path: path.resolve(reviewRoot) });
  const restoredProducts = await handlers.get('image-review:products')({}, {
    root: restored.path,
    modelFolders: 'model',
  });
  assert.equal(restoredProducts.products.length, 1);

  const selection = await handlers.get('image-review:choose-root')({}, { title: 'Review' });
  assert.deepEqual(selection, { canceled: false, path: path.resolve(reviewRoot) });
  const ipcProducts = await handlers.get('image-review:products')({}, { root: selection.path, modelFolders: '模特图' });
  assert.equal(ipcProducts.products.length, 1);
});

test('image review opens only an authorized product folder', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-product-folder-open-'));
  const reviewRoot = path.join(tempRoot, 'review');
  const productRoot = path.join(reviewRoot, 'SKU-001');
  fs.mkdirSync(productRoot, { recursive: true });
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const imageReviewStore = createImageReviewStore();
  imageReviewStore.authorizeRoot(reviewRoot);
  const handlers = new Map();
  let openedPath = '';
  registerImageReviewIpc({
    ipcMain: { handle(channel, handler) { handlers.set(channel, handler); } },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    imageReviewStore,
    shell: {
      async openPath(folderPath) {
        openedPath = folderPath;
        return '';
      },
    },
  });

  const result = await handlers.get('image-review:open-product-folder')({}, {
    root: reviewRoot,
    productId: 'SKU-001',
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(openedPath, productRoot);

  const invalid = await handlers.get('image-review:open-product-folder')({}, {
    root: reviewRoot,
    productId: '../outside',
  });
  assert.deepEqual(invalid, { ok: false, reason: 'product-folder-not-found' });
});

test('image review opens an authorized original image with registry Photoshop', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-photoshop-open-'));
  const reviewRoot = path.join(tempRoot, 'review folder');
  const imagePath = path.join(reviewRoot, 'image with spaces.jpg');
  const photoshopPath = path.join(tempRoot, 'Adobe Photoshop 2025', 'Photoshop.exe');
  fs.mkdirSync(path.dirname(photoshopPath), { recursive: true });
  fs.mkdirSync(reviewRoot, { recursive: true });
  fs.writeFileSync(imagePath, Buffer.from('image'));
  fs.writeFileSync(photoshopPath, Buffer.from('exe'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const imageReviewStore = createImageReviewStore();
  imageReviewStore.authorizeRoot(reviewRoot);
  const imageUrl = `forart-review://image?root=${encodeURIComponent(reviewRoot)}&path=${encodeURIComponent(path.basename(imagePath))}`;
  const handlers = new Map();
  let launch = null;
  registerImageReviewIpc({
    ipcMain: { handle(channel, handler) { handlers.set(channel, handler); } },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    imageReviewStore,
    processTools: {
      platform: 'win32',
      existsSync: fs.existsSync,
      execFile(_command, _args, _options, callback) {
        callback(null, `    (Default)    REG_SZ    ${photoshopPath}\r\n`, '');
      },
      spawn(executablePath, args, options) {
        launch = { executablePath, args, options };
        const child = new EventEmitter();
        child.unref = () => {};
        queueMicrotask(() => child.emit('spawn'));
        return child;
      },
    },
  });

  const result = await handlers.get('image-review:open-in-photoshop')({}, { originalUrl: imageUrl });
  assert.deepEqual(result, { ok: true });
  assert.equal(launch.executablePath, photoshopPath);
  assert.deepEqual(launch.args, [imagePath]);
  assert.equal(launch.options.detached, true);

  const unauthorized = await handlers.get('image-review:open-in-photoshop')({}, {
    originalUrl: `forart-review://image?root=${encodeURIComponent(tempRoot)}&path=${encodeURIComponent(path.basename(imagePath))}`,
  });
  assert.deepEqual(unauthorized, { ok: false, reason: 'image-not-found' });
});
