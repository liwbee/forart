import { getApiBaseUrl } from "../data-source/runtime";

export function resolveLibraryImageUrl(url: string) {
  const source = String(url || "").trim();
  if (!source) return "";
  if (/^data:/i.test(source)) return source;
  if (/^forart-asset:/i.test(source)) return source;
  if (/^https?:\/\//i.test(source)) return source;
  const apiBaseUrl = getApiBaseUrl();
  const baseUrl = apiBaseUrl || (typeof window !== "undefined" ? window.location.origin : "");
  return baseUrl ? new URL(source, baseUrl).toString() : source;
}

export function cacheBustedLibraryImageUrl(url: string, stamp?: string) {
  const resolved = resolveLibraryImageUrl(url);
  return resolved && stamp ? `${resolved}${resolved.includes("?") ? "&" : "?"}t=${encodeURIComponent(stamp)}` : resolved;
}

function toDownloadUrl(url: string) {
  const resolved = resolveLibraryImageUrl(url);
  return resolved.replace(/\/api\/assets\/([^/?#]+)\/file(?=([?#]|$))/, "/api/assets/$1/download");
}

function extensionFromMime(mimeType: string) {
  const subtype = mimeType.split("/")[1] || "";
  if (!subtype) return "";
  return `.${subtype.replace("jpeg", "jpg").replace(/[^a-z0-9.+-]/gi, "")}`;
}

function fileNameWithExtension(fileName: string, extension: string) {
  const cleanName = fileName.trim() || "library-image";
  if (!extension || /\.[a-z0-9]+$/i.test(cleanName)) return cleanName;
  return `${cleanName}${extension}`;
}

async function fetchImageBlob(url: string) {
  const response = await fetch(resolveLibraryImageUrl(url));
  if (!response.ok) throw new Error(`Failed to read image: ${response.status}`);
  return response.blob();
}

async function convertBlobToPng(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is not available");
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((pngBlob) => {
        if (pngBlob) resolve(pngBlob);
        else reject(new Error("Failed to prepare image for clipboard"));
      }, "image/png");
    });
  } finally {
    bitmap.close();
  }
}

export async function copyLibraryImage(url: string) {
  const blob = await fetchImageBlob(url);
  const clipboardBlob = blob.type === "image/png" ? blob : await convertBlobToPng(blob);
  await navigator.clipboard.write([new ClipboardItem({ "image/png": clipboardBlob })]);
}

export async function downloadLibraryOriginalImage(url: string, defaultName: string) {
  const downloadUrl = toDownloadUrl(url);
  const blob = await fetchImageBlob(downloadUrl);
  const fileName = fileNameWithExtension(defaultName, extensionFromMime(blob.type) || ".png");

  if (window.easyTool?.saveResult) {
    await window.easyTool.saveResult({ url: downloadUrl, defaultName: fileName });
    return;
  }

  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
