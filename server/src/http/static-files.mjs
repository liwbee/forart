import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { sendText, withCorsHeaders } from "./responses.mjs";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

export function serveFile(req, res, filePath, options = {}) {
  const method = String(req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    sendText(res, 405, "Method not allowed");
    return true;
  }

  if (!existsSync(filePath)) {
    sendText(res, 404, "Not found");
    return true;
  }

  const stat = statSync(filePath);
  if (!stat.isFile()) {
    sendText(res, 404, "Not found");
    return true;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const cacheControl = options.cacheControl || (ext === ".html" ? "no-store" : "public, max-age=300");
  const headers = withCorsHeaders({
    "content-type": contentType,
    "content-length": String(stat.size),
    "cache-control": cacheControl,
  });

  res.writeHead(200, headers);
  res.end(method === "HEAD" ? undefined : readFileSync(filePath));
  return true;
}

export function serveStaticFromRoot(req, res, rootDir, urlPath, mountPath) {
  const rawPath = safeDecode(urlPath.slice(mountPath.length));
  const normalized = rawPath.replace(/^\/+/, "");
  if (!normalized || normalized.includes("\0")) {
    sendText(res, 404, "Not found");
    return true;
  }

  const targetPath = path.resolve(rootDir, normalized);
  if (!isInside(rootDir, targetPath)) {
    sendText(res, 403, "Forbidden");
    return true;
  }

  return serveFile(req, res, targetPath);
}

