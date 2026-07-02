const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,HEAD,POST,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type,authorization",
  "access-control-max-age": "86400",
};

export function withCorsHeaders(headers = {}) {
  return { ...CORS_HEADERS, ...headers };
}

export function sendJson(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, withCorsHeaders({ "content-type": "application/json; charset=utf-8", ...headers }));
  res.end(JSON.stringify(payload));
}

export function sendText(res, statusCode, text, contentType = "text/plain; charset=utf-8", headers = {}) {
  res.writeHead(statusCode, withCorsHeaders({ "content-type": contentType, ...headers }));
  res.end(text);
}

