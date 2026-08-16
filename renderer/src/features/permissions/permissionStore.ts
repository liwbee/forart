import { create } from "zustand";
import type { ForartAppConfig } from "../../app/appConfig";
import { expandPermissionKeys, type PermissionKey, type PermissionStatus, type PermissionUser } from "./permissionTypes";

interface PermissionState {
  mode: "local" | "remote";
  status: PermissionStatus;
  role: string;
  user: PermissionUser | null;
  permissions: PermissionKey[];
  error: string;
}

const LOCAL_STATE: PermissionState = {
  mode: "local",
  status: "ready",
  role: "local",
  user: null,
  permissions: [],
  error: "",
};

export const usePermissionStore = create<PermissionState>(() => LOCAL_STATE);

let activeConfig: ForartAppConfig | null = null;
let loadSequence = 0;

function normalizedPermissions(values: unknown): PermissionKey[] {
  return expandPermissionKeys(values);
}

export function hasPermissionSnapshot(state: PermissionState, permission: PermissionKey) {
  if (state.mode === "local" || state.role === "admin") return true;
  return state.status === "ready" && state.permissions.includes(permission);
}

export function usePermission(permission: PermissionKey) {
  return usePermissionStore((state) => hasPermissionSnapshot(state, permission));
}

export function useAnyPermission(permissions: readonly PermissionKey[]) {
  return usePermissionStore((state) => permissions.some((permission) => hasPermissionSnapshot(state, permission)));
}

export function currentPermissionAllows(permission: PermissionKey) {
  return hasPermissionSnapshot(usePermissionStore.getState(), permission);
}

export async function syncPermissions(config: ForartAppConfig) {
  activeConfig = config;
  const sequence = ++loadSequence;
  if (config.mode === "local") {
    usePermissionStore.setState(LOCAL_STATE, true);
    return;
  }
  if (!config.serverAuthToken || !config.serverUrl) {
    usePermissionStore.setState({ mode: "remote", status: "ready", role: "", user: null, permissions: [], error: "" }, true);
    return;
  }

  usePermissionStore.setState({
    mode: "remote",
    status: "loading",
    role: "",
    user: null,
    permissions: [],
    error: "",
  }, true);
  try {
    const result = await window.forartConfig?.serverSession({
      serverUrl: config.serverUrl,
      token: config.serverAuthToken,
    });
    if (sequence !== loadSequence) return;
    if (!result?.ok) throw new Error(result?.error || "Permission snapshot request failed.");
    usePermissionStore.setState({
      mode: "remote",
      status: "ready",
      role: String(result.user?.role || "user"),
      user: result.user || null,
      permissions: normalizedPermissions(result.permissions),
      error: "",
    }, true);
  } catch (error) {
    if (sequence !== loadSequence) return;
    usePermissionStore.setState({
      mode: "remote",
      status: "error",
      role: "",
      user: null,
      permissions: [],
      error: error instanceof Error ? error.message : String(error),
    }, true);
  }
}

export function refreshPermissions() {
  return activeConfig ? syncPermissions(activeConfig) : Promise.resolve();
}

export function invalidatePermissions() {
  loadSequence += 1;
  if (activeConfig?.mode === "local") usePermissionStore.setState(LOCAL_STATE, true);
  else usePermissionStore.setState({ mode: "remote", status: "ready", role: "", user: null, permissions: [], error: "" }, true);
}
