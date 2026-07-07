import { createImageThumbnail } from "../image-thumbnails/createImageThumbnail";

export async function saveThumbnailForExistingCanvasAsset(url: string, fileName?: string) {
  if (!url || !window.easyTool?.saveCanvasAssetThumbnail) return {};
  const thumbnail = await createImageThumbnail({ url, name: fileName });
  if (!thumbnail?.dataUrl) return {};
  return window.easyTool.saveCanvasAssetThumbnail({ url, thumbDataUrl: thumbnail.dataUrl });
}
