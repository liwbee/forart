const path = require('path');
const fs = require('fs');

function normalizeConfig(payload = {}) {
  const mode = payload.mode === 'remote' ? 'remote' : 'local';
  return {
    mode,
    localLibraryPath: String(payload.localLibraryPath || '').trim(),
    serverUrl: String(payload.serverUrl || '').trim().replace(/\/+$/, ''),
    imageDownloadPath: String(payload.imageDownloadPath || '').trim(),
    language: payload.language === 'en-US' ? 'en-US' : 'zh-CN',
  };
}

function normalizeImageReviewSettings(payload = {}) {
  return {
    modelFolders: String(payload.modelFolders || '').trim(),
    detailFolders: String(payload.detailFolders || '').trim(),
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
    protocol: input.protocol === 'async' || input.protocol === 'gemini' ? input.protocol : 'openai',
    imageModels: Array.isArray(input.imageModels) ? input.imageModels.map(String).filter(Boolean) : [],
    chatModels: Array.isArray(input.chatModels) ? input.chatModels.map(String).filter(Boolean) : [],
    videoModels: Array.isArray(input.videoModels) ? input.videoModels.map(String).filter(Boolean) : [],
    modelAliases: normalizeModelAliases(input.modelAliases),
    modelRules: normalizeModelRules(input.modelRules),
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

function normalizeRuleBucket(input = {}) {
  if (!input || typeof input !== 'object') return {};
  return Object.entries(input).reduce((result, [model, ruleId]) => {
    const modelId = String(model || '').trim();
    const value = String(ruleId || '').trim();
    if (modelId && value) result[modelId] = value;
    return result;
  }, {});
}

function normalizeModelRules(input = {}) {
  return {
    image: normalizeRuleBucket(input.image),
  };
}

function normalizeApiSettings(payload = {}) {
  const providers = Array.isArray(payload.providers)
    ? payload.providers.reduce((result, item) => {
      const provider = normalizeApiProvider(item, result);
      return result.some((current) => current.id === provider.id) ? result : [...result, provider];
    }, [])
    : [];
  const defaultImageProviderId = providers.some((provider) => provider.id === payload.defaultImageProviderId)
    ? String(payload.defaultImageProviderId)
    : '';
  return { providers, defaultImageProviderId };
}

function createConfigStore({ app, rootDir }) {
  function portableRoot() {
    return app.isPackaged ? path.dirname(app.getPath('exe')) : rootDir;
  }

  function configPath() {
    return path.join(portableRoot(), 'forart-config.json');
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
    if (!fs.existsSync(configPath())) return null;
    const config = normalizeConfig(readRaw());
    if (config.mode === 'local' && !config.localLibraryPath) return null;
    if (config.mode === 'remote' && !config.serverUrl) return null;
    return config;
  }

  function save(payload) {
    const config = normalizeConfig(payload);
    writeRaw({ ...readRaw(), ...config });
    return config;
  }

  function loadImageReviewSettings() {
    return normalizeImageReviewSettings(readRaw().imageReview || {});
  }

  function saveImageReviewSettings(payload) {
    const imageReview = normalizeImageReviewSettings(payload);
    writeRaw({ ...readRaw(), imageReview });
    return imageReview;
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

  return { getProvider, load, loadApiSettings, loadImageReviewSettings, readRaw, save, saveApiSettings, saveImageReviewSettings, writeRaw };
}

module.exports = {
  createConfigStore,
  normalizeApiSettings,
  normalizeConfig,
  normalizeImageReviewSettings,
};
