import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizeApiRequest,
  requiredCanvasPermissions,
  requiredLibraryPermissions,
} from "../src/auth/request-authorization.mjs";
import { expandPermissionKeys, permissionKeysToStatement } from "../src/auth/permission-catalog.mjs";
import { requiredProjectUpdatePermissions } from "../src/canvas-exchange/canvas-exchange-api.mjs";

function responseStub() {
  let statusCode = 200;
  let payload = "";
  return {
    writeHead(status) { statusCode = status; },
    end(body = "") { payload = String(body); },
    get statusCode() { return statusCode; },
    get payload() { return payload ? JSON.parse(payload) : null; },
  };
}

function authFor({ session = { user: { id: "member", role: "user" } }, permissions = [] } = {}) {
  return {
    async requireSession() { return session; },
    authorization: {
      async hasAnyPermission(user, required) {
        if (user?.role === "admin") return true;
        return required.some((key) => permissions.includes(key));
      },
    },
  };
}

test("permission route matrix maps library operations to independent capabilities", () => {
  assert.deepEqual(requiredLibraryPermissions("model_library", "/api/model-projects", "GET"), ["model_library.view"]);
  assert.deepEqual(requiredLibraryPermissions("model_library", "/api/model-projects", "POST"), ["model_library.project_edit"]);
  assert.deepEqual(requiredLibraryPermissions("model_library", "/api/model-projects/project-1", "DELETE"), ["model_library.project_delete"]);
  assert.deepEqual(requiredLibraryPermissions("model_library", "/api/model-projects/project-1/models", "POST"), ["model_library.entry_edit"]);
  assert.deepEqual(requiredLibraryPermissions("model_library", "/api/models/model-1", "PATCH"), ["model_library.entry_edit"]);
  assert.deepEqual(requiredLibraryPermissions("model_library", "/api/models/model-1", "DELETE"), ["model_library.entry_delete"]);
  assert.deepEqual(requiredLibraryPermissions("model_library", "/api/libraries/model/tags", "POST"), ["model_library.tag_manage"]);
  assert.deepEqual(requiredLibraryPermissions("model_library", "/api/libraries/model/entries/bulk", "POST"), []);
  assert.deepEqual(requiredCanvasPermissions("/api/canvas-exchange/projects", "GET"), ["shared_canvas.view"]);
  assert.deepEqual(requiredCanvasPermissions("/api/canvas-exchange/projects", "POST"), ["shared_canvas.project_edit"]);
  assert.deepEqual(requiredCanvasPermissions("/api/canvas-exchange/projects/project-1", "PATCH"), ["shared_canvas.project_edit", "shared_canvas.project_reorder"]);
  assert.deepEqual(requiredCanvasPermissions("/api/canvas-exchange/projects/project-1", "DELETE"), ["shared_canvas.project_delete"]);
  assert.deepEqual(requiredCanvasPermissions("/api/canvas-exchange/canvases/canvas-1", "PATCH"), ["shared_canvas.canvas_edit"]);
  assert.deepEqual(requiredCanvasPermissions("/api/canvas-exchange/canvases/canvas-1", "DELETE"), ["shared_canvas.canvas_delete"]);
  assert.deepEqual(requiredCanvasPermissions("/api/canvas-exchange/canvases/canvas-1/assets/image-1", "GET"), ["shared_canvas.view"]);
  assert.deepEqual(requiredCanvasPermissions("/api/canvas-exchange/canvases/canvas-1/package", "GET"), ["shared_canvas.copy_to_local"]);
  assert.deepEqual(requiredCanvasPermissions("/api/canvas-exchange/canvases/canvas-1/transfer", "GET"), ["shared_canvas.copy_to_local"]);
});

test("every non-view capability expands to its module view capability", () => {
  assert.deepEqual(expandPermissionKeys(["model_library.entry_edit"]), [
    "action_library.view",
    "model_library.entry_edit",
    "model_library.view",
    "outfit_library.view",
    "shared_canvas.view",
  ]);
  assert.deepEqual(expandPermissionKeys(["shared_canvas.canvas_delete"]), [
    "action_library.view",
    "model_library.view",
    "outfit_library.view",
    "shared_canvas.canvas_delete",
    "shared_canvas.canvas_edit",
    "shared_canvas.view",
  ]);
});

