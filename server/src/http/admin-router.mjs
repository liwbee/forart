import path from "node:path";
import { handleAdminApi } from "../admin/admin-api.mjs";
import { serveFile, serveStaticFromRoot } from "./static-files.mjs";

export function createAdminRouter({ adminRoot, context }) {
  const indexPath = path.join(adminRoot, "index.html");

  return function handleAdminRoute(req, res, url) {
    const pathname = url.pathname;

    if (pathname === "/") {
      return serveFile(req, res, indexPath);
    }

    if (pathname.startsWith("/_admin/")) {
      return serveStaticFromRoot(req, res, adminRoot, pathname, "/_admin/");
    }

    if (pathname.startsWith("/api/admin/")) {
      return handleAdminApi(req, res, url, context);
    }

    return false;
  };
}

