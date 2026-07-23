const path = require('path');
const fs = require('fs');
const { normalizeLibtvMachineId } = require('./libtv-workspace.cjs');

const APIMART_PROVIDER_ID = 'apimart';
const APIMART_BASE_URLS = [
  'https://api.apimart.ai/v1',
  'https://api.apib.ai/v1',
  'https://api.aiuxu.com/v1',
  'https://api.aishuch.com/v1',
];
const APIMART_HOST_TO_BASE_URL = new Map(APIMART_BASE_URLS.map((baseUrl) => [new URL(baseUrl).host, baseUrl]));

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

function normalizeInfiniteCanvasSettings(payload = {}) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const viewerCandidate = source.referenceComparisonViewer || source.actionFissionViewer;
  const viewerSource = viewerCandidate && typeof viewerCandidate === 'object'
    ? viewerCandidate
    : {};
  const rawPercent = viewerSource.referencePanelPercent;
  const requestedPercent = rawPercent === undefined || rawPercent === null || rawPercent === ''
    ? Number.NaN
    : Number(rawPercent);
  return {
    connectionsVisible: source.connectionsVisible !== false,
    minimapOpen: source.minimapOpen === true,
    snapToGrid: source.snapToGrid === true,
    referenceComparisonViewer: {
      referenceComparisonEnabled: viewerSource.referenceComparisonEnabled === true,
      referencePanelPercent: Number.isFinite(requestedPercent)
        ? Math.max(20, Math.min(80, Math.round(requestedPercent)))
        : 50,
    },
  };
}

function normalizeApiProvider(input = {}, providers = []) {
  if (isApimartProvider(input)) return createApimartProvider(input);
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
    protocol: input.protocol === 'compatible' || input.protocol === 'gemini' ? input.protocol : 'openai',
    imageRequestMode: input.imageRequestMode === 'openai-json' ? 'openai-json' : 'openai',
    imageGenerationEndpoint: String(input.imageGenerationEndpoint || '').trim(),
    imageEditEndpoint: String(input.imageEditEndpoint || '').trim(),
    imageModels: Array.isArray(input.imageModels) ? input.imageModels.map(String).filter(Boolean) : [],
    chatModels: Array.isArray(input.chatModels) ? input.chatModels.map(String).filter(Boolean) : [],
    videoModels: Array.isArray(input.videoModels) ? input.videoModels.map(String).filter(Boolean) : [],
    modelAliases: normalizeModelAliases(input.modelAliases),
    modelRules: normalizeModelRules(input.modelRules),
  };
}

function getApimartBaseUrl(value) {
  try {
    return APIMART_HOST_TO_BASE_URL.get(new URL(String(value || '').trim()).host.toLowerCase()) || '';
  } catch {
    return '';
  }
}

