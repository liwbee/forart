import { sendJson } from "../http/responses.mjs";

export function handleAdminApi(req, res, url, context) {
  const method = String(req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    sendJson(res, 405, { detail: "Method not allowed" });
    return true;
  }

  const pathname = url.pathname;

  try {
    if (pathname === "/api/admin/status") {
      sendJson(res, 200, context.serverPayload());
      return true;
    }

    if (pathname === "/api/admin/storage") {
      sendJson(res, 200, context.storagePayload());
      return true;
    }

    if (pathname === "/api/admin/library-summary") {
      sendJson(res, 200, context.librarySummaryPayload());
      return true;
    }

    if (pathname === "/api/admin/environment") {
      sendJson(res, 200, context.environmentPayload());
      return true;
    }
  } catch (error) {
    sendJson(res, 500, { detail: error instanceof Error ? error.message : String(error) });
    return true;
  }

  sendJson(res, 404, { detail: "Admin API route not found" });
  return true;
}

