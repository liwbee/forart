const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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

  const products = store.loadProducts({ root: reviewRoot, modelFolders: '主图，模特图' });
  assert.deepEqual(products.map((product) => ({ id: product.id, hasModelImages: product.hasModelImages })), [
    { id: 'SKU-001', hasModelImages: true },
  ]);

  const product = store.loadProductImages({
    root: reviewRoot,
    productId: 'SKU-001',
    modelFolders: '模特图',
    detailFolders: '详情图',
  });
  assert.equal(product.modelImages.length, 1);
  assert.equal(product.detailImages.length, 1);
  assert.equal(store.resolveImageUrl(product.modelImages[0].url), path.join(modelRoot, 'model.jpg'));

  assert.throws(() => store.resolveImageUrl(`forart-review://image?root=${encodeURIComponent(outsideRoot)}&path=secret.jpg`), /not authorized/);
  assert.throws(() => store.loadProductImages({ root: reviewRoot, productId: '../outside', modelFolders: '', detailFolders: '' }), /Invalid review path/);

  const handlers = new Map();
  registerImageReviewIpc({
    ipcMain: { handle(channel, handler) { handlers.set(channel, handler); } },
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [reviewRoot] }) },
    imageReviewStore: createImageReviewStore(),
  });
  const selection = await handlers.get('image-review:choose-root')({}, { title: 'Review' });
  assert.deepEqual(selection, { canceled: false, path: path.resolve(reviewRoot) });
  const ipcProducts = await handlers.get('image-review:products')({}, { root: selection.path, modelFolders: '模特图' });
  assert.equal(ipcProducts.products.length, 1);
});
