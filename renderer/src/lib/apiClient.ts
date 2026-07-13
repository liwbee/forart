import { getActiveForartConfig, getApiBaseUrl } from "../data-source/runtime";

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(message: string, status: number, detail: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

function resolveApiUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  const apiBaseUrl = getApiBaseUrl();
  if (!apiBaseUrl) return path;
  return `${apiBaseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

async function parseResponse(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return response.json();
  return response.text();
}

function requestMethod(options: RequestInit) {
  return String(options.method || "GET").toUpperCase();
}

function shouldTryLocalIpc(path: string) {
  if (/^https?:\/\//i.test(path)) return false;
  if (!window.forartLocalApi?.request) return false;
  return getActiveForartConfig()?.mode === "local";
}

async function parseRequestBody(body: BodyInit | null | undefined) {
  if (body == null) return undefined;
  if (typeof body !== "string") return body;
  if (!body.trim()) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function throwApiErrorFromBody(status: number, body: unknown): never {
  const message =
    typeof body === "object" && body && "detail" in body
      ? String((body as { detail: unknown }).detail)
      : String(body || `Request failed with ${status}`);
  throw new ApiError(message, status, body);
}

async function httpRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(resolveApiUrl(path), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await parseResponse(response);

  if (!response.ok) {
    throwApiErrorFromBody(response.status, body);
  }

  return body as T;
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (shouldTryLocalIpc(path)) {
    const result = await window.forartLocalApi!.request({
      path,
      method: requestMethod(options),
      body: await parseRequestBody(options.body),
    });
    if (result.ok) return result.body as T;
    throwApiErrorFromBody(result.status, result.body);
  }

  return httpRequest<T>(path, options);
}
