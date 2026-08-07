type ApiProviderProtocol = "openai" | "compatible" | "gemini";
type ApiProviderImageRequestMode = "openai" | "openai-json";
export type ApiModelKind = "image" | "chat" | "video";
type ApiProviderOrderItem =
  | { type: "provider"; id: string; provider: ApiProvider }
  | { type: "apimart"; id: "apimart"; provider: ApiProvider }
  | { type: "tudou"; id: "tudou-api"; provider: ApiProvider }
  | { type: "libtv"; id: "libtv" };

interface ApiModelAliases {
  image: Record<string, string>;
  chat: Record<string, string>;
  video: Record<string, string>;
}

interface ApiModelRules {
  image: Record<string, string>;
}

interface ApiModelCatalogOrder {
  image: string[];
}

export interface ApiProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  accessKey: string;
  secretKey: string;
  protocol: ApiProviderProtocol;
  imageRequestMode: ApiProviderImageRequestMode;
  imageGenerationEndpoint: string;
  imageEditEndpoint: string;
  imageModels: string[];
  chatModels: string[];
  videoModels: string[];
  modelAliases: ApiModelAliases;
  modelRules: ApiModelRules;
  modelCatalogOrder?: ApiModelCatalogOrder;
}

export const API_PROVIDER_CHANGED_EVENT = "forart-api-providers-changed";
export const APIMART_PROVIDER_ID = "apimart";
export const TUDOU_PROVIDER_ID = "tudou-api";
export const TUDOU_BASE_URL = "https://api.ai-tudou.net/v1";
export const TUDOU_IMAGE_MODELS = [
  "gpt-image-2-1k",
  "gpt-image-2-2k",
  "gpt-image-2-4k",
  "gemini-3.1-flash-image-preview",
  "gemini-3-pro-image-preview",
  "grok-imagine-image",
  "grok-imagine-image-pro",
  "grok-imagine-image-edit",
] as const;
export const APIMART_BASE_URLS = [
  "https://api.apimart.ai/v1",
  "https://api.apib.ai/v1",
  "https://api.aiuxu.com/v1",
  "https://api.aishuch.com/v1",
] as const;

export type LibtvActionFissionConcurrency = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

const APIMART_HOST_TO_BASE_URL = new Map(APIMART_BASE_URLS.map((baseUrl) => [new URL(baseUrl).host, baseUrl]));

export interface ApiSettings {
  providers: ApiProvider[];
  defaultImageProviderId?: string;
  providerOrder?: string[];
  libtvMachineId?: string;
  libtvActionFissionConcurrency?: LibtvActionFissionConcurrency;
}

let apiSettingsCache: ApiSettings = {
  providers: [],
  defaultImageProviderId: "",
  providerOrder: [],
  libtvMachineId: "",
  libtvActionFissionConcurrency: 1,
};
let apiSettingsCacheLoaded = false;

function notifyApiProvidersChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(API_PROVIDER_CHANGED_EVENT));
}

export function uniqueModels(values: string[]) {
  const seen = new Set<string>();
  return values
    .map((value) => value.trim())
    .filter((value) => value && !seen.has(value) && seen.add(value));
}

function emptyModelAliases(): ApiModelAliases {
  return { image: {}, chat: {}, video: {} };
}

function emptyModelRules(): ApiModelRules {
  return { image: {} };
}

function normalizeTudouImageModelOrder(values: unknown) {
  const allowed = new Set<string>(TUDOU_IMAGE_MODELS);
  const requested = Array.isArray(values) ? uniqueModels(values.map(String)).filter((model) => allowed.has(model)) : [];
  return [...requested, ...TUDOU_IMAGE_MODELS.filter((model) => !requested.includes(model))];
}

function normalizeAliasBucket(input: unknown) {
  if (!input || typeof input !== "object") return {};
  return Object.entries(input as Record<string, unknown>).reduce<Record<string, string>>((result, [model, alias]) => {
    const modelId = String(model || "").trim();
    if (modelId && typeof alias === "string") result[modelId] = alias;
    return result;
  }, {});
}

function normalizeModelAliases(input: unknown): ApiModelAliases {
  const record = input && typeof input === "object" ? input as Partial<ApiModelAliases> : {};
  return {
    image: normalizeAliasBucket(record.image),
    chat: normalizeAliasBucket(record.chat),
    video: normalizeAliasBucket(record.video),
  };
}

