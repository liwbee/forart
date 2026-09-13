const path = require('path');
const fs = require('fs');
const { normalizeLibtvMachineId } = require('./libtv-workspace.cjs');

const APIMART_PROVIDER_ID = 'apimart';
const TUDOU_PROVIDER_ID = 'tudou-api';
const TUDOU_BASE_URL = 'https://api.ai-tudou.net/v1';
const TUDOU_IMAGE_MODELS = [
  'gpt-image-2-1k',
  'gpt-image-2-2k',
  'gpt-image-2-4k',
  'gemini-3.1-flash-image-preview',
  'gemini-3-pro-image-preview',
  'grok-imagine-image',
  'grok-imagine-image-pro',
  'grok-imagine-image-edit',
];
const TASK_HISTORY_RETENTION_DAY_OPTIONS = Object.freeze([1, 3, 7, 15, 30]);
const DEFAULT_TASK_HISTORY_RETENTION_DAYS = 15;
const APIMART_BASE_URLS = [
  'https://api.apimart.ai/v1',
  'https://api.apib.ai/v1',
  'https://api.aiuxu.com/v1',
  'https://api.aishuch.com/v1',
];

function normalizeConfig(payload = {}) {
  const mode = payload.mode === 'remote' ? 'remote' : 'local';
  const requestedTaskHistoryRetentionDays = Number(payload.taskHistoryRetentionDays);
  return {
    mode,
    localLibraryPath: String(payload.localLibraryPath || '').trim(),
    serverUrl: String(payload.serverUrl || '').trim().replace(/\/+$/, ''),
    serverAuthUsername: String(payload.serverAuthUsername || '').trim(),
    serverAuthToken: String(payload.serverAuthToken || '').trim(),
    imageDownloadPath: String(payload.imageDownloadPath || '').trim(),
    photoshopExecutablePath: String(payload.photoshopExecutablePath || '').trim(),
    taskHistoryRetentionDays: TASK_HISTORY_RETENTION_DAY_OPTIONS.includes(requestedTaskHistoryRetentionDays)
      ? requestedTaskHistoryRetentionDays
      : DEFAULT_TASK_HISTORY_RETENTION_DAYS,
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
    promptEditorsExpanded: source.promptEditorsExpanded === true,
    referenceComparisonViewer: {
      referenceComparisonEnabled: viewerSource.referenceComparisonEnabled === true,
      referencePanelPercent: Number.isFinite(requestedPercent)
        ? Math.max(20, Math.min(80, Math.round(requestedPercent)))
        : 50,
    },
  };
}

function normalizeAgentModelRoute(value) {
  if (!value || typeof value !== 'object') return null;
  const providerId = String(value.providerId || '').trim();
  const model = String(value.model || '').trim();
  return providerId && model ? { providerId, model } : null;
}

function normalizeAgentSettings(payload = {}) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const reasoningLevel = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(source.reasoningLevel)
    ? source.reasoningLevel
    : 'medium';
  return {
    backgroundRemovalEnabled: source.backgroundRemovalEnabled === true,
    promptOptimizationEnabled: source.promptOptimizationEnabled === true,
    thinkingMode: source.thinkingMode === true || source.thinkingEnabled === true,
    reasoningLevel,
    imageGeneratorPromptOptimization: normalizeAgentModelRoute(
      source.imageGeneratorPromptOptimization || source.promptOptimization || source.optimizationModel,
    ),
  };
}

// Extension settings are persisted under the historical agentSettings key for backwards compatibility.
const normalizeExtensionSettings = normalizeAgentSettings;

function normalizeApiProvider(input = {}, providers = []) {
  if (isApimartProvider(input)) return createApimartProvider(input);
  if (isTudouProvider(input)) return createTudouProvider(input);
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
    protocol: input.protocol === 'gemini'
      ? 'gemini'
      : input.protocol === 'apimart' || input.protocol === 'compatible'
        ? 'apimart'
        : 'openai',
    imageGenerationEndpoint: String(input.imageGenerationEndpoint || '').trim(),
    imageEditEndpoint: String(input.imageEditEndpoint || '').trim(),
    imageModels: Array.isArray(input.imageModels) ? uniqueStrings(input.imageModels) : [],
    chatModels: Array.isArray(input.chatModels) ? uniqueStrings(input.chatModels) : [],
    videoModels: Array.isArray(input.videoModels) ? uniqueStrings(input.videoModels) : [],
    modelAliases: normalizeModelAliases(input.modelAliases),
    modelRules: normalizeModelRules(input.modelRules),
    hasApiKey: Boolean(input.hasApiKey || String(input.apiKey || '').trim()),
  };
}

