import assert from "node:assert/strict";
import test from "node:test";

const BASE_URL = String(process.env.FORART_HTTP_BASE_URL || "").replace(/\/$/, "");
const ONE_PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
let authToken = "";

async function request(pathname, { method = "GET", body, expectedStatus = 200 } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (authToken) headers.authorization = `Bearer ${authToken}`;
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status !== expectedStatus) {
    const detail = await response.text();
    assert.fail(`${method} ${pathname} returned ${response.status}, expected ${expectedStatus}: ${detail}`);
  }
  const contentType = response.headers.get("content-type") || "";
  return contentType.includes("application/json") ? response.json() : response.arrayBuffer();
}

async function signInAdministrator() {
  const username = process.env.FORART_HTTP_ADMIN_USERNAME || process.env.FORART_ADMIN_USERNAME || "admin";
  const password = process.env.FORART_HTTP_ADMIN_PASSWORD || process.env.FORART_ADMIN_PASSWORD || "";
  assert.ok(password, "Set FORART_HTTP_ADMIN_PASSWORD or FORART_ADMIN_PASSWORD for the HTTP smoke test");
  const response = await fetch(`${BASE_URL}/api/auth/sign-in/username`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE_URL },
    body: JSON.stringify({ username, password }),
  });
  if (response.status !== 200) {
    assert.fail(`Administrator sign-in returned ${response.status}: ${await response.text()}`);
  }
  authToken = response.headers.get("set-auth-token") || "";
  assert.ok(authToken, "Administrator sign-in did not return a bearer token");
}

async function createTag(kind, projectId, name) {
  return request(`/api/libraries/${kind}/tags?project_id=${encodeURIComponent(projectId)}`, {
    method: "POST",
    body: { name, color: "blue" },
  });
}

async function importEntry(kind, projectId, entry) {
  const plural = kind === "outfit" ? "outfits" : "actions";
  return request(`/api/${kind}-projects/${encodeURIComponent(projectId)}/${plural}/import-entries`, {
    method: "POST",
    body: { entries: [entry] },
  });
}

