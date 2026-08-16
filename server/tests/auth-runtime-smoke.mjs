import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDatabaseRuntime } from "../src/db/database-runtime.mjs";
import { createAuthRuntime } from "../src/auth/auth-runtime.mjs";
import { GUEST_ROLE_KEY } from "../src/auth/organization-role-service.mjs";

async function signIn(runtime, username, password) {
  return runtime.auth.api.signInUsername({
    body: { username, password }, headers: new Headers(), asResponse: true,
  });
}

test("configured administrator creates or synchronizes its password", async (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "forart-configured-admin-"));
  const database = await createDatabaseRuntime({ driver: "sqlite", databasePath: path.join(directory, "library.sqlite") });
  t.after(async () => {
    await database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const runtime = await createAuthRuntime({ db: database.db, driver: "sqlite", serverPort: 6980 });
  const created = await runtime.syncConfiguredAdmin({ username: "admin", password: "password123" });
  assert.equal(created.status, "created");

  const initialSignIn = await signIn(runtime, "admin", "password123");
  const initialToken = initialSignIn.headers.get("set-auth-token");
  assert.equal(initialSignIn.status, 200);
  assert.ok(initialToken);
  const passwordOnlySignIn = await runtime.signInAdminWithPassword("password123");
  assert.equal(passwordOnlySignIn.status, 200);
  assert.ok(passwordOnlySignIn.headers.get("set-auth-token"));

  const unchanged = await runtime.syncConfiguredAdmin({ username: "admin", password: "password123" });
  assert.equal(unchanged.status, "unchanged");
  assert.ok(await runtime.auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${initialToken}` }) }));

  const updated = await runtime.syncConfiguredAdmin({ username: "admin", password: "new-password-456" });
  assert.equal(updated.status, "updated");
  assert.equal(await runtime.auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${initialToken}` }) }), null);
  assert.equal((await signIn(runtime, "admin", "password123")).status, 401);
  assert.equal((await signIn(runtime, "admin", "new-password-456")).status, 200);
  assert.equal((await runtime.signInAdminWithPassword("new-password-456")).status, 200);
});

