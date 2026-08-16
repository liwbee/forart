import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { betterAuth } from "better-auth";
import { fromNodeHeaders } from "better-auth/node";
import { username } from "better-auth/plugins/username";
import { admin } from "better-auth/plugins/admin";
import { bearer } from "better-auth/plugins/bearer";
import { organization } from "better-auth/plugins/organization";
import { ensureAuthProfileSchema } from "../db/auth-schema.mjs";
import { createAuthorizationService } from "./authorization-service.mjs";
import { forartOrganizationAccessControl, forartOrganizationOwnerRole } from "./organization-access.mjs";
import { createOrganizationRoleService } from "./organization-role-service.mjs";

function usernameEmail(usernameValue) {
  return `${String(usernameValue).trim().toLowerCase()}@forart.local`;
}

function isAdmin(user) {
  return user?.role === "admin" || (Array.isArray(user?.role) && user.role.includes("admin"));
}

function requestTrustedOrigins(request) {
  if (!request?.url) return [];
  try {
    const requestUrl = new URL(request.url);
    const origins = new Set([requestUrl.origin]);
    const forwardedHost = String(request.headers?.get("x-forwarded-host") || requestUrl.host)
      .split(",")[0].trim();
    const forwardedProtocol = String(request.headers?.get("x-forwarded-proto") || requestUrl.protocol)
      .split(",")[0].trim().replace(/:$/, "").toLowerCase();
    if (forwardedHost && (forwardedProtocol === "http" || forwardedProtocol === "https")) {
      origins.add(new URL(`${forwardedProtocol}://${forwardedHost}`).origin);
    }
    return [...origins];
  } catch {
    return [];
  }
}

function resolveAuthSecret(runtimeDataDir) {
  const configured = process.env.BETTER_AUTH_SECRET || process.env.FORART_AUTH_SECRET;
  if (configured) return configured;
  if (!runtimeDataDir) return "forart-local-development-secret-change-me-2026";
  const secretPath = path.join(runtimeDataDir, ".forart-auth-secret");
  if (existsSync(secretPath)) {
    const saved = readFileSync(secretPath, "utf8").trim();
    if (saved.length >= 32) return saved;
  }
  const generated = randomBytes(48).toString("base64url");
  writeFileSync(secretPath, `${generated}\n`, { encoding: "utf8", mode: 0o600 });
  return generated;
}

