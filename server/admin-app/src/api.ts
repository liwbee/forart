import { AdminApiError } from "./types";

const TOKEN_KEY = "forart-admin-token";

export function authToken() {
  return sessionStorage.getItem(TOKEN_KEY) || "";
}

export function clearAuthToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = authToken();
  const response = await fetch(path, {
    ...options,
    headers: {
      accept: "application/json",
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new AdminApiError(payload.detail || payload.message || `HTTP ${response.status}`, response.status);
  }
  return payload as T;
}

export async function signIn(password: string) {
  const response = await fetch("/api/admin/sign-in/password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new AdminApiError(payload.message || payload.detail || "登录失败", response.status);
  const token = response.headers.get("set-auth-token") || payload.token || "";
  if (!token) throw new AdminApiError("登录成功，但服务端没有返回会话令牌", 502);
  sessionStorage.setItem(TOKEN_KEY, token);
  return payload;
}

export async function signOut() {
  try {
    await apiRequest("/api/auth/sign-out", { method: "POST" });
  } finally {
    clearAuthToken();
  }
}
