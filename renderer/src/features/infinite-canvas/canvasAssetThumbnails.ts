export async function saveThumbnailForExistingCanvasAsset(url: string) {
  if (!url || !window.easyTool?.saveCanvasAssetThumbnail) return {};
  return window.easyTool.saveCanvasAssetThumbnail({ url });
}