function isApimartProvider(input = {}) {
  return String(input.id || '').trim().toLowerCase() === APIMART_PROVIDER_ID
    || String(input.name || '').trim().toLowerCase() === APIMART_PROVIDER_ID
    || Boolean(getApimartBaseUrl(input.baseUrl));
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

function createApimartProvider(input = {}) {
  return {
    id: APIMART_PROVIDER_ID,
    name: 'APImart',
    baseUrl: getApimartBaseUrl(input.baseUrl) || APIMART_BASE_URLS[0],
    apiKey: String(input.apiKey || ''),
    accessKey: '',
    secretKey: '',
    protocol: 'compatible',
    imageRequestMode: 'openai',
    imageGenerationEndpoint: '',
    imageEditEndpoint: '',
    imageModels: Array.isArray(input.imageModels) ? uniqueStrings(input.imageModels) : [],
    chatModels: Array.isArray(input.chatModels) ? uniqueStrings(input.chatModels) : [],
    videoModels: Array.isArray(input.videoModels) ? uniqueStrings(input.videoModels) : [],
    modelAliases: normalizeModelAliases(input.modelAliases),
    modelRules: normalizeModelRules(input.modelRules),
  };
}

function mergeApimartProviders(inputs = []) {
  return inputs.reduce((result, input) => {
    const next = createApimartProvider(input);
    return createApimartProvider({
      ...result,
      baseUrl: getApimartBaseUrl(input.baseUrl) || result.baseUrl,
      apiKey: next.apiKey || result.apiKey,
      imageModels: uniqueStrings([...result.imageModels, ...next.imageModels]),
      chatModels: uniqueStrings([...result.chatModels, ...next.chatModels]),
      videoModels: uniqueStrings([...result.videoModels, ...next.videoModels]),
      modelAliases: {
        image: { ...result.modelAliases.image, ...next.modelAliases.image },
        chat: { ...result.modelAliases.chat, ...next.modelAliases.chat },
        video: { ...result.modelAliases.video, ...next.modelAliases.video },
      },
      modelRules: { image: { ...result.modelRules.image, ...next.modelRules.image } },
    });
  }, createApimartProvider());
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
  const rawProviders = Array.isArray(payload.providers) ? payload.providers : [];
  const apimartInputs = rawProviders.filter(isApimartProvider);
  const apimartSourceIds = new Set(apimartInputs.map((provider) => String(provider.id || '').trim()).filter(Boolean));
  const customProviders = rawProviders
    .filter((provider) => !isApimartProvider(provider))
    .reduce((result, item) => {
      const provider = normalizeApiProvider(item, result);
      return result.some((current) => current.id === provider.id) ? result : [...result, provider];
    }, []);
  const providers = [mergeApimartProviders(apimartInputs), ...customProviders];
  const requestedDefaultProviderId = apimartSourceIds.has(String(payload.defaultImageProviderId || ''))
    ? APIMART_PROVIDER_ID
    : String(payload.defaultImageProviderId || '');
  const defaultImageProviderId = providers.some((provider) => provider.id === requestedDefaultProviderId)
    ? requestedDefaultProviderId
    : '';
  const validOrderIds = new Set(['libtv', ...providers.map((provider) => provider.id)]);
  const providerOrder = Array.isArray(payload.providerOrder)
    ? [...new Set(payload.providerOrder.map((id) => apimartSourceIds.has(String(id)) ? APIMART_PROVIDER_ID : String(id)))].filter((id) => validOrderIds.has(id))
    : [];
  providers.forEach((provider) => {
    if (!providerOrder.includes(provider.id)) providerOrder.push(provider.id);
  });
  if (!providerOrder.includes('libtv')) providerOrder.unshift('libtv');
  const requestedLibtvConcurrency = Number(payload.libtvActionFissionConcurrency);
  return {
    providers,
    defaultImageProviderId,
    providerOrder,
    libtvMachineId: normalizeLibtvMachineId(payload.libtvMachineId),
    libtvActionFissionConcurrency: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].includes(requestedLibtvConcurrency)
      ? requestedLibtvConcurrency
      : 1,
  };
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
    const targetPath = configPath();
    const targetDir = path.dirname(targetPath);
    const temporaryPath = path.join(targetDir, `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`);
    fs.mkdirSync(targetDir, { recursive: true });
    try {
      fs.writeFileSync(temporaryPath, `${JSON.stringify(payload || {}, null, 2)}\n`, 'utf8');
      fs.renameSync(temporaryPath, targetPath);
    } catch (error) {
      try {
        fs.rmSync(temporaryPath, { force: true });
      } catch {}
      throw error;
    }
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

  function loadInfiniteCanvasSettings() {
    return normalizeInfiniteCanvasSettings(readRaw().infiniteCanvas || {});
  }

  function saveInfiniteCanvasSettings(payload) {
    const infiniteCanvas = normalizeInfiniteCanvasSettings(payload);
    writeRaw({ ...readRaw(), infiniteCanvas });
    return infiniteCanvas;
  }

  function loadApiSettings() {
    return normalizeApiSettings(readRaw().apiSettings || {});
  }

  function saveApiSettings(payload) {
    const apiSettings = normalizeApiSettings(payload);
    writeRaw({ ...readRaw(), apiSettings });
    return apiSettings;
  }

  return {
    load,
    loadApiSettings,
    loadImageReviewSettings,
    loadInfiniteCanvasSettings,
    save,
    saveApiSettings,
    saveImageReviewSettings,
    saveInfiniteCanvasSettings,
  };
}

module.exports = {
  createConfigStore,
};
