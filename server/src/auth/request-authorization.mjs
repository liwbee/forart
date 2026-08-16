import { sendJson } from "../http/responses.mjs";

function libraryModule(pathname) {
  if (/^\/api\/(model-projects|models|model-images)|^\/api\/libraries\/model\//.test(pathname)) return "model_library";
  if (/^\/api\/(outfit-projects|outfits)|^\/api\/libraries\/outfit\//.test(pathname)) return "outfit_library";
  if (/^\/api\/(action-projects|actions)|^\/api\/libraries\/action\//.test(pathname)) return "action_library";
  return "";
}

export function requiredLibraryPermissions(module, pathname, method) {
  if (method === "GET" || method === "HEAD") return [`${module}.view`];
  if (/\/tags(?:\/|$)/.test(pathname)) return [`${module}.tag_manage`];
  // The handler parses `operation` and applies the matching permission. The
  // request-level gate must only establish an authenticated session here;
  // requiring both permissions would reject edit-only and delete-only users.
  if (/\/entries\/bulk$/.test(pathname)) return [];
  if (/^\/api\/(?:model|outfit|action)-projects\/[^/]+\/cover\/upload$/.test(pathname)) return [`${module}.project_edit`];
  if (/^\/api\/(?:models\/[^/]+\/images(?:\/upload)?|outfits\/[^/]+\/image\/upload|actions\/[^/]+\/image\/upload)$/.test(pathname) && method === "POST") return [`${module}.entry_edit`];
  if (/^\/api\/(?:model|outfit|action)-projects$/.test(pathname) && method === "POST") return [`${module}.project_edit`];
  if (/^\/api\/(?:model|outfit|action)-projects\/[^/]+$/.test(pathname)) {
    if (method === "DELETE") return [`${module}.project_delete`];
    // The request-level check only authenticates a project write. The route
    // handler checks the submitted fields and enforces edit vs. reorder.
    if (method === "PATCH") return [`${module}.project_edit`, `${module}.project_reorder`];
  }
  if (method === "DELETE") return [`${module}.entry_delete`];
  if (method === "PATCH") return [`${module}.entry_edit`];
  return [`${module}.entry_edit`];
}

export function requiredCanvasPermissions(pathname, method) {
  if (method === "GET" && (/\/transfer$/.test(pathname) || /\/package$/.test(pathname))) return ["shared_canvas.copy_to_local"];
  if ((method === "GET" || method === "HEAD") && /\/assets\//.test(pathname)) return ["shared_canvas.view"];
  if (method === "GET" || method === "HEAD") return ["shared_canvas.view"];
  if (pathname === "/api/canvas-exchange/projects" && method === "POST") return ["shared_canvas.project_edit"];
  if (/\/projects\/[^/]+$/.test(pathname)) {
    if (method === "DELETE") return ["shared_canvas.project_delete"];
    // Project PATCH payloads are checked again by canvas-exchange-api so a
    // rename-only or reorder-only member can pass this coarse check.
    return ["shared_canvas.project_edit", "shared_canvas.project_reorder"];
  }
  if (/\/canvases\/[^/]+$/.test(pathname)) {
    if (method === "DELETE") return ["shared_canvas.canvas_delete"];
    if (method === "PATCH") return ["shared_canvas.canvas_edit"];
  }
  return ["shared_canvas.canvas_edit"];
}

export async function authorizeApiRequest(req, res, pathname, authRuntime) {
  const method = String(req.method || "GET").toUpperCase();
  const session = await authRuntime.requireSession(req);
  if (!session) {
    sendJson(res, 401, { detail: "Authentication required", code: "AUTHENTICATION_REQUIRED" });
    return false;
  }

  let required = [];
  if (pathname.startsWith("/api/canvas-exchange/")) required = requiredCanvasPermissions(pathname, method);
  else {
    const module = libraryModule(pathname);
    if (module) required = requiredLibraryPermissions(module, pathname, method);
    else if (/^\/api\/assets\//.test(pathname)) {
      const assetId = decodeURIComponent(pathname.split("/")[3] || "");
      const modules = await authRuntime.authorization.assetModules(assetId);
      required = (modules.length ? modules : ["model_library", "outfit_library", "action_library"]).map((module) => `${module}.view`);
    }
  }

  if (!required.length || await authRuntime.authorization.hasAnyPermission(session.user, required)) return true;
  sendJson(res, 403, { detail: "Permission denied", code: "PERMISSION_DENIED", required });
  return false;
}
