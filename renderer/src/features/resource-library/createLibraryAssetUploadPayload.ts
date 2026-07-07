import { createImageThumbnail } from "../image-thumbnails/createImageThumbnail";

export interface LibraryAssetUploadPayload {
  filename: string;
  mime_type: string;
  data: string;
  thumbnail_data_url?: string;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

export async function createLibraryAssetUploadPayload(file: File): Promise<LibraryAssetUploadPayload> {
  const dataUrl = await readFileAsDataUrl(file);
  const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] || "" : "";
  const thumbnail = await createImageThumbnail({
    dataUrl,
    name: file.name,
    type: file.type || "image/png",
  });
  return {
    filename: file.name,
    mime_type: file.type || "image/png",
    data: base64,
    ...(thumbnail?.dataUrl ? { thumbnail_data_url: thumbnail.dataUrl } : {}),
  };
}

export async function createLibraryAssetThumbnailDataUrl(source: {
  dataUrl?: string;
  url?: string;
  name?: string;
  type?: string;
}) {
  const thumbnail = await createImageThumbnail(source);
  return thumbnail?.dataUrl || "";
}
