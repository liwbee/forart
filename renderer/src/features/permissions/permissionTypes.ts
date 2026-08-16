export const PERMISSION_KEYS = [
  "model_library.view",
  "model_library.project_edit",
  "model_library.project_delete",
  "model_library.project_reorder",
  "model_library.entry_edit",
  "model_library.entry_delete",
  "model_library.tag_manage",
  "outfit_library.view",
  "outfit_library.project_edit",
  "outfit_library.project_delete",
  "outfit_library.project_reorder",
  "outfit_library.entry_edit",
  "outfit_library.entry_delete",
  "outfit_library.tag_manage",
  "action_library.view",
  "action_library.project_edit",
  "action_library.project_delete",
  "action_library.project_reorder",
  "action_library.entry_edit",
  "action_library.entry_delete",
  "action_library.tag_manage",
  "shared_canvas.view",
  "shared_canvas.project_edit",
  "shared_canvas.project_delete",
  "shared_canvas.project_reorder",
  "shared_canvas.canvas_edit",
  "shared_canvas.canvas_delete",
  "shared_canvas.copy_to_local",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];
export type PermissionStatus = "idle" | "loading" | "ready" | "error";

export interface PermissionUser {
  id: string;
  username?: string;
  name?: string;
  role?: string;
}

export function isPermissionKey(value: string): value is PermissionKey {
  return (PERMISSION_KEYS as readonly string[]).includes(value);
}

export const BASE_READ_PERMISSION_KEYS = PERMISSION_KEYS.filter((key) => key.endsWith(".view"));

export function expandPermissionKeys(values: unknown): PermissionKey[] {
  const expanded = new Set<PermissionKey>(BASE_READ_PERMISSION_KEYS);
  if (!Array.isArray(values)) return [...expanded];
  for (const value of values.map(String)) {
    if (!isPermissionKey(value)) continue;
    expanded.add(value);
  }
  return [...expanded];
}