test("destructive permissions imply their matching edit permission", () => {
  assert.deepEqual(expandPermissionKeys(["model_library.entry_delete"]), [
    "action_library.view",
    "model_library.entry_delete",
    "model_library.entry_edit",
    "model_library.view",
    "outfit_library.view",
    "shared_canvas.view",
  ]);
  assert.deepEqual(expandPermissionKeys(["shared_canvas.canvas_delete"]), [
    "action_library.view",
    "model_library.view",
    "outfit_library.view",
    "shared_canvas.canvas_delete",
    "shared_canvas.canvas_edit",
    "shared_canvas.view",
  ]);
  assert.deepEqual(permissionKeysToStatement(["model_library.project_delete"]).model_library.sort(), ["project_delete", "project_edit", "view"]);
});

test("request authorization accepts either project permission at the coarse gate", async () => {
  for (const permission of ["model_library.project_edit", "model_library.project_reorder"]) {
    const response = responseStub();
    assert.equal(await authorizeApiRequest(
      { method: "PATCH", headers: new Headers() }, response,
      "/api/model-projects/project-1", authFor({ permissions: [permission] }),
    ), true);
    assert.equal(response.statusCode, 200);
  }
});

test("shared canvas project fields enforce edit and reorder independently", () => {
  assert.deepEqual(requiredProjectUpdatePermissions({ title: "Renamed" }), ["shared_canvas.project_edit"]);
  assert.deepEqual(requiredProjectUpdatePermissions({ color: "blue" }), ["shared_canvas.project_edit"]);
  assert.deepEqual(requiredProjectUpdatePermissions({ sortOrder: 2 }), ["shared_canvas.project_reorder"]);
  assert.deepEqual(requiredProjectUpdatePermissions({ title: "Renamed", sortOrder: 2 }), [
    "shared_canvas.project_reorder",
    "shared_canvas.project_edit",
  ]);
});

test("bulk entry authorization only requires authentication before operation-specific checks", async () => {
  for (const permission of ["model_library.entry_edit", "model_library.entry_delete"]) {
    const response = responseStub();
    assert.equal(await authorizeApiRequest(
      { method: "POST", headers: new Headers() }, response,
      "/api/libraries/model/entries/bulk", authFor({ permissions: [permission] }),
    ), true);
    assert.equal(response.statusCode, 200);
  }
});

test("request authorization denies a remote member without the required capability", async () => {
  const response = responseStub();
  assert.equal(await authorizeApiRequest(
    { method: "DELETE", headers: new Headers() }, response,
    "/api/models/model-1", authFor(),
  ), false);
  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.payload.required, ["model_library.entry_delete"]);
});

test("request authorization grants admins without individual permission rows", async () => {
  const response = responseStub();
  assert.equal(await authorizeApiRequest(
    { method: "DELETE", headers: new Headers() }, response,
    "/api/models/model-1", authFor({ session: { user: { id: "admin", role: "admin" } } }),
  ), true);
  assert.equal(response.statusCode, 200);
});

test("read-only shared canvas members can access assets without copy permission", async () => {
  const response = responseStub();
  assert.equal(await authorizeApiRequest(
    { method: "GET", headers: new Headers() }, response,
    "/api/canvas-exchange/canvases/canvas-1/assets/image-1", authFor({ permissions: ["shared_canvas.view"] }),
  ), true);
  assert.equal(response.statusCode, 200);

  const packageResponse = responseStub();
  assert.equal(await authorizeApiRequest(
    { method: "GET", headers: new Headers() }, packageResponse,
    "/api/canvas-exchange/canvases/canvas-1/package", authFor({ permissions: ["shared_canvas.view"] }),
  ), false);
  assert.equal(packageResponse.statusCode, 403);
});