function normalizeRuleBucket(input: unknown) {
  if (!input || typeof input !== "object") return {};
  return Object.entries(input as Record<string, unknown>).reduce<Record<string, string>>((result, [model, ruleId]) => {
    const modelId = String(model || "").trim();
    const value = String(ruleId || "").trim();
    if (modelId && value) result[modelId] = value;
    return result;
  }, {});
}

function normalizeModelRules(input: unknown): ApiModelRules {
  const record = input && typeof input === "object" ? input as Partial<ApiModelRules> : {};
  return {
    image: normalizeRuleBucket(record.image),
  };
}

export function getModelDisplayName(provider: ApiProvider | null | undefined, kind: ApiModelKind, model: string) {
  const alias = provider?.modelAliases?.[kind]?.[model]?.trim();
  return alias || model;
}

function createProviderId(name: string, providers: ApiProvider[]) {
  const base = (name || "custom-api")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "custom-api";
  let candidate = base;
  let index = 2;
  while (providers.some((provider) => provider.id === candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  return candidate;
}

export function createApiProvider(providers: ApiProvider[]): ApiProvider {
  const id = createProviderId("custom-api", providers);
  return {
    id,
    name: "API",
    baseUrl: "",
    apiKey: "",
    accessKey: "",
    secretKey: "",
    protocol: "openai",
    imageRequestMode: "openai",
    imageGenerationEndpoint: "",
    imageEditEndpoint: "",
    imageModels: [],
    chatModels: [],
    videoModels: [],
    modelAliases: emptyModelAliases(),
    modelRules: emptyModelRules(),
  };
}

function getApimartBaseUrl(value: unknown) {
  try {
    return APIMART_HOST_TO_BASE_URL.get(new URL(String(value || "").trim()).host.toLowerCase()) || "";
  } catch {
    return "";
  }
}

function isApimartProvider(input: Partial<ApiProvider>) {
  return String(input.id || "").trim().toLowerCase() === APIMART_PROVIDER_ID
    || String(input.name || "").trim().toLowerCase() === APIMART_PROVIDER_ID
    || Boolean(getApimartBaseUrl(input.baseUrl));
}

export function createApimartProvider(input: Partial<ApiProvider> = {}): ApiProvider {
  return {
    id: APIMART_PROVIDER_ID,
    name: "APImart",
    baseUrl: getApimartBaseUrl(input.baseUrl) || APIMART_BASE_URLS[0],
    apiKey: String(input.apiKey || ""),
    accessKey: "",
    secretKey: "",
    protocol: "compatible",
    imageRequestMode: "openai",
    imageGenerationEndpoint: "",
    imageEditEndpoint: "",
    imageModels: Array.isArray(input.imageModels) ? uniqueModels(input.imageModels.map(String)) : [],
    chatModels: Array.isArray(input.chatModels) ? uniqueModels(input.chatModels.map(String)) : [],
    videoModels: Array.isArray(input.videoModels) ? uniqueModels(input.videoModels.map(String)) : [],
    modelAliases: normalizeModelAliases(input.modelAliases),
    modelRules: normalizeModelRules(input.modelRules),
  };
}

function mergeApimartProviders(inputs: Partial<ApiProvider>[]) {
  return inputs.reduce<ApiProvider>((result, input) => {
    const next = createApimartProvider(input);
    return createApimartProvider({
      ...result,
      baseUrl: getApimartBaseUrl(input.baseUrl) || result.baseUrl,
      apiKey: next.apiKey || result.apiKey,
      imageModels: uniqueModels([...result.imageModels, ...next.imageModels]),
      chatModels: uniqueModels([...result.chatModels, ...next.chatModels]),
      videoModels: uniqueModels([...result.videoModels, ...next.videoModels]),
      modelAliases: {
        image: { ...result.modelAliases.image, ...next.modelAliases.image },
        chat: { ...result.modelAliases.chat, ...next.modelAliases.chat },
        video: { ...result.modelAliases.video, ...next.modelAliases.video },
      },
      modelRules: { image: { ...result.modelRules.image, ...next.modelRules.image } },
    });
  }, createApimartProvider());
}

function isTudouProvider(input: Partial<ApiProvider>) {
  let host = "";
  try { host = new URL(String(input.baseUrl || "").trim()).host.toLowerCase(); } catch { /* invalid custom URL */ }
  return String(input.id || "").trim().toLowerCase() === TUDOU_PROVIDER_ID
    || String(input.name || "").trim().toLowerCase() === "土豆api"
    || host === new URL(TUDOU_BASE_URL).host;
}

export function createTudouProvider(input: Partial<ApiProvider> = {}): ApiProvider {
  const imageModelOrder = normalizeTudouImageModelOrder([
    ...(input.modelCatalogOrder?.image || []),
    ...(input.imageModels || []),
  ]);
  const enabledImageModels = new Set(Array.isArray(input.imageModels) ? input.imageModels.map(String) : []);
  return {
    id: TUDOU_PROVIDER_ID,
    name: "土豆API",
    baseUrl: TUDOU_BASE_URL,
    apiKey: String(input.apiKey || ""),
    accessKey: "",
    secretKey: "",
    protocol: "gemini",
    imageRequestMode: "openai",
    imageGenerationEndpoint: "",
    imageEditEndpoint: "",
    imageModels: imageModelOrder.filter((model) => enabledImageModels.has(model)),
    chatModels: Array.isArray(input.chatModels) ? uniqueModels(input.chatModels.map(String)) : [],
    videoModels: Array.isArray(input.videoModels) ? uniqueModels(input.videoModels.map(String)) : [],
    modelAliases: normalizeModelAliases(input.modelAliases),
    modelRules: normalizeModelRules(input.modelRules),
    modelCatalogOrder: { image: imageModelOrder },
  };
}

function mergeTudouProviders(inputs: Partial<ApiProvider>[]) {
  return inputs.reduce<ApiProvider>((result, input) => {
    const next = createTudouProvider(input);
    return createTudouProvider({
      ...result,
      apiKey: next.apiKey || result.apiKey,
      imageModels: uniqueModels([...result.imageModels, ...next.imageModels]),
      chatModels: uniqueModels([...result.chatModels, ...next.chatModels]),
      videoModels: uniqueModels([...result.videoModels, ...next.videoModels]),
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

export function normalizeApiProvider(input: Partial<ApiProvider>, providers: ApiProvider[]): ApiProvider {
  if (isApimartProvider(input)) return createApimartProvider(input);
  if (isTudouProvider(input)) return createTudouProvider(input);
  const name = String(input.name || "API").trim() || "API";
  return {
    id: String(input.id || createProviderId(name, providers)).trim(),
    name,
    baseUrl: String(input.baseUrl || "").trim(),
    apiKey: String(input.apiKey || ""),
    accessKey: String(input.accessKey || ""),
    secretKey: String(input.secretKey || ""),
    protocol: input.protocol === "compatible" || input.protocol === "gemini" ? input.protocol : "openai",
    imageRequestMode: input.imageRequestMode === "openai-json" ? "openai-json" : "openai",
    imageGenerationEndpoint: String(input.imageGenerationEndpoint || "").trim(),
    imageEditEndpoint: String(input.imageEditEndpoint || "").trim(),
    imageModels: Array.isArray(input.imageModels) ? uniqueModels(input.imageModels.map(String)) : [],
    chatModels: Array.isArray(input.chatModels) ? uniqueModels(input.chatModels.map(String)) : [],
    videoModels: Array.isArray(input.videoModels) ? uniqueModels(input.videoModels.map(String)) : [],
    modelAliases: normalizeModelAliases(input.modelAliases),
    modelRules: normalizeModelRules(input.modelRules),
  };
}

export function normalizeApiSettings(input: Partial<ApiSettings>): ApiSettings {
  const rawProviders = Array.isArray(input.providers) ? input.providers : [];
  const apimartInputs = rawProviders.filter(isApimartProvider);
  const tudouInputs = rawProviders.filter(isTudouProvider);
  const apimartSourceIds = new Set(apimartInputs.map((provider) => String(provider.id || "").trim()).filter(Boolean));
  const tudouSourceIds = new Set(tudouInputs.map((provider) => String(provider.id || "").trim()).filter(Boolean));
  const customProviders = rawProviders.filter((provider) => !isApimartProvider(provider) && !isTudouProvider(provider)).reduce<ApiProvider[]>((result, item) => {
    const next = normalizeApiProvider(item, result);
    return result.some((provider) => provider.id === next.id) ? result : [...result, next];
  }, []);
  const providers = [
    ...(apimartInputs.length ? [mergeApimartProviders(apimartInputs)] : []),
    ...(tudouInputs.length ? [mergeTudouProviders(tudouInputs)] : []),
    ...customProviders,
  ];
  const rawDefaultProviderId = String(input.defaultImageProviderId || "");
  const requestedDefaultProviderId = apimartSourceIds.has(rawDefaultProviderId)
    ? APIMART_PROVIDER_ID
    : tudouSourceIds.has(rawDefaultProviderId) ? TUDOU_PROVIDER_ID : rawDefaultProviderId;
  const defaultImageProviderId = providers.some((provider) => provider.id === requestedDefaultProviderId) ? requestedDefaultProviderId : "";
  const requestedOrder = Array.isArray(input.providerOrder)
    ? input.providerOrder.map((id) => {
      const value = String(id);
      return apimartSourceIds.has(value) ? APIMART_PROVIDER_ID : tudouSourceIds.has(value) ? TUDOU_PROVIDER_ID : value;
    })
    : [];
  const providerOrder = normalizeApiProviderOrder(requestedOrder, providers);
  return {
    providers,
    defaultImageProviderId,
    providerOrder,
    libtvMachineId: String(input.libtvMachineId || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 32),
    libtvActionFissionConcurrency: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].includes(Number(input.libtvActionFissionConcurrency))
      ? Number(input.libtvActionFissionConcurrency) as LibtvActionFissionConcurrency
      : 1,
  };
}

function setApiSettingsCache(settings: Partial<ApiSettings>) {
  apiSettingsCache = normalizeApiSettings(settings);
  apiSettingsCacheLoaded = true;
  notifyApiProvidersChanged();
  return apiSettingsCache;
}

export function readApiSettings(): ApiSettings {
  return apiSettingsCache;
}

export function normalizeApiProviderOrder(order: string[] | undefined, providers: ApiProvider[]) {
  const validIds = new Set(["libtv", ...providers.map((provider) => provider.id)]);
  const next = uniqueModels((order || []).map(String)).filter((id) => validIds.has(id));
  providers.forEach((provider) => {
    if (!next.includes(provider.id)) next.push(provider.id);
  });
  return next;
}

export function isImageProviderConfigured(provider: ApiProvider) {
  return Boolean(
    provider.baseUrl.trim()
    && provider.apiKey.trim()
    && provider.imageModels.length,
  );
}

export function orderedApiProviders(providers: ApiProvider[], providerOrder: string[] | undefined = []) {
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  const ordered = (providerOrder || [])
    .map((id) => byId.get(id))
    .filter((provider): provider is ApiProvider => Boolean(provider));
  providers.forEach((provider) => {
    if (!ordered.some((item) => item.id === provider.id)) ordered.push(provider);
  });
  return ordered;
}

export function orderedApiProviderItems(providers: ApiProvider[], providerOrder: string[] | undefined = []) {
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  const result = (providerOrder || []).reduce<ApiProviderOrderItem[]>((items, id) => {
    if (id === "libtv") return [...items, { type: "libtv", id: "libtv" }];
    const provider = byId.get(id);
    if (!provider) return items;
    return provider.id === APIMART_PROVIDER_ID
      ? [...items, { type: "apimart", id: APIMART_PROVIDER_ID, provider }]
      : provider.id === TUDOU_PROVIDER_ID
        ? [...items, { type: "tudou", id: TUDOU_PROVIDER_ID, provider }]
        : [...items, { type: "provider", id, provider }];
  }, []);
  providers.forEach((provider) => {
    if (!result.some((item) => item.id === provider.id)) {
      result.push(provider.id === APIMART_PROVIDER_ID
        ? { type: "apimart", id: APIMART_PROVIDER_ID, provider }
        : provider.id === TUDOU_PROVIDER_ID
          ? { type: "tudou", id: TUDOU_PROVIDER_ID, provider }
          : { type: "provider", id: provider.id, provider });
    }
  });
  return result;
}

export async function loadApiSettings(): Promise<ApiSettings> {
  if (!window.forartConfig?.loadApiSettings) {
    return apiSettingsCacheLoaded ? apiSettingsCache : setApiSettingsCache({});
  }
  const loaded: ApiSettings = normalizeApiSettings(await window.forartConfig.loadApiSettings() as Partial<ApiSettings>);
  return setApiSettingsCache(loaded);
}

export async function saveApiSettings(settings: ApiSettings): Promise<ApiSettings> {
  const normalized = normalizeApiSettings(settings);
  if (window.forartConfig?.saveApiSettings) {
    const result = await window.forartConfig.saveApiSettings({
      ...normalized,
      defaultImageProviderId: normalized.defaultImageProviderId || "",
      providerOrder: normalized.providerOrder || [],
    });
    return setApiSettingsCache(normalizeApiSettings(result.apiSettings as Partial<ApiSettings>));
  }
  return setApiSettingsCache(normalized);
}
