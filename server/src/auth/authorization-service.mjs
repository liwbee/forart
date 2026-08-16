import { PERMISSION_KEYS } from "./permission-catalog.mjs";

export function createAuthorizationService({ db, roles }) {
  async function listPermissions(userId) {
    return roles.listPermissions(userId);
  }

  async function hasPermission(user, permissionKey) {
    if (!user) return false;
    if (user.role === "admin" || (Array.isArray(user.role) && user.role.includes("admin"))) return true;
    const key = String(permissionKey || "");
    if (!PERMISSION_KEYS.has(key)) return false;
    if (key.endsWith(".view")) return true;
    return (await listPermissions(user.id)).includes(key);
  }

  async function hasAnyPermission(user, permissionKeys) {
    if (!user) return false;
    if (user.role === "admin" || (Array.isArray(user.role) && user.role.includes("admin"))) return true;
    const granted = new Set(await listPermissions(user.id));
    return permissionKeys.some((key) => PERMISSION_KEYS.has(String(key || "")) && granted.has(String(key)));
  }

  async function assetModules(assetId) {
    const [entryRows, projectRows] = await Promise.all([
      db.selectFrom("library_entry_assets").select("kind").distinct().where("asset_id", "=", assetId).execute(),
      db.selectFrom("library_projects").select("kind").distinct().where("cover_asset_id", "=", assetId).execute(),
    ]);
    return [...new Set([...entryRows, ...projectRows].map((row) => `${row.kind}_library`))];
  }

  return {
    assetModules,
    hasAnyPermission,
    hasPermission,
    listPermissions,
  };
}