test("Docker server HTTP APIs support PostgreSQL library operations", { skip: !BASE_URL }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const createdProjects = [];

  try {
    assert.deepEqual(await request("/api/health"), { ok: true, database: "ready" });
    await signInAdministrator();
    const storage = await request("/api/settings/storage");
    assert.equal(storage.configured, true);
    assert.equal(storage.driver, "postgres");

    const modelProject = await request("/api/model-projects", {
      method: "POST",
      body: { name: `HTTP Model ${suffix}` },
    });
    createdProjects.push(["model", modelProject.id]);
    const renamedModelProject = await request(`/api/model-projects/${modelProject.id}`, {
      method: "PATCH",
      body: { name: `HTTP Model Renamed ${suffix}`, sort_order: 7 },
    });
    assert.equal(renamedModelProject.sort_order, 7);

    const modelTag = await createTag("model", modelProject.id, `shared-${suffix}`);
    const updatedModelTag = await request(`/api/libraries/model/tags/${modelTag.id}?project_id=${modelProject.id}`, {
      method: "PATCH",
      body: { color: "green", sort_order: 3 },
    });
    assert.equal(updatedModelTag.color, "green");

    const modelProjectTwo = await request("/api/model-projects", {
      method: "POST",
      body: { name: `HTTP Model Two ${suffix}` },
    });
    createdProjects.push(["model", modelProjectTwo.id]);
    const isolatedTag = await createTag("model", modelProjectTwo.id, `shared-${suffix}`);
    assert.notEqual(modelTag.id, isolatedTag.id);

    const model = await request(`/api/model-projects/${modelProject.id}/models`, {
      method: "POST",
      body: { name: `HTTP Model Entry ${suffix}`, gender: "female" },
    });
    const taggedModel = await request(`/api/models/${model.id}`, {
      method: "PATCH",
      body: { name: `HTTP Model Entry Renamed ${suffix}`, tags: [modelTag.name] },
    });
    assert.deepEqual(taggedModel.tags, [modelTag.name]);

    const filteredModels = await request(`/api/model-projects/${modelProject.id}/models?tag_id=${modelTag.id}&gender=female`);
    assert.equal(filteredModels.models.some((entry) => entry.id === model.id), true);

    const uploadedModelImage = await request(`/api/models/${model.id}/images/upload`, {
      method: "POST",
      body: { filename: "http-model.png", mime_type: "image/png", data: ONE_PIXEL_PNG },
    });
    const assetId = uploadedModelImage.asset.id;
    assert.ok(assetId);
    assert.equal((await request(`/api/assets/${assetId}/file`)).byteLength > 0, true);
    assert.equal((await request(`/api/assets/${assetId}/thumb`)).byteLength > 0, true);
    assert.equal((await request(`/api/assets/${assetId}/download`)).byteLength > 0, true);

    const removeTags = await request("/api/libraries/model/entries/bulk", {
      method: "POST",
      body: { project_id: modelProject.id, entry_ids: [model.id], operation: "remove_tags", tags: [modelTag.name] },
    });
    assert.equal(removeTags.updated, 1);
    const addTags = await request("/api/libraries/model/entries/bulk", {
      method: "POST",
      body: { project_id: modelProject.id, entry_ids: [model.id], operation: "add_tags", tags: [modelTag.name] },
    });
    assert.equal(addTags.updated, 1);

    const outfitProject = await request("/api/outfit-projects", {
      method: "POST",
      body: { name: `HTTP Outfit ${suffix}` },
    });
    createdProjects.push(["outfit", outfitProject.id]);
    const outfitTag = await createTag("outfit", outfitProject.id, `shared-${suffix}`);
    assert.notEqual(outfitTag.id, modelTag.id);
    const importedOutfit = await importEntry("outfit", outfitProject.id, {
      name: `HTTP Outfit Entry ${suffix}`,
      filename: "http-outfit.png",
      mime_type: "image/png",
      data: ONE_PIXEL_PNG,
      tags: [outfitTag.name],
    });
    assert.equal(importedOutfit.imported_count, 1);
    const outfit = importedOutfit.imported[0];
    const updatedOutfit = await request(`/api/outfits/${outfit.id}`, {
      method: "PATCH",
      body: { name: `HTTP Outfit Renamed ${suffix}`, tags: [outfitTag.name] },
    });
    assert.deepEqual(updatedOutfit.tags, [outfitTag.name]);
    await request(`/api/outfits/${outfit.id}/image/upload`, {
      method: "POST",
      body: { filename: "http-outfit-replaced.png", mime_type: "image/png", data: ONE_PIXEL_PNG },
    });

    const actionProject = await request("/api/action-projects", {
      method: "POST",
      body: { name: `HTTP Action ${suffix}` },
    });
    createdProjects.push(["action", actionProject.id]);
    const actionTag = await createTag("action", actionProject.id, `shared-${suffix}`);
    assert.notEqual(actionTag.id, modelTag.id);
    const importedAction = await importEntry("action", actionProject.id, {
      name: `HTTP Action Entry ${suffix}`,
      filename: "http-action.png",
      mime_type: "image/png",
      data: ONE_PIXEL_PNG,
      tags: [actionTag.name],
      prompt: "initial prompt",
    });
    assert.equal(importedAction.imported_count, 1);
    const action = importedAction.imported[0];
    const updatedAction = await request(`/api/actions/${action.id}`, {
      method: "PATCH",
      body: { tags: [actionTag.name], prompt: "updated prompt" },
    });
    assert.equal(updatedAction.prompt, "updated prompt");

    const summary = await request("/api/admin/library-summary");
    assert.equal(summary.ok, true);
    assert.equal(summary.summary.modelProjects >= 2, true);
    assert.equal(summary.summary.outfits >= 1, true);
    assert.equal(summary.summary.actions >= 1, true);

    await request(`/api/models/${model.id}`, { method: "DELETE" });
    await request(`/api/assets/${assetId}/file`, { expectedStatus: 404 });
  } finally {
    for (const [kind, projectId] of createdProjects.reverse()) {
      const prefix = kind === "model" ? "model-projects" : `${kind}-projects`;
      try {
        await request(`/api/${prefix}/${projectId}`, { method: "DELETE" });
      } catch {}
    }
  }
});
