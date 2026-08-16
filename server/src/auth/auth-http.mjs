import { fromNodeHeaders } from "better-auth/node";
import { withCorsHeaders, sendJson } from "../http/responses.mjs";

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function asWebRequest(req, url) {
  const method = String(req.method || "GET").toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await readBody(req);
  return new Request(url.toString(), {
    method, headers: fromNodeHeaders(req.headers), body: body?.length ? body : undefined,
  });
}

export async function handleAuthHttp(req, res, url, authRuntime) {
  const response = await authRuntime.auth.handler(await asWebRequest(req, url));
  const headers = {};
  response.headers.forEach((value, key) => { headers[key] = value; });
  const responseBody = Buffer.from(await response.arrayBuffer());
  res.writeHead(response.status, withCorsHeaders(headers));
  res.end(responseBody);
  return true;
}

export async function handleMeApi(req, res, authRuntime) {
  const session = await authRuntime.requireSession(req);
  if (!session) {
    sendJson(res, 401, { detail: "Authentication required", code: "AUTHENTICATION_REQUIRED" });
    return true;
  }
  sendJson(res, 200, {
    user: { id: session.user.id, username: session.user.username || session.user.displayUsername || session.user.name, name: session.user.name, role: session.user.role || "user" },
    permissions: await authRuntime.authorization.listPermissions(session.user.id),
  });
  return true;
}

export async function handleMyPermissionsApi(req, res, authRuntime) {
  const session = await authRuntime.requireSession(req);
  if (!session) {
    sendJson(res, 401, { detail: "Authentication required", code: "AUTHENTICATION_REQUIRED" });
    return true;
  }
  sendJson(res, 200, { permissions: await authRuntime.authorization.listPermissions(session.user.id), role: session.user.role || "user" });
  return true;
}
