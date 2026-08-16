import { sendJson } from "../http/responses.mjs";
import { PERMISSION_CATALOG } from "../auth/permission-catalog.mjs";
import { fromNodeHeaders } from "better-auth/node";

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

function sendAuthFailure(res, status) {
  sendJson(res, status, {
    detail: status === 401 ? "Authentication required" : "Administrator permission required",
    code: status === 401 ? "AUTHENTICATION_REQUIRED" : "ADMIN_PERMISSION_REQUIRED",
  });
}

export async function handleAdminApi(req, res, url, context) {
  const method = String(req.method || "GET").toUpperCase();
  const pathname = url.pathname;
  const auth = context.authRuntime();

  try {
    if (pathname === "/api/admin/bootstrap-status" && method === "GET") {
      sendJson(res, 200, await auth.bootstrapStatus());
      return true;
    }

    if (pathname === "/api/admin/bootstrap" && method === "POST") {
      const body = await parseJsonBody(req);
      const user = await auth.createBootstrapAdmin({
        username: process.env.FORART_ADMIN_USERNAME || "admin",
        password: body.password,
      });
      sendJson(res, 201, { user: { id: user.id, username: user.username, role: user.role } });
      return true;
    }

    if (pathname === "/api/admin/sign-in/password" && method === "POST") {
      const body = await parseJsonBody(req);
      const response = await auth.signInAdminWithPassword(body.password, fromNodeHeaders(req.headers));
      if (!response) {
        sendJson(res, 401, { detail: "管理员尚未初始化", code: "ADMIN_NOT_INITIALIZED" });
        return true;
      }
      const payload = await response.json().catch(() => ({}));
      const token = response.headers.get("set-auth-token");
      sendJson(res, response.status, payload, token ? { "set-auth-token": token } : {});
      return true;
    }

    const access = process.env.FORART_AUTH_DISABLED === "1" && process.env.NODE_ENV === "test"
      ? { status: 200, session: { user: { id: "test-admin", role: "admin" } } }
      : await auth.requireAdmin(req);
    if (access.status !== 200) {
      sendAuthFailure(res, access.status);
      return true;
    }
    const actor = access.session.user;
    const authHeaders = fromNodeHeaders(req.headers);

    if (pathname === "/api/admin/status" && (method === "GET" || method === "HEAD")) {
      sendJson(res, 200, context.serverPayload());
      return true;
    }
    if (pathname === "/api/admin/storage" && (method === "GET" || method === "HEAD")) {
      sendJson(res, 200, await context.storagePayload());
      return true;
    }
    if (pathname === "/api/admin/library-summary" && (method === "GET" || method === "HEAD")) {
      sendJson(res, 200, await context.librarySummaryPayload());
      return true;
    }
    if (pathname === "/api/admin/environment" && (method === "GET" || method === "HEAD")) {
      sendJson(res, 200, context.environmentPayload());
      return true;
    }
    if (pathname === "/api/admin/permission-catalog" && method === "GET") {
      sendJson(res, 200, { permissions: PERMISSION_CATALOG });
      return true;
    }
    if (pathname === "/api/admin/users" && method === "GET") {
      const users = await auth.listUsers();
      sendJson(res, 200, { users: await Promise.all(users.map(async (user) => ({
        ...user,
        effectivePermissions: await auth.authorization.listPermissions(user.id),
      }))) });
      return true;
    }
    if (pathname === "/api/admin/users" && method === "POST") {
      const body = await parseJsonBody(req);
      const user = await auth.createUser({ username: body.username, password: body.password, role: "user" });
      const assignment = await auth.roles.setUserRole(user.id, body.roleId, authHeaders);
      sendJson(res, 201, {
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          roleId: assignment.roleId,
          effectivePermissions: await auth.authorization.listPermissions(user.id),
          lastLoginAt: null,
        },
      });
      return true;
    }

    if (pathname === "/api/admin/roles" && method === "GET") {
      sendJson(res, 200, { roles: await auth.roles.listRoles() });
      return true;
    }
    if (pathname === "/api/admin/roles" && method === "POST") {
      const body = await parseJsonBody(req);
      sendJson(res, 201, { role: await auth.roles.createRole(body, authHeaders) });
      return true;
    }

    const roleMembersMatch = pathname.match(/^\/api\/admin\/roles\/([^/]+)\/members$/);
    if (roleMembersMatch && method === "PUT") {
      const roleId = decodeURIComponent(roleMembersMatch[1]);
      const body = await parseJsonBody(req);
      sendJson(res, 200, { memberIds: await auth.roles.replaceRoleMembers(roleId, body.memberIds, authHeaders) });
      return true;
    }

    const roleMatch = pathname.match(/^\/api\/admin\/roles\/([^/]+)$/);
    if (roleMatch && method === "PATCH") {
      const roleId = decodeURIComponent(roleMatch[1]);
      const body = await parseJsonBody(req);
      sendJson(res, 200, { role: await auth.roles.updateRole(roleId, body, authHeaders) });
      return true;
    }
    if (roleMatch && method === "DELETE") {
      await auth.roles.deleteRole(decodeURIComponent(roleMatch[1]), authHeaders);
      sendJson(res, 200, { ok: true });
      return true;
    }

    const userRoleMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/role$/);
    if (userRoleMatch) {
      const userId = decodeURIComponent(userRoleMatch[1]);
      if (method === "GET") {
        sendJson(res, 200, { role: await auth.roles.roleForUser(userId) });
        return true;
      }
      if (method === "PUT") {
        const body = await parseJsonBody(req);
        sendJson(res, 200, { role: await auth.roles.setUserRole(userId, body.roleId, authHeaders) });
        return true;
      }
    }

    const resetPasswordMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/reset-password$/);
    if (resetPasswordMatch && method === "POST") {
      const userId = decodeURIComponent(resetPasswordMatch[1]);
      const body = await parseJsonBody(req);
      await auth.resetPassword(userId, body.password);
      await auth.revokeSessions(userId);
      sendJson(res, 200, { ok: true });
      return true;
    }

    const revokeSessionsMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/revoke-sessions$/);
    if (revokeSessionsMatch && method === "POST") {
      const userId = decodeURIComponent(revokeSessionsMatch[1]);
      await auth.revokeSessions(userId);
      sendJson(res, 200, { ok: true });
      return true;
    }

    const userMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (userMatch && method === "DELETE") {
      const userId = decodeURIComponent(userMatch[1]);
      await auth.deleteUser(userId, actor.id);
      sendJson(res, 200, { ok: true });
      return true;
    }
  } catch (error) {
    sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error), code: "ADMIN_OPERATION_FAILED" });
    return true;
  }

  sendJson(res, 404, { detail: "Admin API route not found" });
  return true;
}
