import { createReadStream, createWriteStream, existsSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { sendJson, sendText, withCorsHeaders } from "../http/responses.mjs";

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function receiveBodyToFile(req, filePath) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(filePath);
    req.pipe(output);
    req.on("error", reject);
    output.on("error", reject);
    output.on("finish", () => resolve(filePath));
  });
}

function sendError(res, error, statusCode = 400) {
  sendJson(res, statusCode, { detail: error instanceof Error ? error.message : String(error) });
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "application/octet-stream";
}

export function handleCanvasExchangeApi(req, res, url, context) {
  const method = String(req.method || "GET").toUpperCase();
  const pathname = url.pathname;
  const store = context.store;

  if (method === "GET" && pathname === "/api/canvas-exchange/projects") {
    sendJson(res, 200, { projects: store.listProjects() });
    return true;
  }

  if (method === "POST" && pathname === "/api/canvas-exchange/projects") {
    parseJsonBody(req)
      .then((payload) => sendJson(res, 200, store.createProject(payload)))
      .catch((error) => sendError(res, error));
    return true;
  }

  const projectMatch = pathname.match(/^\/api\/canvas-exchange\/projects\/([^/]+)$/);
  if (projectMatch) {
    const projectId = decodeURIComponent(projectMatch[1]);
    if (method === "PATCH") {
      parseJsonBody(req)
        .then((payload) => sendJson(res, 200, store.updateProject(projectId, payload)))
        .catch((error) => sendError(res, error));
      return true;
    }
    if (method === "DELETE") {
      try {
        sendJson(res, 200, store.deleteProject(projectId));
      } catch (error) {
        sendError(res, error);
      }
      return true;
    }
  }

  if (method === "GET" && pathname === "/api/canvas-exchange/canvases") {
    sendJson(res, 200, {
      canvases: store.listCanvases({
        projectId: url.searchParams.get("project_id") || "",
        search: url.searchParams.get("search") || "",
        sort: url.searchParams.get("sort") || "uploadedAt",
      }),
    });
    return true;
  }

  if (method === "POST" && pathname === "/api/canvas-exchange/canvases") {
    const projectId = url.searchParams.get("project_id") || "";
    const tempName = `upload-${Date.now()}-${Math.random().toString(36).slice(2)}.forartcanvas`;
    const tempPath = path.join(context.paths.tempRoot(), tempName);
    receiveBodyToFile(req, tempPath)
      .then(() => {
        const result = store.uploadCanvasPackage({ packagePath: tempPath, projectId });
        if (existsSync(tempPath)) unlinkSync(tempPath);
        sendJson(res, 200, result);
      })
      .catch((error) => {
        if (existsSync(tempPath)) unlinkSync(tempPath);
        sendError(res, error);
      });
    return true;
  }

  const canvasPackageMatch = pathname.match(/^\/api\/canvas-exchange\/canvases\/([^/]+)\/package$/);
  if (canvasPackageMatch && method === "GET") {
    try {
      const canvasId = decodeURIComponent(canvasPackageMatch[1]);
      const result = store.createPackageForCanvas(canvasId);
      const stat = statSync(result.filePath);
      res.writeHead(200, withCorsHeaders({
        "content-type": "application/octet-stream",
        "content-length": String(stat.size),
        "content-disposition": `attachment; filename="${encodeURIComponent(result.fileName)}"`,
      }));
      const readStream = createReadStream(result.filePath);
      readStream.on("close", () => {
        try {
          unlinkSync(result.filePath);
        } catch {}
      });
      readStream.pipe(res);
    } catch (error) {
      sendError(res, error, 404);
    }
    return true;
  }

  const canvasAssetMatch = pathname.match(/^\/api\/canvas-exchange\/canvases\/([^/]+)\/assets\/(.+)$/);
  if (canvasAssetMatch && (method === "GET" || method === "HEAD")) {
    const relativePath = decodeURIComponent(canvasAssetMatch[2] || "");
    const asset = store.readAsset(relativePath);
    if (!asset) {
      sendText(res, 404, "Asset not found");
      return true;
    }
    const stat = statSync(asset.filePath);
    res.writeHead(200, withCorsHeaders({
      "content-type": contentTypeFor(asset.filePath),
      "content-length": String(stat.size),
      "cache-control": "public, max-age=300",
    }));
    if (method === "HEAD") res.end();
    else asset.stream.pipe(res);
    return true;
  }

  const canvasMatch = pathname.match(/^\/api\/canvas-exchange\/canvases\/([^/]+)$/);
  if (canvasMatch) {
    const canvasId = decodeURIComponent(canvasMatch[1]);
    if (method === "GET") {
      const canvas = store.loadCanvas(canvasId);
      if (!canvas) sendJson(res, 404, { detail: "Canvas not found" });
      else sendJson(res, 200, canvas);
      return true;
    }
    if (method === "DELETE") {
      try {
        sendJson(res, 200, store.deleteCanvas(canvasId));
      } catch (error) {
        sendError(res, error);
      }
      return true;
    }
  }

  return false;
}
