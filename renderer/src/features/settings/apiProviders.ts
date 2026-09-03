type ApiProviderProtocol = "openai" | "compatible" | "gemini";
type ApiProviderImageRequestMode = "openai" | "openai-json";
export type ApiModelKind = "image" | "chat" | "video";
export type ApiProviderOrderItem =
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
  hasApiKey: boolean;
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
    hasApiKey: false,
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

// 固定 provider 的默认草稿模板。schema 规则的唯一实现位于主进程
// config-store.cjs，保存后由它统一归一化并回传最终结果。
export function createApimartProvider(): ApiProvider {
  return {
    id: APIMART_PROVIDER_ID,
    name: "APImart",
    baseUrl: APIMART_BASE_URLS[0],
    apiKey: "",
    hasApiKey: false,
    accessKey: "",
    secretKey: "",
    protocol: "compatible",
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

export function createTudouProvider(): ApiProvider {
  return {
    id: TUDOU_PROVIDER_ID,
    name: "土豆API",
    baseUrl: TUDOU_BASE_URL,
    apiKey: "",
    hasApiKey: false,
    accessKey: "",
    secretKey: "",
    protocol: "gemini",
    imageRequestMode: "openai",
    imageGenerationEndpoint: "",
    imageEditEndpoint: "",
    imageModels: [],
    chatModels: [],
    videoModels: [],
    modelAliases: emptyModelAliases(),
    modelRules: emptyModelRules(),
    modelCatalogOrder: { image: [...TUDOU_IMAGE_MODELS] },
  };
}

// 编辑草稿的 UI 层输入整形：只做 trim/枚举回退/列表去重。
// 不做类型探测与合并——那是主进程 normalizeApiSettings 的职责。
export function coerceApiProviderDraft(input: ApiProvider): ApiProvider {
  return {
    ...input,
    name: input.name.trim() || "API",
    baseUrl: input.baseUrl.trim(),
    apiKey: String(input.apiKey || ""),
    accessKey: String(input.accessKey || ""),
    secretKey: String(input.secretKey || ""),
    protocol: input.protocol === "compatible" || input.protocol === "gemini" ? input.protocol : "openai",
    imageRequestMode: input.imageRequestMode === "openai-json" ? "openai-json" : "openai",
    imageGenerationEndpoint: input.imageGenerationEndpoint.trim(),
    imageEditEndpoint: input.imageEditEndpoint.trim(),
    imageModels: uniqueModels(input.imageModels),
    chatModels: uniqueModels(input.chatModels),
    videoModels: uniqueModels(input.videoModels),
    hasApiKey: Boolean(input.hasApiKey || String(input.apiKey || "").trim()),
  };
}

function setApiSettingsCache(settings: ApiSettings) {
  apiSettingsCache = settings;
  apiSettingsCacheLoaded = true;
  notifyApiProvidersChanged();
  return apiSettingsCache;
}

export function readApiSettings(): ApiSettings {
  return apiSettingsCache;
}

export function hasLoadedApiSettings() {
  return apiSettingsCacheLoaded;
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
      && (provider.hasApiKey || provider.apiKey.trim())
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

export function isChatProviderConfigured(provider: ApiProvider) {
  return Boolean(provider.baseUrl.trim() && (provider.hasApiKey || provider.apiKey.trim()) && provider.chatModels.length);
}

export async function loadApiSettings(): Promise<ApiSettings> {
  if (!window.forartConfig?.loadApiSettings) {
    return apiSettingsCacheLoaded
      ? apiSettingsCache
      : setApiSettingsCache({
        providers: [],
        defaultImageProviderId: "",
        providerOrder: [],
        libtvMachineId: "",
        libtvActionFissionConcurrency: 1,
      });
  }
  const loaded = await window.forartConfig.loadApiSettings() as ApiSettings;
  return setApiSettingsCache(loaded);
}

export async function saveApiSettings(settings: ApiSettings): Promise<ApiSettings> {
  if (window.forartConfig?.saveApiSettings) {
    const result = await window.forartConfig.saveApiSettings({
      ...settings,
      defaultImageProviderId: settings.defaultImageProviderId || "",
      providerOrder: settings.providerOrder || [],
    });
    return setApiSettingsCache(result.apiSettings as ApiSettings);
  }
  return setApiSettingsCache(settings);
}
