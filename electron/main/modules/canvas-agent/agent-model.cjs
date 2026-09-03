function agentBaseUrl(provider) {
  const value = String(provider?.baseUrl || '').trim().replace(/\/+$/, '');
  if (!value) return undefined;
  const protocol = String(provider?.protocol || 'openai').toLowerCase();
  if (protocol === 'gemini') return value;
  if (/\/(?:api\/)?v\d+(?:beta)?$/i.test(value)) return value;
  return `${value}/v1`;
}

async function createAgentModel(provider, model) {
  const apiKey = String(provider?.apiKey || '').trim();
  const baseURL = agentBaseUrl(provider);
  if (!apiKey) throw new Error('Agent Provider API key is not configured.');
  if (!model) throw new Error('Agent model is not configured.');

  const protocol = String(provider?.protocol || 'openai').toLowerCase();
  if (protocol === 'gemini') {
    const { createGoogle } = await import('@ai-sdk/google');
    return createGoogle({ apiKey, ...(baseURL ? { baseURL } : {}) })(model);
  }
  if (protocol === 'compatible') {
    const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
    return createOpenAICompatible({
      name: String(provider.id || 'forart-provider'),
      apiKey,
      baseURL,
    }).chatModel(model);
  }
  const { createOpenAI } = await import('@ai-sdk/openai');
  return createOpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) }).chat(model);
}

module.exports = { agentBaseUrl, createAgentModel };
