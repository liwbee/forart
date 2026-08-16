import type { AuthProvider, DataProvider } from "@refinedev/core";
import { apiRequest, authToken, clearAuthToken, signIn, signOut } from "./api";
import type { AdminIdentity, AdminUser, PermissionDefinition } from "./types";
import { AdminApiError } from "./types";

type LoginInput = { password: string };
type UserMutation = {
  username?: string;
  password?: string;
  roleId?: string | null;
};

export const authProvider: AuthProvider = {
  async login(params: LoginInput) {
    try {
      await signIn(params.password);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  },
  async logout() {
    await signOut().catch(() => clearAuthToken());
    return { success: true };
  },
  async check() {
    if (!authToken()) return { authenticated: false };
    try {
      await apiRequest("/api/me");
      return { authenticated: true };
    } catch (error) {
      if (error instanceof AdminApiError && (error.statusCode === 401 || error.statusCode === 403)) {
        clearAuthToken();
        return { authenticated: false, logout: true };
      }
      return { authenticated: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  },
  async onError(error) {
    const status = Number(error?.statusCode || error?.status || 0);
    if (status === 401 || status === 403) {
      clearAuthToken();
      return { logout: true };
    }
    return { error };
  },
  async getIdentity() {
    const payload = await apiRequest<{ user: AdminIdentity }>("/api/me");
    return payload.user;
  },
};

export const dataProvider = {
  async getList({ resource }: { resource: string }) {
    if (resource !== "users") throw new AdminApiError(`不支持的资源：${resource}`, 400);
    const payload = await apiRequest<{ users: AdminUser[] }>("/api/admin/users");
    return { data: payload.users, total: payload.users.length };
  },
  async getOne({ resource, id }: { resource: string; id: string | number }) {
    if (resource !== "users") throw new AdminApiError(`不支持的资源：${resource}`, 400);
    const payload = await apiRequest<{ users: AdminUser[] }>("/api/admin/users");
    const user = payload.users.find((item) => item.id === String(id));
    if (!user) throw new AdminApiError("用户不存在", 404);
    return { data: user };
  },
  async create({ resource, variables }: { resource: string; variables: UserMutation }) {
    if (resource !== "users") throw new AdminApiError(`不支持的资源：${resource}`, 400);
    const payload = await apiRequest<{ user: AdminUser }>("/api/admin/users", {
      method: "POST",
      body: JSON.stringify(variables),
    });
    return { data: payload.user };
  },
  async update({ resource, id, variables }: { resource: string; id: string | number; variables: UserMutation }) {
    if (resource !== "users") throw new AdminApiError(`不支持的资源：${resource}`, 400);
    if (variables.roleId !== undefined) {
      await apiRequest(`/api/admin/users/${encodeURIComponent(String(id))}/role`, {
        method: "PUT",
        body: JSON.stringify({ roleId: variables.roleId }),
      });
    }
    const payload = await apiRequest<{ users: AdminUser[] }>("/api/admin/users");
    const user = payload.users.find((item) => item.id === String(id));
    if (!user) throw new AdminApiError("用户不存在", 404);
    return { data: user };
  },
  async deleteOne({ resource, id }: { resource: string; id: string | number }) {
    if (resource !== "users") throw new AdminApiError(`不支持的资源：${resource}`, 400);
    await apiRequest(`/api/admin/users/${encodeURIComponent(String(id))}`, { method: "DELETE" });
    return { data: { id: String(id) } };
  },
  getApiUrl() {
    return "/api/admin";
  },
  async custom({ url, method, payload }: { url: string; method: string; payload?: unknown }) {
    const data = await apiRequest(url, {
      method: method.toUpperCase(),
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    return { data };
  },
} as DataProvider;

export async function loadPermissionCatalog() {
  return apiRequest<{ permissions: PermissionDefinition[] }>("/api/admin/permission-catalog");
}
