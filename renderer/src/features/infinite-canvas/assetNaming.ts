/**
 * 画布资产命名的唯一入口。
 *
 * 约定：
 * 1. 生成结果在落库时由主进程 generation-naming.cjs 命名为「平台-模型-时间戳[-n]」；
 * 2. 派生资产（裁剪、抠图、截帧等）一律「前缀-原资产名」，前缀在这里登记；
 * 3. 下载时直接使用资产在库中的名字（storedImageDownloadTarget），不再重新命名；
 *    重名由保存层（asset-store.uniqueFilePath）自动加后缀。
 *
 * 新增一个派生节点时，只需要在 DERIVED_ASSET_PREFIXES 里加一行前缀，
 * 然后在创建派生节点处传入对应的 kind，不需要再写一遍命名规则。
 */
export const DERIVED_ASSET_PREFIXES = {
  crop: "Crop",
  matting: "Matting",
  frame: "Frame",
} as const;

export type DerivedAssetKind = keyof typeof DERIVED_ASSET_PREFIXES;

const FALLBACK_ASSET_BASE = "image";
export const FALLBACK_DOWNLOAD_NAME = "generated-image.png";

export interface CanvasStoredImageRef {
  url?: string;
  localUrl?: string;
  fileName?: string;
}

/** 统一下载取名：地址取资产地址，名字取资产在库中的名字，缺失时才用兜底名。
 * 所有下载入口共用这一处，任何节点都不应该再自己拼下载文件名。 */
export function storedImageDownloadTarget(
  image: CanvasStoredImageRef | null | undefined,
): { imageUrl: string; fileName: string } | null {
  const imageUrl = String(image?.localUrl || image?.url || "").trim();
  if (!imageUrl) return null;
  return {
    imageUrl,
    fileName: String(image?.fileName || "").trim() || FALLBACK_DOWNLOAD_NAME,
  };
}

function splitAssetName(value: unknown) {
  const name = String(value ?? "").trim();
  const index = name.lastIndexOf(".");
  if (index <= 0 || index === name.length - 1) return { base: name, extension: "" };
  return { base: name.slice(0, index), extension: name.slice(index).toLowerCase() };
}

function stripKnownPrefix(base: string) {
  const trimmed = base.trim();
  const matched = Object.values(DERIVED_ASSET_PREFIXES)
    .find((prefix) => trimmed.toLowerCase().startsWith(`${prefix.toLowerCase()}-`));
  return matched ? trimmed.slice(matched.length + 1) : trimmed;
}

/** 派生资产命名：`前缀-原资产名.扩展名`，例如 `Crop-模特图.png`。
 * 对派生结果再次派生时不会叠加前缀（`Crop-a.png` 裁剪后仍是 `Crop-a.png`）。 */
export function derivedAssetName(kind: DerivedAssetKind, sourceName: unknown, extension = ".png") {
  const { base } = splitAssetName(sourceName);
  const cleanBase = stripKnownPrefix(base) || FALLBACK_ASSET_BASE;
  return `${DERIVED_ASSET_PREFIXES[kind]}-${cleanBase}${extension}`;
}
