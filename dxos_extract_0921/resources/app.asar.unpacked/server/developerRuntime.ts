export const DEVELOPER_RUNTIME_RESOURCE_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  // Sandboxed dx-app/v2 iframes have an opaque origin. Vite/ES module scripts
  // require an explicit CORS response even though the file URL is local.
  'Access-Control-Allow-Origin': '*',
  'Cross-Origin-Resource-Policy': 'cross-origin',
})
