async function readJson(path) {
  const response = await fetch(path, {
    headers: { accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.detail || `HTTP ${response.status}`);
  }
  return payload;
}

export async function loadAdminData() {
  const [status, storage, summary, environment] = await Promise.all([
    readJson("/api/admin/status"),
    readJson("/api/admin/storage"),
    readJson("/api/admin/library-summary"),
    readJson("/api/admin/environment"),
  ]);

  return { status, storage, summary, environment };
}

