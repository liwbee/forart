export type ApiProviderProtocol = "openai" | "async" | "gemini";
export type ApiModelKind = "image" | "chat" | "video";

export interface ApiModelAliases {
  image: Record<string, string>;
  chat: Record<string, string>;
  video: Record<string, string>;
}

export interface ApiModelRules {
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
  imageModels: string[];
  chatModels: string[];
  videoModels: string[];
  modelAliases: ApiModelAliases;
  modelRules: ApiModelRules;
}

export const API_PROVIDER_CHANGED_EVENT = "forart-api-providers-changed";

export interface ApiSettings {
  providers: ApiProvider[];
  defaultImageProviderId?: string;
}

let apiSettingsCache: ApiSettings = {
  providers: [],
  defaultImageProviderId: "",
};
let apiSettingsCacheLoaded = false;

export function notifyApiProvidersChanged() {
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

export function normalizeModelAliases(input: unknown): ApiModelAliases {
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

export function normalizeModelRules(input: unknown): ApiModelRules {
  const record = input && typeof input === "object" ? input as Partial<ApiModelRules> : {};
  return {
    image: normalizeRuleBucket(record.image),
  };
}

export function getModelDisplayName(provider: ApiProvider | null | undefined, kind: ApiModelKind, model: string) {
  const alias = provider?.modelAliases?.[kind]?.[model]?.trim();
  return alias || model;
}

export function createProviderId(name: string, providers: ApiProvider[]) {
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
    imageModels: [],
    chatModels: [],
    videoModels: [],
    modelAliases: emptyModelAliases(),
    modelRules: emptyModelRules(),
  };
}

export function normalizeApiProvider(input: Partial<ApiProvider>, providers: ApiProvider[]): ApiProvider {
  const name = String(input.name || "API").trim() || "API";
  return {
    id: String(input.id || createProviderId(name, providers)).trim(),
    name,
    baseUrl: String(input.baseUrl || "").trim(),
    apiKey: String(input.apiKey || ""),
    accessKey: String(input.accessKey || ""),
    secretKey: String(input.secretKey || ""),
    protocol: input.protocol === "async" || input.protocol === "gemini" ? input.protocol : "openai",
    imageModels: Array.isArray(input.imageModels) ? input.imageModels.map(String).filter(Boolean) : [],
    chatModels: Array.isArray(input.chatModels) ? input.chatModels.map(String).filter(Boolean) : [],
    videoModels: Array.isArray(input.videoModels) ? input.videoModels.map(String).filter(Boolean) : [],
    modelAliases: normalizeModelAliases(input.modelAliases),
    modelRules: normalizeModelRules(input.modelRules),
  };
}

function normalizeApiSettings(input: Partial<ApiSettings>): ApiSettings {
  const providers = Array.isArray(input.providers) ? input.providers.reduce<ApiProvider[]>((result, item) => {
    const next = normalizeApiProvider(item, result);
    return result.some((provider) => provider.id === next.id) ? result : [...result, next];
  }, []) : [];
  const defaultImageProviderId = providers.some((provider) => provider.id === input.defaultImageProviderId) ? String(input.defaultImageProviderId) : "";
  return { providers, defaultImageProviderId };
}

function setApiSettingsCache(settings: Partial<ApiSettings>) {
  apiSettingsCache = normalizeApiSettings(settings);
  apiSettingsCacheLoaded = true;
  notifyApiProvidersChanged();
  return apiSettingsCache;
}

export function readApiProviders(): ApiProvider[] {
  return apiSettingsCache.providers;
}

export function readApiSettings(): ApiSettings {
  return apiSettingsCache;
}

export async function loadApiSettings(): Promise<ApiSettings> {
  if (!window.forartConfig?.loadApiSettings) {
    return apiSettingsCacheLoaded ? apiSettingsCache : setApiSettingsCache({});
  }
  const loaded: ApiSettings = normalizeApiSettings(await window.forartConfig.loadApiSettings() as Partial<ApiSettings>);
  return setApiSettingsCache(loaded);
}

export async function saveApiSettings(settings: ApiSettings): Promise<ApiSettings> {
  const normalized = setApiSettingsCache(settings);
  if (window.forartConfig?.saveApiSettings) {
    const result = await window.forartConfig.saveApiSettings({ ...normalized, defaultImageProviderId: normalized.defaultImageProviderId || "" });
    return setApiSettingsCache(normalizeApiSettings(result.apiSettings as Partial<ApiSettings>));
  }
  return normalized;
}
