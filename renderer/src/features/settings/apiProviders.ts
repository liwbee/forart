type ApiProviderProtocol = "openai" | "compatible" | "gemini";
type ApiProviderImageRequestMode = "openai" | "openai-json";
export type ApiModelKind = "image" | "chat" | "video";
type ApiProviderOrderItem =
  | { type: "provider"; id: string; provider: ApiProvider }
  | { type: "apimart"; id: "apimart"; provider: ApiProvider }
  | { type: "libtv"; id: "libtv" };

interface ApiModelAliases {
  image: Record<string, string>;
  chat: Record<string, string>;
  video: Record<string, string>;
}

interface ApiModelRules {
  image: Record<string, string>;
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
}

export const API_PROVIDER_CHANGED_EVENT = "forart-api-providers-changed";
export const APIMART_PROVIDER_ID = "apimart";
export const APIMART_BASE_URLS = [
  "https://api.apimart.ai/v1",
  "https://api.apib.ai/v1",
  "https://api.aiuxu.com/v1",
  "https://api.aishuch.com/v1",
] as const;

const APIMART_HOST_TO_BASE_URL = new Map(APIMART_BASE_URLS.map((baseUrl) => [new URL(baseUrl).host, baseUrl]));

export interface ApiSettings {
  providers: ApiProvider[];
  defaultImageProviderId?: string;
  providerOrder?: string[];
  libtvMachineId?: string;
}

let apiSettingsCache: ApiSettings = {
  providers: [],
  defaultImageProviderId: "",
  providerOrder: [],
  libtvMachineId: "",
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

function createApimartProvider(input: Partial<ApiProvider> = {}): ApiProvider {
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

export function normalizeApiProvider(input: Partial<ApiProvider>, providers: ApiProvider[]): ApiProvider {
  if (isApimartProvider(input)) return createApimartProvider(input);
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

function normalizeApiSettings(input: Partial<ApiSettings>): ApiSettings {
  const rawProviders = Array.isArray(input.providers) ? input.providers : [];
  const apimartInputs = rawProviders.filter(isApimartProvider);
  const apimartSourceIds = new Set(apimartInputs.map((provider) => String(provider.id || "").trim()).filter(Boolean));
  const customProviders = rawProviders.filter((provider) => !isApimartProvider(provider)).reduce<ApiProvider[]>((result, item) => {
    const next = normalizeApiProvider(item, result);
    return result.some((provider) => provider.id === next.id) ? result : [...result, next];
  }, []);
  const providers = [mergeApimartProviders(apimartInputs), ...customProviders];
  const requestedDefaultProviderId = apimartSourceIds.has(String(input.defaultImageProviderId || ""))
    ? APIMART_PROVIDER_ID
    : String(input.defaultImageProviderId || "");
  const defaultImageProviderId = providers.some((provider) => provider.id === requestedDefaultProviderId) ? requestedDefaultProviderId : "";
  const requestedOrder = Array.isArray(input.providerOrder)
    ? input.providerOrder.map((id) => apimartSourceIds.has(String(id)) ? APIMART_PROVIDER_ID : String(id))
    : [];
  const providerOrder = normalizeApiProviderOrder(requestedOrder, providers);
  return {
    providers,
    defaultImageProviderId,
    providerOrder,
    libtvMachineId: String(input.libtvMachineId || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 32),
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
  const validIds = new Set(["libtv", APIMART_PROVIDER_ID, ...providers.map((provider) => provider.id)]);
  const next = uniqueModels((order || []).map(String)).filter((id) => validIds.has(id));
  providers.forEach((provider) => {
    if (!next.includes(provider.id)) next.push(provider.id);
  });
  if (!next.includes("libtv")) next.unshift("libtv");
  if (providers.some((provider) => provider.id === APIMART_PROVIDER_ID) && !next.includes(APIMART_PROVIDER_ID)) {
    next.unshift(APIMART_PROVIDER_ID);
  }
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
      : [...items, { type: "provider", id, provider }];
  }, []);
  if (!result.some((item) => item.type === "libtv")) result.unshift({ type: "libtv", id: "libtv" });
  providers.forEach((provider) => {
    if (!result.some((item) => item.id === provider.id)) {
      result.push(provider.id === APIMART_PROVIDER_ID
        ? { type: "apimart", id: APIMART_PROVIDER_ID, provider }
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