export async function createAuthRuntime({ db, driver, serverPort, runtimeDataDir = "" }) {
  const secret = resolveAuthSecret(runtimeDataDir);
  async function recordSuccessfulLogin(userId) {
    const lastLoginAt = new Date().toISOString();
    await db.insertInto("auth_user_profiles")
      .values({ user_id: userId, last_login_at: lastLoginAt })
      .onConflict((conflict) => conflict.column("user_id").doUpdateSet({ last_login_at: lastLoginAt }))
      .execute();
  }

  const auth = betterAuth({
    appName: "Forart",
    baseURL: process.env.BETTER_AUTH_URL || `http://127.0.0.1:${serverPort}`,
    basePath: "/api/auth",
    trustedOrigins: requestTrustedOrigins,
    secret,
    database: { db, type: driver === "sqlite" ? "sqlite" : "postgres", transaction: true },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: false,
      minPasswordLength: 8,
    },
    databaseHooks: {
      session: {
        create: {
          async after(session) {
            await recordSuccessfulLogin(session.userId).catch((error) => {
              console.warn(`[auth] Failed to record successful login: ${error instanceof Error ? error.message : String(error)}`);
            });
          },
        },
      },
    },
    plugins: [
      username({ minUsernameLength: 2, maxUsernameLength: 64 }),
      admin({ defaultRole: "user", adminRoles: ["admin"] }),
      organization({
        ac: forartOrganizationAccessControl,
        roles: { owner: forartOrganizationOwnerRole },
        creatorRole: "owner",
        allowUserToCreateOrganization: false,
        organizationLimit: 1,
        membershipLimit: 10_000,
        dynamicAccessControl: { enabled: true },
        schema: {
          organizationRole: {
            additionalFields: {
              displayName: { type: "string", required: true },
            },
          },
        },
      }),
      bearer(),
    ],
  });
  const context = await auth.$context;
  await context.runMigrations();
  await ensureAuthProfileSchema(db, driver);
  await db.updateTable("user").set({
    banned: driver === "sqlite" ? 0 : false,
    banReason: null,
    banExpires: null,
  }).execute();
  const roles = createOrganizationRoleService({ auth, context });
  const existingUsers = await context.internalAdapter.listUsers(10_000, 0, { field: "createdAt", direction: "asc" });
  await roles.ensureExistingUsers(existingUsers);
  const authorization = createAuthorizationService({ db, roles });

  async function sessionForRequest(req) {
    return auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  }

  async function requireSession(req) {
    return sessionForRequest(req);
  }

  async function requireAdmin(req) {
    const session = await requireSession(req);
    if (!session) return { session: null, status: 401 };
    if (!isAdmin(session.user)) return { session, status: 403 };
    return { session, status: 200 };
  }

  async function createUser({ username: usernameValue, password, role = "user" }) {
    const normalized = String(usernameValue || "").trim().toLowerCase();
    if (!/^[a-zA-Z0-9_.]+$/.test(normalized) || normalized.length < 2 || normalized.length > 64) {
      throw new Error("账号只能使用字母、数字、下划线和点，长度为 2-64 位");
    }
    if (String(password || "").length < 8) throw new Error("密码至少需要 8 位");
    if (await context.internalAdapter.findUserByEmail(usernameEmail(normalized))) throw new Error("账号已存在");
    const user = await context.internalAdapter.createUser({
      id: randomUUID(), email: usernameEmail(normalized), name: normalized,
      username: normalized, displayUsername: normalized, emailVerified: true,
      role: role === "admin" ? "admin" : "user", banned: false,
    });
    const hashedPassword = await context.password.hash(password);
    await context.internalAdapter.createAccount({
      userId: user.id, providerId: "credential", accountId: user.id, password: hashedPassword,
    });
    if (role === "admin") await roles.ensureSystemOrganization(user.id);
    else await roles.addUserToGuest(user.id);
    return user;
  }

  async function createBootstrapAdmin(payload) {
    if (await context.internalAdapter.countTotalUsers()) throw new Error("管理员已经初始化");
    return createUser({ ...payload, role: "admin" });
  }

  async function signInAdminWithPassword(password, headers = new Headers()) {
    const users = await context.internalAdapter.listUsers(10_000, 0, { field: "createdAt", direction: "asc" });
    const administrators = users.filter(isAdmin);
    const configuredUsername = String(process.env.FORART_ADMIN_USERNAME || "admin").trim().toLowerCase();
    const administrator = administrators.find((user) => (
      String(user.username || user.displayUsername || user.name || "").trim().toLowerCase() === configuredUsername
    )) || administrators[0];
    if (!administrator) return null;
    return auth.api.signInUsername({
      body: {
        username: administrator.username || administrator.displayUsername || administrator.name,
        password,
        rememberMe: true,
      },
      headers,
      asResponse: true,
    });
  }

  async function syncConfiguredAdmin({ username: usernameValue = "admin", password }) {
    const normalized = String(usernameValue || "admin").trim().toLowerCase();
    if (!/^[a-zA-Z0-9_.]+$/.test(normalized) || normalized.length < 2 || normalized.length > 64) {
      throw new Error("FORART_ADMIN_USERNAME 只能使用字母、数字、下划线和点，长度为 2-64 位");
    }
    if (String(password || "").length < 8) throw new Error("FORART_ADMIN_PASSWORD 至少需要 8 位");

    const existing = await context.internalAdapter.findUserByEmail(usernameEmail(normalized), { includeAccounts: true });
    if (!existing) {
      const user = await createUser({ username: normalized, password, role: "admin" });
      return { status: "created", user };
    }
    if (!isAdmin(existing.user)) {
      throw new Error(`FORART_ADMIN_USERNAME 对应的账号不是管理员: ${normalized}`);
    }

    const credentialAccount = existing.accounts.find((item) => item.providerId === "credential");
    const passwordMatches = credentialAccount?.password
      ? await context.password.verify({ password, hash: credentialAccount.password })
      : false;
    if (passwordMatches) return { status: "unchanged", user: existing.user };

    await resetPassword(existing.user.id, password);
    await context.internalAdapter.deleteUserSessions(existing.user.id);
    return { status: "updated", user: existing.user };
  }

  async function listUsers() {
    const [users, profiles, permissionRoles] = await Promise.all([
      context.internalAdapter.listUsers(500, 0, { field: "createdAt", direction: "desc" }),
      db.selectFrom("auth_user_profiles").selectAll().execute(),
      roles.listRoles(),
    ]);
    return users.map((user) => ({
      id: user.id, username: user.username || user.displayUsername || user.name,
      name: user.name, role: user.role || "user",
      createdAt: user.createdAt, updatedAt: user.updatedAt,
      lastLoginAt: profiles.find((profile) => profile.user_id === user.id)?.last_login_at || null,
      roleId: permissionRoles.find((role) => role.memberIds.includes(user.id))?.id || null,
    }));
  }

  async function deleteUser(userId, actorId) {
    if (String(userId) === String(actorId)) throw new Error("不能删除当前登录的管理员");
    const user = await context.internalAdapter.findUserById(userId);
    if (!user) throw new Error("用户不存在");
    if (isAdmin(user)) throw new Error("管理员账号不可删除");
    await context.internalAdapter.deleteUserSessions(userId);
    await context.internalAdapter.deleteUser(userId);
    return user;
  }

  async function resetPassword(userId, password) {
    if (String(password || "").length < 8) throw new Error("密码至少需要 8 位");
    const account = (await context.internalAdapter.findAccounts(userId)).find((item) => item.providerId === "credential");
    const hash = await context.password.hash(password);
    if (account) await context.internalAdapter.updatePassword(userId, hash);
    else await context.internalAdapter.createAccount({ userId, providerId: "credential", accountId: userId, password: hash });
  }

  return {
    auth, authorization, context, createBootstrapAdmin, createUser, isAdmin,
    listUsers, roles, requireAdmin, requireSession, sessionForRequest, deleteUser,
    resetPassword, signInAdminWithPassword, syncConfiguredAdmin,
    async revokeSessions(userId) { await context.internalAdapter.deleteUserSessions(userId); },
    async bootstrapStatus() { return { initialized: (await context.internalAdapter.countTotalUsers()) > 0 }; },
  };
}
