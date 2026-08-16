import { getActiveForartConfig, getApiBaseUrl } from "../data-source/runtime";
import { invalidatePermissions, refreshPermissions } from "../features/permissions";
import { requestFailureKindFromStatus, type RequestFailureKind } from "./requestFailure";

const QUERY_TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  status: number;
  detail: unknown;
  kind: RequestFailureKind;

  constructor(message: string, status: number, detail: unknown, kind = requestFailureKindFromStatus(status)) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.kind = kind;
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

function networkError(error: unknown, timedOut: boolean) {
  if (timedOut) return new ApiError("Request timed out.", 0, error, "timeout");
  const message = error instanceof Error && error.message ? error.message : "Network request failed.";
  return new ApiError(message, 0, error, "unavailable");
}

async function httpRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const authToken = getActiveForartConfig()?.serverAuthToken || "";
  const requestController = new AbortController();
  const sourceSignal = options.signal;
  const forwardAbort = () => requestController.abort(sourceSignal?.reason);
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  if (sourceSignal?.aborted) forwardAbort();
  else sourceSignal?.addEventListener("abort", forwardAbort, { once: true });
  if (requestMethod(options) === "GET") {
    timeout = setTimeout(() => {
      timedOut = true;
      requestController.abort();
    }, QUERY_TIMEOUT_MS);
  }

  let response: Response;
  try {
    response = await fetch(resolveApiUrl(path), {
      ...options,
      signal: requestController.signal,
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...(options.headers || {}),
      },
    });
  } catch (error) {
    if (sourceSignal?.aborted && !timedOut) throw error;
    throw networkError(error, timedOut);
  } finally {
    if (timeout) clearTimeout(timeout);
    sourceSignal?.removeEventListener("abort", forwardAbort);
  }

  const body = await parseResponse(response);

  if (!response.ok) {
    if (response.status === 401) invalidatePermissions();
    if (response.status === 403) void refreshPermissions();
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
