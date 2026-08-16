export type RequestFailureKind =
  | "unauthenticated"
  | "forbidden"
  | "timeout"
  | "unavailable"
  | "server"
  | "request"
  | "unknown";

export interface RequestFailure {
  kind: RequestFailureKind;
  message: string;
  status?: number;
  retryable: boolean;
}

interface ErrorLike {
  kind?: unknown;
  message?: unknown;
  name?: unknown;
  status?: unknown;
}

const REQUEST_FAILURE_KINDS = new Set<RequestFailureKind>([
  "unauthenticated",
  "forbidden",
  "timeout",
  "unavailable",
  "server",
  "request",
  "unknown",
]);

export function requestFailureKindFromStatus(status: number): RequestFailureKind {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status >= 500) return "server";
  return "request";
}

function isRetryableKind(kind: RequestFailureKind) {
  return kind === "timeout" || kind === "unavailable" || kind === "server";
}

function networkFailureFromMessage(message: string) {
  return /fetch failed|failed to fetch|network|econn|enotfound|connection refused|connection reset|socket|net::/i.test(message);
}

export function classifyRequestFailure(error: unknown): RequestFailure | null {
  if (!error) return null;
  const source = typeof error === "object" ? error as ErrorLike : {};
  const status = typeof source.status === "number" && Number.isFinite(source.status)
    ? source.status
    : undefined;
  const message = typeof source.message === "string" && source.message.trim()
    ? source.message.trim()
    : String(error);
  const explicitKind = typeof source.kind === "string" && REQUEST_FAILURE_KINDS.has(source.kind as RequestFailureKind)
    ? source.kind as RequestFailureKind
    : null;
  const kind = explicitKind
    || (status && status > 0 ? requestFailureKindFromStatus(status) : null)
    || (source.name === "AbortError" || /timed?\s*out|timeout/i.test(message) ? "timeout" : null)
    || (networkFailureFromMessage(message) ? "unavailable" : "unknown");

  return {
    kind,
    message,
    ...(status && status > 0 ? { status } : {}),
    retryable: isRetryableKind(kind),
  };
}

export function firstRequestFailure(errors: readonly unknown[]) {
  for (const error of errors) {
    const failure = classifyRequestFailure(error);
    if (failure) return failure;
  }
  return null;
}

export function isRetryableRequestError(error: unknown) {
  return Boolean(classifyRequestFailure(error)?.retryable);
}
