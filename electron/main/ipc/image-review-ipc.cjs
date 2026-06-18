function registerImageReviewIpc({ ipcMain, imageReviewStore }) {
  ipcMain.handle('image-review:products', async (_event, payload = {}) => ({
    products: imageReviewStore.loadProducts({
      root: payload.root,
      modelFolders: payload.modelFolders,
    }),
  }));

  ipcMain.handle('image-review:product-images', async (_event, payload = {}) => ({
    product: imageReviewStore.loadProductImages({
      root: payload.root,
      productId: String(payload.productId || ''),
      modelFolders: payload.modelFolders,
      detailFolders: payload.detailFolders,
    }),
  }));

  ipcMain.handle('image-review:load-issue', async (_event, payload = {}) => ({
    issue: imageReviewStore.findIssue({
      root: payload.root,
      path: payload.path,
    }),
  }));

  ipcMain.handle('image-review:save-issue', async (_event, payload = {}) => {
    imageReviewStore.saveIssue({
      root: payload.root,
      path: payload.path,
      issue: payload.issue,
    });
    return { ok: true };
  });
}

module.exports = { registerImageReviewIpc };
