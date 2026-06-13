const path = require('path');
const fs = require('fs');

const LOVART_PROVIDER_ID = 'lovart';
const LOVART_IMAGE_MODELS = [
  'generate_image_gpt_image_2',
  'generate_image_gpt_image_2_low',
  'generate_image_gpt_image_2_medium',
  'generate_image_gpt_image_2_high',
  'generate_image_nano_banana_pro',
  'generate_image_nano_banana_2',
  'generate_image_gpt_image_1_5',
  'generate_image_seedream_v5',
  'generate_image_luma_uni_1',
  'generate_image_luma_uni_1_max',
  'generate_image_flux_2_max',
  'generate_image_flux_2_pro',
  'generate_image_seedream_v4_5',
  'generate_image_nano_banana',
  'generate_image_seedream_v4',
  'generate_image_midjourney',
  'generate_image_ideogram_v4',
];

function normalizeConfig(payload = {}) {
  const mode = payload.mode === 'remote' ? 'remote' : 'local';
  return {
    mode,
    localLibraryPath: String(payload.localLibraryPath || '').trim(),
    serverUrl: String(payload.serverUrl || '').trim().replace(/\/+$/, ''),
    accessToken: String(payload.accessToken || '').trim(),
    imageDownloadPath: String(payload.imageDownloadPath || '').trim(),
  };
}

function normalizeApiProvider(input = {}, providers = []) {
  const name = String(input.name || 'API').trim() || 'API';
  const base = (String(input.id || name || 'custom-api')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'custom-api');
  let id = String(input.id || base).trim() || base;
  let index = 2;
  while (providers.some((provider) => provider.id === id)) {
    id = `${base}-${index}`;
    index += 1;
  }
  return {
    id,
    name,
    baseUrl: String(input.baseUrl || '').trim(),
    apiKey: String(input.apiKey || ''),
    accessKey: String(input.accessKey || ''),
    secretKey: String(input.secretKey || ''),
    protocol: input.protocol === 'async' || input.protocol === 'gemini' || input.protocol === 'lovart' ? input.protocol : 'openai',
    imageModels: Array.isArray(input.imageModels) ? input.imageModels.map(String).filter(Boolean) : [],
    chatModels: Array.isArray(input.chatModels) ? input.chatModels.map(String).filter(Boolean) : [],
    videoModels: Array.isArray(input.videoModels) ? input.videoModels.map(String).filter(Boolean) : [],
    modelAliases: normalizeModelAliases(input.modelAliases),
  };
}

function createLovartProvider() {
  return {
    id: LOVART_PROVIDER_ID,
    name: 'Lovart',
    baseUrl: 'https://lgw.lovart.ai',
    apiKey: '',
    accessKey: '',
    secretKey: '',
    protocol: 'lovart',
    imageModels: LOVART_IMAGE_MODELS,
    chatModels: [],
    videoModels: [],
    modelAliases: normalizeModelAliases({}),
  };
}

function normalizeAliasBucket(input = {}) {
  if (!input || typeof input !== 'object') return {};
  return Object.entries(input).reduce((result, [model, alias]) => {
    const modelId = String(model || '').trim();
    const label = String(alias || '').trim();
    if (modelId && label) result[modelId] = label;
    return result;
  }, {});
}

function normalizeModelAliases(input = {}) {
  return {
    image: normalizeAliasBucket(input.image),
    chat: normalizeAliasBucket(input.chat),
    video: normalizeAliasBucket(input.video),
  };
}

function normalizeApiSettings(payload = {}) {
  const providers = Array.isArray(payload.providers)
    ? payload.providers.reduce((result, item) => {
      const provider = normalizeApiProvider(item, result);
      return result.some((current) => current.id === provider.id) ? result : [...result, provider];
    }, [])
    : [];
  const lovartProvider = providers.find((provider) => provider.id === LOVART_PROVIDER_ID || provider.protocol === 'lovart');
  const normalizedProviders = lovartProvider
    ? providers.map((provider) => (provider === lovartProvider
      ? normalizeApiProvider({
        ...createLovartProvider(),
        ...provider,
        id: LOVART_PROVIDER_ID,
        name: provider.name || 'Lovart',
        baseUrl: provider.baseUrl || 'https://lgw.lovart.ai',
        protocol: 'lovart',
        imageModels: provider.imageModels.length ? provider.imageModels : LOVART_IMAGE_MODELS,
      }, providers.filter((item) => item !== provider))
      : provider))
    : [createLovartProvider(), ...providers];
  const defaultImageProviderId = normalizedProviders.some((provider) => provider.id === payload.defaultImageProviderId && provider.protocol !== 'lovart')
    ? String(payload.defaultImageProviderId)
    : '';
  return { providers: normalizedProviders, defaultImageProviderId };
}

function createConfigStore({ app }) {
  function configPath() {
    return path.join(app.getPath('userData'), 'forart-config.json');
  }

  function readRaw() {
    try {
      return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    } catch {
      return {};
    }
  }

  function writeRaw(payload) {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), `${JSON.stringify(payload || {}, null, 2)}\n`, 'utf8');
  }

  function load() {
    return normalizeConfig(readRaw());
  }

  function save(payload) {
    const config = normalizeConfig(payload);
    writeRaw({ ...readRaw(), ...config });
    return config;
  }

  function loadApiSettings() {
    return normalizeApiSettings(readRaw().apiSettings || {});
  }

  function saveApiSettings(payload) {
    const apiSettings = normalizeApiSettings(payload);
    writeRaw({ ...readRaw(), apiSettings });
    return apiSettings;
  }

  function getProvider(providerId) {
    const settings = loadApiSettings();
    return settings.providers.find((provider) => provider.id === providerId) || null;
  }

  return { getProvider, load, loadApiSettings, readRaw, save, saveApiSettings, writeRaw };
}

module.exports = {
  LOVART_PROVIDER_ID,
  LOVART_IMAGE_MODELS,
  createConfigStore,
  createLovartProvider,
  normalizeApiSettings,
  normalizeConfig,
};
