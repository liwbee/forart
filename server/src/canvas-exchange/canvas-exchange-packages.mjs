import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { safePathPart, safeRelativePath } from "./canvas-exchange-paths.mjs";
import { PACKAGE_FORMAT, PACKAGE_URL_PREFIX, PACKAGE_VERSION, nowMs } from "./canvas-exchange-types.mjs";

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function cloneSerializable(value) {
  return JSON.parse(JSON.stringify(value));
}

function walk(value, visitor, key = "") {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const next = visitor(value[index], String(index));
      value[index] = next;
      if (isRecord(next) || Array.isArray(next)) walk(next, visitor, String(index));
    }
    return value;
  }
  if (!isRecord(value)) return value;
  for (const currentKey of Object.keys(value)) {
    const next = visitor(value[currentKey], currentKey);
    if (next === undefined) {
      delete value[currentKey];
      continue;
    }
    value[currentKey] = next;
    if (isRecord(next) || Array.isArray(next)) walk(next, visitor, currentKey);
  }
  return value;
}

function packageAssetIdFromUrl(value) {
  const text = String(value || "");
  if (!text.startsWith(PACKAGE_URL_PREFIX)) return "";
  return decodeURIComponent(text.slice(PACKAGE_URL_PREFIX.length));
}

function packageAssetUrl(assetId) {
  return PACKAGE_URL_PREFIX + encodeURIComponent(assetId);
}

function extensionFromPath(value) {
  return path.extname(String(value || "")).toLowerCase() || ".png";
}

function uniqueFilePath(directory, fileName) {
  const parsed = path.parse(fileName || "canvas-image.png");
  const safeBase = safePathPart(parsed.name, "canvas-image");
  const ext = parsed.ext || ".png";
  let candidate = path.join(directory, `${safeBase}${ext}`);
  let index = 2;
  while (existsSync(candidate)) {
    candidate = path.join(directory, `${safeBase}-${index}${ext}`);
    index += 1;
  }
  return candidate;
}

function serverAssetUrl(canvasId, relativePath) {
  return `/api/canvas-exchange/canvases/${encodeURIComponent(canvasId)}/assets/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

export function createCanvasExchangePackages(paths) {
  function readPackage(packagePath) {
    const zip = new AdmZip(packagePath);
    const manifestEntry = zip.getEntry("manifest.json");
    const canvasEntry = zip.getEntry("canvas.json");
    if (!manifestEntry || !canvasEntry) throw new Error("Invalid Forart canvas package.");
    const manifest = JSON.parse(manifestEntry.getData().toString("utf8"));
    if (manifest?.format !== PACKAGE_FORMAT) throw new Error("Unsupported canvas package format.");
    const canvas = JSON.parse(canvasEntry.getData().toString("utf8"));
    return { zip, manifest, canvas };
  }

  function unpackPackageToServer({ packagePath, canvasId }) {
    const { zip, manifest, canvas } = readPackage(packagePath);
    const urlByAssetId = new Map();
    const storedAssets = [];

    for (const asset of Array.isArray(manifest.assets) ? manifest.assets : []) {
      const packagePathValue = safeRelativePath(asset.packagePath);
      const entry = packagePathValue ? zip.getEntry(packagePathValue) : null;
      if (!entry) continue;
      const kind = asset.kind === "output" ? "output" : "input";
      const directory = paths.assetRootForKind(kind);
      const sourceName = path.basename(asset.fileName || packagePathValue);
      const target = uniqueFilePath(directory, sourceName);
      writeFileSync(target, entry.getData());
      const relativePath = paths.assetRelativePath(target);
      const nextUrl = serverAssetUrl(canvasId, relativePath);
      if (asset.id) urlByAssetId.set(String(asset.id), nextUrl);
      storedAssets.push({
        id: String(asset.id || ""),
        kind,
        fileName: path.basename(target),
        relativePath,
        originalUrl: String(asset.originalUrl || ""),
        packagePath: packagePathValue,
        sizeBytes: statSync(target).size,
      });
    }

    const rewrittenCanvas = walk(cloneSerializable(canvas), (value, key) => {
      if (/path$/i.test(key) || /filePath/i.test(key) || /localPath/i.test(key)) return undefined;
      if (typeof value !== "string") return value;
      const packageId = packageAssetIdFromUrl(value);
      if (packageId && urlByAssetId.has(packageId)) return urlByAssetId.get(packageId);
      return value;
    });

    return {
      canvas: rewrittenCanvas,
      packageManifest: manifest,
      assets: storedAssets,
      warnings: Array.isArray(manifest.warnings) ? manifest.warnings : [],
    };
  }

  function createPackageFromServer({ canvasId, canvas, manifest, outputPath }) {
    const zip = new AdmZip();
    const assetByServerUrl = new Map();
    const packageAssets = [];

    for (const [index, asset] of (Array.isArray(manifest.assets) ? manifest.assets : []).entries()) {
      const absolutePath = paths.assetAbsolutePath(asset.relativePath);
      if (!absolutePath || !existsSync(absolutePath)) continue;
      const assetId = asset.id || `asset_${String(index + 1).padStart(3, "0")}`;
      const ext = extensionFromPath(asset.fileName || asset.relativePath);
      const fileName = `image_${String(index + 1).padStart(3, "0")}${ext}`;
      const packagePath = `assets/${asset.kind === "output" ? "output" : "input"}/${fileName}`;
      const serverUrl = serverAssetUrl(canvasId, asset.relativePath);
      assetByServerUrl.set(serverUrl, packageAssetUrl(assetId));
      packageAssets.push({
        id: assetId,
        kind: asset.kind === "output" ? "output" : "input",
        originalUrl: asset.originalUrl || serverUrl,
        originalRelativePath: asset.relativePath,
        packagePath,
        fileName,
        sizeBytes: statSync(absolutePath).size,
      });
      zip.addFile(packagePath, readFileSync(absolutePath));
    }

    const packageCanvas = walk(cloneSerializable(canvas), (value, key) => {
      if (/path$/i.test(key) || /filePath/i.test(key) || /localPath/i.test(key)) return undefined;
      if (typeof value !== "string") return value;
      return assetByServerUrl.get(value) || value;
    });

    const packageManifest = {
      format: PACKAGE_FORMAT,
      version: PACKAGE_VERSION,
      exportedAt: nowMs(),
      appVersion: "",
      mode: "with-resources",
      canvas: {
        id: canvas.id,
        title: canvas.title,
        nodeCount: Array.isArray(canvas.nodes) ? canvas.nodes.length : 0,
      },
      assets: packageAssets,
      warnings: Array.isArray(manifest.warnings) ? manifest.warnings : [],
    };

    zip.addFile("manifest.json", Buffer.from(JSON.stringify(packageManifest, null, 2) + "\n", "utf8"));
    zip.addFile("canvas.json", Buffer.from(JSON.stringify(packageCanvas, null, 2) + "\n", "utf8"));
    zip.writeZip(outputPath);
    return outputPath;
  }

  return {
    createPackageFromServer,
    unpackPackageToServer,
  };
}

