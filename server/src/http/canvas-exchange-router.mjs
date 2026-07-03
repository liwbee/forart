import { handleCanvasExchangeApi } from "../canvas-exchange/canvas-exchange-api.mjs";

export function createCanvasExchangeRouter({ context }) {
  return function handleCanvasExchangeRoute(req, res, url) {
    if (url.pathname.startsWith("/api/canvas-exchange/")) {
      return handleCanvasExchangeApi(req, res, url, context);
    }
    return false;
  };
}