function isApimartProvider(input = {}) {
  return String(input.id || '').trim().toLowerCase() === APIMART_PROVIDER_ID;
}

function isTudouProvider(input = {}) {
  return String(input.id || '').trim().toLowerCase() === TUDOU_PROVIDER_ID;
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

function normalizeModelCatalogOrder(input = {}) {
  const requested = input && Array.isArray(input.image) ? uniqueStrings(input.image) : [];
  return {
    image: [...requested, ...TUDOU_IMAGE_MODELS.filter((model) => !requested.includes(model))],
  };
}

function createApimartProvider(input = {}) {
  return {
    id: APIMART_PROVIDER_ID,
    name: 'APImart',
    baseUrl: String(input.baseUrl || '').trim() || APIMART_BASE_URLS[0],
    apiKey: String(input.apiKey || ''),
    accessKey: '',
    secretKey: '',
    protocol: 'apimart',
    imageGenerationEndpoint: '',
    imageEditEndpoint: '',
    imageModels: Array.isArray(input.imageModels) ? uniqueStrings(input.imageModels) : [],
    chatModels: Array.isArray(input.chatModels) ? uniqueStrings(input.chatModels) : [],
    videoModels: Array.isArray(input.videoModels) ? uniqueStrings(input.videoModels) : [],
    modelAliases: normalizeModelAliases(input.modelAliases),
    modelRules: normalizeModelRules(input.modelRules),
    hasApiKey: Boolean(input.hasApiKey || String(input.apiKey || '').trim()),
  };
}

function mergeApimartProviders(inputs = []) {
  return inputs.reduce((result, input) => {
    const next = createApimartProvider(input);
    return createApimartProvider({
      ...result,
      baseUrl: next.baseUrl || result.baseUrl,
      apiKey: next.apiKey || result.apiKey,
      hasApiKey: result.hasApiKey || next.hasApiKey,
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

function mergeTudouProviders(inputs = []) {
  return inputs.reduce((result, input) => {
    const next = createTudouProvider(input);
    return createTudouProvider({
      ...result,
      apiKey: next.apiKey || result.apiKey,
      hasApiKey: result.hasApiKey || next.hasApiKey,
      imageModels: uniqueStrings([...result.imageModels, ...next.imageModels]),
      chatModels: uniqueStrings([...result.chatModels, ...next.chatModels]),
      videoModels: uniqueStrings([...result.videoModels, ...next.videoModels]),
      modelAliases: {
        image: { ...result.modelAliases.image, ...next.modelAliases.image },
        chat: { ...result.modelAliases.chat, ...next.modelAliases.chat },
        video: { ...result.modelAliases.video, ...next.modelAliases.video },
      },
      modelRules: { image: { ...result.modelRules.image, ...next.modelRules.image } },
      modelCatalogOrder: next.modelCatalogOrder,
    });
  }, createTudouProvider());
}

function normalizeAliasBucket(input = {}) {
  if (!input || typeof input !== 'object') return {};
  return Object.entries(input).reduce((result, [model, alias]) => {
    const modelId = String(model || '').trim();
    if (modelId && typeof alias === 'string') result[modelId] = alias;
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
    const rawValue = String(ruleId || '').trim();
    const value = ['gpt-image-2', 'gpt-image-2-official', 'gpt-image-1'].includes(rawValue)
      ? 'gpt-image'
      : rawValue === 'gemini-3-pro'
        ? 'gemini-image'
        : ['gemini-3.1-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash'].includes(rawValue)
          ? 'gemini-lite-image'
          : ['seedream', 'seedream-4', 'seedream-4.5', 'z-image-turbo'].includes(rawValue)
            ? 'generic-image'
            : rawValue;
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
  const tudouInputs = rawProviders.filter(isTudouProvider);
  const apimartSourceIds = new Set(apimartInputs.map((provider) => String(provider.id || '').trim()).filter(Boolean));
  const tudouSourceIds = new Set(tudouInputs.map((provider) => String(provider.id || '').trim()).filter(Boolean));
  const customProviders = rawProviders
    .filter((provider) => !isApimartProvider(provider) && !isTudouProvider(provider))
    .reduce((result, item) => {
      const provider = normalizeApiProvider(item, result);
      return result.some((current) => current.id === provider.id) ? result : [...result, provider];
    }, []);
  const providers = [
    ...(apimartInputs.length ? [mergeApimartProviders(apimartInputs)] : []),
    ...(tudouInputs.length ? [mergeTudouProviders(tudouInputs)] : []),
    ...customProviders,
  ];
  const rawDefaultProviderId = String(payload.defaultImageProviderId || '');
  const requestedDefaultProviderId = apimartSourceIds.has(rawDefaultProviderId)
    ? APIMART_PROVIDER_ID
    : tudouSourceIds.has(rawDefaultProviderId) ? TUDOU_PROVIDER_ID : rawDefaultProviderId;
  const defaultImageProviderId = providers.some((provider) => provider.id === requestedDefaultProviderId)
    ? requestedDefaultProviderId
    : '';
  const validOrderIds = new Set(['libtv', ...providers.map((provider) => provider.id)]);
  const providerOrder = Array.isArray(payload.providerOrder)
    ? [...new Set(payload.providerOrder.map((id) => {
      const value = String(id);
      return apimartSourceIds.has(value) ? APIMART_PROVIDER_ID : tudouSourceIds.has(value) ? TUDOU_PROVIDER_ID : value;
    }))].filter((id) => validOrderIds.has(id))
    : [];
  providers.forEach((provider) => {
    if (!providerOrder.includes(provider.id)) providerOrder.push(provider.id);
  });
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

function createTudouProvider(input = {}) {
  const catalogOrder = normalizeModelCatalogOrder({
    image: [
      ...(input.modelCatalogOrder && Array.isArray(input.modelCatalogOrder.image) ? input.modelCatalogOrder.image : []),
      ...(Array.isArray(input.imageModels) ? input.imageModels : []),
    ],
  });
  const enabledImageModels = new Set(Array.isArray(input.imageModels) ? input.imageModels.map(String) : []);
  return {
    id: TUDOU_PROVIDER_ID,
    name: '土豆API',
    baseUrl: TUDOU_BASE_URL,
    apiKey: String(input.apiKey || ''),
    accessKey: '',
    secretKey: '',
    protocol: 'gemini',
    imageGenerationEndpoint: '',
    imageEditEndpoint: '',
    imageModels: catalogOrder.image.filter((model) => enabledImageModels.has(model)),
    chatModels: Array.isArray(input.chatModels) ? uniqueStrings(input.chatModels) : [],
    videoModels: Array.isArray(input.videoModels) ? uniqueStrings(input.videoModels) : [],
    modelAliases: normalizeModelAliases(input.modelAliases),
    modelRules: normalizeModelRules(input.modelRules),
    modelCatalogOrder: catalogOrder,
    hasApiKey: Boolean(input.hasApiKey || String(input.apiKey || '').trim()),
  };
}

function createConfigStore({ app, rootDir, safeStorage }) {
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

  function readServerAuthToken(raw) {
    const encrypted = String(raw?.serverAuthTokenEncrypted || '').trim();
    if (encrypted && safeStorage?.isEncryptionAvailable?.()) {
      try {
        return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
      } catch {}
    }
    return String(raw?.serverAuthToken || '').trim();
  }

  function persistedConfig(raw, config) {
    const next = { ...raw, ...config };
    delete next.serverAuthToken;
    delete next.serverAuthTokenEncrypted;
    if (config.serverAuthToken) {
      if (safeStorage?.isEncryptionAvailable?.()) {
        next.serverAuthTokenEncrypted = safeStorage.encryptString(config.serverAuthToken).toString('base64');
      } else {
        next.serverAuthToken = config.serverAuthToken;
      }
    }
    return next;
  }

  function load() {
    if (!fs.existsSync(configPath())) return null;
    const raw = readRaw();
    const config = normalizeConfig({ ...raw, serverAuthToken: readServerAuthToken(raw) });
    if (config.mode === 'local' && !config.localLibraryPath) return null;
    if (config.mode === 'remote' && !config.serverUrl) return null;
    return config;
  }

  function save(payload) {
    const config = normalizeConfig(payload);
    writeRaw(persistedConfig(readRaw(), config));
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

  function loadAgentSettings() {
    return normalizeAgentSettings(readRaw().agentSettings || {});
  }

  function saveAgentSettings(payload) {
    const agentSettings = normalizeAgentSettings(payload);
    writeRaw({ ...readRaw(), agentSettings });
    return agentSettings;
  }

  function loadExtensionSettings() {
    return loadAgentSettings();
  }

  function saveExtensionSettings(payload) {
    return saveAgentSettings(payload);
  }

  function encryptionAvailable() {
    return Boolean(safeStorage?.isEncryptionAvailable?.());
  }

  function decryptApiSecrets(raw = {}) {
    const encrypted = raw && raw.apiSecrets && typeof raw.apiSecrets === 'object'
      ? raw.apiSecrets
      : {};
    return Object.entries(encrypted).reduce((result, [providerId, value]) => {
      const id = String(providerId || '').trim();
      const encoded = String(value || '').trim();
      if (!id || !encoded || !encryptionAvailable()) return result;
      try {
        const decrypted = safeStorage.decryptString(Buffer.from(encoded, 'base64'));
        try {
          const parsed = JSON.parse(decrypted);
          result[id] = parsed && typeof parsed === 'object' ? parsed : { apiKey: decrypted };
        } catch {
          // Support the first migration format, which encrypted only the API key string.
          result[id] = { apiKey: decrypted };
        }
      } catch {
        // An unreadable secret is treated as missing; it is never exposed to Renderer.
      }
      return result;
    }, {});
  }

  function encryptApiSecrets(secrets = {}) {
    if (!encryptionAvailable()) throw new Error('Secure API key storage is unavailable.');
    return Object.entries(secrets).reduce((result, [providerId, value]) => {
      const id = String(providerId || '').trim();
      const secret = value && typeof value === 'object' ? value : { apiKey: String(value || '') };
      if (id && Object.values(secret).some((item) => String(item || ''))) {
        result[id] = safeStorage.encryptString(JSON.stringify(secret)).toString('base64');
      }
      return result;
    }, {});
  }

  function migrateLegacyApiSecrets(raw = {}) {
    const legacyProviders = Array.isArray(raw?.apiSettings?.providers)
      ? raw.apiSettings.providers
      : [];
    const legacy = legacyProviders.reduce((result, provider) => {
      const id = String(provider?.id || '').trim();
      const apiKey = String(provider?.apiKey || '');
      if (id && (apiKey || provider?.accessKey || provider?.secretKey)) {
        result[id] = {
          apiKey,
          accessKey: String(provider?.accessKey || ''),
          secretKey: String(provider?.secretKey || ''),
        };
      }
      return result;
    }, {});
    if (!Object.keys(legacy).length) return { raw, secrets: decryptApiSecrets(raw) };
    if (!encryptionAvailable()) return { raw, secrets: { ...decryptApiSecrets(raw), ...legacy } };

    const secrets = { ...decryptApiSecrets(raw), ...legacy };
    const providers = legacyProviders.map((provider) => {
      const next = { ...provider };
      delete next.apiKey;
      delete next.accessKey;
      delete next.secretKey;
      return next;
    });
    const nextRaw = {
      ...raw,
      apiSettings: { ...(raw.apiSettings || {}), providers },
      apiSecrets: encryptApiSecrets(secrets),
    };
    writeRaw(nextRaw);
    return { raw: nextRaw, secrets };
  }

  function loadApiSecretState() {
    return migrateLegacyApiSecrets(readRaw());
  }

  function withApiSecrets(apiSettings, secrets) {
    return {
      ...apiSettings,
      providers: apiSettings.providers.map((provider) => {
        const secret = secrets[provider.id] && typeof secrets[provider.id] === 'object' ? secrets[provider.id] : {};
        const apiKey = String(secret.apiKey || provider.apiKey || '');
        return { ...provider, apiKey, hasApiKey: Boolean(apiKey) };
      }),
    };
  }

  function publicApiSettings(apiSettings) {
    return {
      ...apiSettings,
      providers: apiSettings.providers.map((provider) => ({
        ...provider,
        apiKey: '',
        accessKey: '',
        secretKey: '',
        hasApiKey: Boolean(provider.hasApiKey || String(provider.apiKey || '').trim()),
      })),
    };
  }

  function loadApiSettings() {
    const { raw, secrets } = loadApiSecretState();
    return withApiSecrets(normalizeApiSettings(raw.apiSettings || {}), secrets);
  }

  function loadPublicApiSettings() {
    return publicApiSettings(loadApiSettings());
  }

  function getApiProvider(providerId) {
    const id = String(providerId || '').trim();
    if (!id) return null;
    return loadApiSettings().providers.find((provider) => provider.id === id) || null;
  }

  function saveApiSettings(payload) {
    const currentState = loadApiSecretState();
    const currentSettings = normalizeApiSettings(currentState.raw.apiSettings || {});
    const currentSecrets = { ...currentState.secrets };
    const inputProviders = Array.isArray(payload?.providers) ? payload.providers : [];
    const apiSettings = normalizeApiSettings(payload);
    const inputById = new Map(inputProviders.map((provider) => [String(provider?.id || '').trim(), provider]));
    apiSettings.providers.forEach((provider) => {
      const input = inputById.get(provider.id) || {};
      const nextApiKey = String(input.apiKey || '').trim();
      const existingSecret = currentSecrets[provider.id] && typeof currentSecrets[provider.id] === 'object'
        ? currentSecrets[provider.id]
        : {};
      if (nextApiKey) currentSecrets[provider.id] = { ...existingSecret, apiKey: nextApiKey };
      if (input.clearApiKey === true) delete currentSecrets[provider.id];
    });
    const validProviderIds = new Set(apiSettings.providers.map((provider) => provider.id));
    Object.keys(currentSecrets).forEach((providerId) => {
      if (!validProviderIds.has(providerId)) delete currentSecrets[providerId];
    });

    const hasSecretChanges = apiSettings.providers.some((provider) => {
      const previous = currentSettings.providers.find((item) => item.id === provider.id);
      const input = inputById.get(provider.id) || {};
      return Boolean(String(input.apiKey || '').trim() || input.clearApiKey === true)
        || Boolean(previous?.apiKey && !currentSecrets[provider.id]);
    });
    if (hasSecretChanges && !encryptionAvailable()) {
      throw new Error('Secure API key storage is unavailable.');
    }

    const persistedProviders = apiSettings.providers.map((provider) => ({
      ...provider,
      apiKey: '',
      accessKey: '',
      secretKey: '',
      hasApiKey: Boolean(String(currentSecrets[provider.id]?.apiKey || '').trim()),
    }));
    const encryptedSecrets = encryptionAvailable()
      ? encryptApiSecrets(currentSecrets)
      : (currentState.raw.apiSecrets && typeof currentState.raw.apiSecrets === 'object' ? currentState.raw.apiSecrets : {});
    writeRaw({
      ...currentState.raw,
      apiSettings: { ...apiSettings, providers: persistedProviders },
      apiSecrets: encryptedSecrets,
    });
    return publicApiSettings(withApiSecrets(apiSettings, currentSecrets));
  }

  return {
    load,
    loadApiSettings,
    loadPublicApiSettings,
    getApiProvider,
    loadAgentSettings,
    loadExtensionSettings,
    loadImageReviewSettings,
    loadInfiniteCanvasSettings,
    save,
    saveApiSettings,
    saveAgentSettings,
    saveExtensionSettings,
    saveImageReviewSettings,
    saveInfiniteCanvasSettings,
  };
}

module.exports = {
  DEFAULT_TASK_HISTORY_RETENTION_DAYS,
  TASK_HISTORY_RETENTION_DAY_OPTIONS,
  createConfigStore,
  TUDOU_IMAGE_MODELS,
};