test("username authentication and module permissions", async (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "forart-auth-runtime-"));
  const database = await createDatabaseRuntime({ driver: "sqlite", databasePath: path.join(directory, "library.sqlite") });
  t.after(async () => {
    await database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const runtime = await createAuthRuntime({ db: database.db, driver: "sqlite", serverPort: 6980 });
  assert.deepEqual(await runtime.bootstrapStatus(), { initialized: false });
  const admin = await runtime.createBootstrapAdmin({ username: "admin", password: "password123" });
  const adminSignIn = await runtime.auth.api.signInUsername({
    body: { username: "admin", password: "password123" }, headers: new Headers(), asResponse: true,
  });
  const adminToken = adminSignIn.headers.get("set-auth-token");
  assert.equal(adminSignIn.status, 200);
  assert.ok(adminToken);
  const adminHeaders = new Headers({ authorization: `Bearer ${adminToken}` });
  const member = await runtime.createUser({ username: "member", password: "password123" });
  const initialRoles = await runtime.roles.listRoles();
  const guestRole = initialRoles.find((role) => role.key === GUEST_ROLE_KEY);
  assert.equal(guestRole?.name, "访客");
  const storedGuestRole = await runtime.context.adapter.findOne({
    model: "organizationRole",
    where: [{ field: "id", value: guestRole.id }],
  });
  assert.deepEqual(JSON.parse(storedGuestRole.permission), {
    model_library: ["view"],
    outfit_library: ["view"],
    action_library: ["view"],
    shared_canvas: ["view"],
  });
  assert.equal((await runtime.roles.roleForUser(member.id))?.roleId, guestRole.id);
  assert.deepEqual(await runtime.authorization.listPermissions(member.id), [
    "action_library.view",
    "model_library.view",
    "outfit_library.view",
    "shared_canvas.view",
  ]);
  assert.equal(await runtime.authorization.hasPermission(member, "action_library.view"), true);
  assert.equal(await runtime.authorization.hasPermission(member, "model_library.project_edit"), false);
  const role = await runtime.roles.createRole({
    name: "内容编辑",
    permissions: ["action_library.entry_edit", "shared_canvas.canvas_edit"],
    memberIds: [member.id],
  }, adminHeaders);
  assert.equal(role.name, "内容编辑");
  assert.deepEqual(role.memberIds, [member.id]);
  const storedRole = await runtime.context.adapter.findOne({ model: "organizationRole", where: [{ field: "id", value: role.id }] });
  const storedPermission = JSON.parse(storedRole.permission);
  assert.deepEqual(storedPermission.model_library, ["view"]);
  assert.deepEqual(storedPermission.action_library.sort(), ["entry_edit", "view"]);
  assert.equal(await runtime.authorization.hasPermission(member, "action_library.entry_edit"), true);
  assert.equal(await runtime.authorization.hasPermission(member, "shared_canvas.canvas_edit"), true);
  assert.equal((await runtime.roles.roleForUser(member.id))?.roleId, role.id);
  const replacementRole = await runtime.roles.createRole({
    name: "画布编辑",
    permissions: ["shared_canvas.project_edit"],
    memberIds: [member.id],
  }, adminHeaders);
  assert.equal((await runtime.roles.roleForUser(member.id))?.roleId, replacementRole.id);
  assert.equal(await runtime.authorization.hasPermission(member, "action_library.entry_edit"), false);
  assert.equal(await runtime.authorization.hasPermission(member, "shared_canvas.project_edit"), true);

  const restartedRuntime = await createAuthRuntime({ db: database.db, driver: "sqlite", serverPort: 6980 });
  assert.equal((await restartedRuntime.roles.roleForUser(member.id))?.roleId, replacementRole.id);
  assert.equal(await restartedRuntime.authorization.hasPermission(member, "shared_canvas.project_edit"), true);
  await runtime.roles.updateRole(role.id, {
    permissions: [
      "action_library.entry_edit",
      "shared_canvas.canvas_edit",
      "model_library.entry_edit",
      "model_library.project_edit",
    ],
  }, adminHeaders);
  await runtime.roles.setUserRole(member.id, role.id, adminHeaders);

  assert.equal(admin.role, "admin");
  assert.equal(await runtime.authorization.hasPermission(admin, "shared_canvas.project_delete"), true);
  assert.equal(await runtime.authorization.hasPermission(member, "model_library.view"), true);
  assert.equal(await runtime.authorization.hasPermission(member, "model_library.entry_edit"), true);
  assert.equal(await runtime.authorization.hasPermission(member, "model_library.project_edit"), true);
  assert.deepEqual(await runtime.authorization.listPermissions(member.id), [
    "action_library.entry_edit",
    "action_library.view",
    "model_library.entry_edit",
    "model_library.project_edit",
    "model_library.view",
    "outfit_library.view",
    "shared_canvas.canvas_edit",
    "shared_canvas.view",
  ]);
  assert.equal(await runtime.authorization.hasPermission(member, "model_library.entry_delete"), false);
  assert.equal(await runtime.authorization.hasPermission(member, "model_library.entry_create"), false);


  const response = await runtime.auth.api.signInUsername({
    body: { username: "member", password: "password123" }, headers: new Headers(), asResponse: true,
  });
  assert.equal(response.status, 200);
  assert.ok(response.headers.get("set-auth-token"));
  const loggedInMember = (await runtime.listUsers()).find((user) => user.id === member.id);
  assert.ok(loggedInMember.lastLoginAt);
  assert.equal(Number.isNaN(Date.parse(loggedInMember.lastLoginAt)), false);

  const previousLoginAt = loggedInMember.lastLoginAt;
  const failedResponse = await runtime.auth.api.signInUsername({
    body: { username: "member", password: "incorrect-password" }, headers: new Headers(), asResponse: true,
  });
  assert.equal(failedResponse.status, 401);
  assert.equal((await runtime.listUsers()).find((user) => user.id === member.id).lastLoginAt, previousLoginAt);

  const remoteOriginResponse = await runtime.auth.handler(new Request("http://192.168.1.111:6980/api/auth/sign-in/username", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: "better-auth.session_token=stale",
      origin: "http://192.168.1.111:6980",
    },
    body: JSON.stringify({ username: "member", password: "password123", rememberMe: true }),
  }));
  assert.equal(remoteOriginResponse.status, 200);

  const proxyOriginResponse = await runtime.auth.handler(new Request("http://forart-server:6980/api/auth/sign-in/username", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: "better-auth.session_token=stale",
      origin: "https://forart.example.com",
      "x-forwarded-host": "forart.example.com",
      "x-forwarded-proto": "https",
    },
    body: JSON.stringify({ username: "member", password: "password123", rememberMe: true }),
  }));
  assert.equal(proxyOriginResponse.status, 200);

  const foreignOriginResponse = await runtime.auth.handler(new Request("http://192.168.1.111:6980/api/auth/sign-in/username", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: "better-auth.session_token=stale",
      origin: "https://untrusted.example.com",
    },
    body: JSON.stringify({ username: "member", password: "password123", rememberMe: true }),
  }));
  assert.equal(foreignOriginResponse.status, 403);

  await runtime.roles.setUserRole(member.id, guestRole.id, adminHeaders);
  assert.equal((await runtime.roles.roleForUser(member.id))?.roleId, guestRole.id);
  assert.equal(await runtime.authorization.hasPermission(member, "action_library.entry_edit"), false);
  assert.equal(await runtime.authorization.hasPermission(member, "model_library.entry_edit"), false);
  await runtime.roles.setUserRole(member.id, role.id, adminHeaders);
  await runtime.roles.deleteRole(role.id, adminHeaders);
  assert.equal((await runtime.roles.roleForUser(member.id))?.roleId, guestRole.id);
  assert.equal(await runtime.authorization.hasPermission(member, "shared_canvas.canvas_edit"), false);
  await assert.rejects(() => runtime.roles.deleteRole(guestRole.id, adminHeaders), /访客角色不能删除/);
  await assert.rejects(() => runtime.roles.updateRole(guestRole.id, { name: "其他" }, adminHeaders), /访客角色不能重命名/);

  await assert.rejects(() => runtime.deleteUser(admin.id, admin.id), /不能删除当前登录的管理员/);
  await assert.rejects(() => runtime.deleteUser(admin.id, "another-admin"), /管理员账号不可删除/);
  await runtime.deleteUser(member.id, admin.id);
  assert.equal(await runtime.context.internalAdapter.findUserById(member.id), null);
});
