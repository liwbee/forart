import { getApiBaseUrl } from "../data-source/runtime";

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

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(resolveApiUrl(path), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await parseResponse(response);

  if (!response.ok) {
    const message =
      typeof body === "object" && body && "detail" in body
        ? String((body as { detail: unknown }).detail)
        : String(body || `Request failed with ${response.status}`);
    throw new ApiError(message, response.status, body);
  }

  return body as T;
}

export async function fileToAssetPayload(file: File) {
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
    reader.onerror = () => reject(reader.error || new Error("Failed to read image"));
    reader.readAsDataURL(file);
  });

  return {
    filename: file.name || "image",
    mime_type: file.type || "image/png",
    data,
  };
}
