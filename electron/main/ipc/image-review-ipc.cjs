function registerImageReviewIpc({ ipcMain, dialog, imageReviewStore }) {
  ipcMain.handle('image-review:choose-root', async (_event, payload = {}) => {
    const result = await dialog.showOpenDialog({
      title: String(payload?.title || 'Choose image review folder'),
      properties: ['openDirectory'],
    });
    const selectedPath = result.filePaths[0] || '';
    if (result.canceled || !selectedPath) return { canceled: true, path: '' };
    return { canceled: false, path: imageReviewStore.authorizeRoot(selectedPath) };
  });

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
}

module.exports = { registerImageReviewIpc };
