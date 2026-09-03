function providerModelsUrl(provider) {
  const rawBaseUrl = String(provider?.baseUrl || '').trim();
  if (!rawBaseUrl) throw new Error('base-url-required');
  if (!/^https?:\/\//i.test(rawBaseUrl)) throw new Error('base-url-invalid');
  const baseUrl = rawBaseUrl.replace(/\/+$/, '');
  if (/\/models(?:\?.*)?$/i.test(baseUrl)) return baseUrl;
  if (String(provider?.protocol || '').toLowerCase() === 'gemini') {
    const geminiRoot = baseUrl.replace(/\/(?:api\/)?v\d+(?:beta)?$/i, '');
    return baseUrl.endsWith('/v1beta') ? `${baseUrl}/models` : `${geminiRoot}/v1beta/models`;
  }
  return /\/(?:api\/)?v\d+(?:beta)?$/i.test(baseUrl) ? `${baseUrl}/models` : `${baseUrl}/v1/models`;
}

function parseResponseBody(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

function extractModelIds(payload) {
  const record = payload && typeof payload === 'object' ? payload : null;
  const source = Array.isArray(payload) ? payload
    : Array.isArray(record?.data) ? record.data
      : Array.isArray(record?.models) ? record.models
        : Array.isArray(record?.list) ? record.list
          : Array.isArray(record?.model_list) ? record.model_list : [];
  return [...new Set(source.map((item) => {
    if (typeof item === 'string') return item;
    if (!item || typeof item !== 'object') return '';
    const value = item.id || item.name || item.model || item.model_id || item.modelId;
    return typeof value === 'string' ? value.replace(/^models\//, '').trim() : '';
  }).filter(Boolean))];
}

function authHeaders(provider) {
  const apiKey = String(provider?.apiKey || '').trim();
  return {
    Accept: 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

async function requestProviderModels({ net, provider }) {
  const response = await net.fetch(providerModelsUrl(provider), {
    method: 'GET',
    headers: authHeaders(provider),
    credentials: 'omit',
  });
  const text = await response.text();
  const payload = parseResponseBody(text);
  if (!response.ok) {
    const message = payload && typeof payload === 'object'
      ? String(payload.error || payload.message || '')
      : String(payload || '');
    throw new Error(`${response.status}${message ? ` ${message}` : ''}`);
  }
  return { models: extractModelIds(payload) };
}

async function requestApimartBalance({ net, provider }) {
  const apiKey = String(provider?.apiKey || '').trim();
  if (!apiKey) return { status: 'idle' };
  const headers = { Accept: 'application/json', Authorization: `Bearer ${apiKey}` };
  const [userResponse, tokenResponse] = await Promise.all([
    net.fetch(`${String(provider.baseUrl).replace(/\/+$/, '')}/user/balance`, { method: 'GET', headers, credentials: 'omit' }),
    net.fetch(`${String(provider.baseUrl).replace(/\/+$/, '')}/balance`, { method: 'GET', headers, credentials: 'omit' }),
  ]);
  const [userPayload, tokenPayload] = await Promise.all([
    userResponse.json().catch(() => ({})),
    tokenResponse.json().catch(() => ({})),
  ]);
  if (!userResponse.ok || userPayload?.success !== true) throw new Error(String(userPayload?.message || userResponse.status));
  if (!tokenResponse.ok || tokenPayload?.success !== true) throw new Error(String(tokenPayload?.message || tokenResponse.status));
  const toNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  return {
    status: 'ready',
    remainCredits: toNumber(userPayload.remain_credits),
    usedCredits: toNumber(tokenPayload.used_credits),
  };
}

module.exports = {
  requestApimartBalance,
  requestProviderModels,
};
