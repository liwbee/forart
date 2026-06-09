export type ApiProviderProtocol = "openai" | "async" | "gemini";

export interface ApiProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  protocol: ApiProviderProtocol;
  imageModels: string[];
  chatModels: string[];
  videoModels: string[];
}

export const API_PROVIDER_STORAGE_KEY = "forart_api_providers_v1";
export const DEFAULT_IMAGE_PROVIDER_STORAGE_KEY = "forart_default_image_provider_v1";
export const API_SETTINGS_MIGRATION_STORAGE_KEY = "forart_api_settings_config_migrated_v1";
export const API_PROVIDER_CHANGED_EVENT = "forart-api-providers-changed";

export interface ApiSettings {
  providers: ApiProvider[];
  defaultImageProviderId: string;
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
    protocol: "openai",
    imageModels: [],
    chatModels: [],
    videoModels: [],
  };
}

export function normalizeApiProvider(input: Partial<ApiProvider>, providers: ApiProvider[]): ApiProvider {
  const name = String(input.name || "API").trim() || "API";
  return {
    id: String(input.id || createProviderId(name, providers)).trim(),
    name,
    baseUrl: String(input.baseUrl || "").trim(),
    apiKey: String(input.apiKey || ""),
    protocol: input.protocol === "async" || input.protocol === "gemini" ? input.protocol : "openai",
    imageModels: Array.isArray(input.imageModels) ? input.imageModels.map(String).filter(Boolean) : [],
    chatModels: Array.isArray(input.chatModels) ? input.chatModels.map(String).filter(Boolean) : [],
    videoModels: Array.isArray(input.videoModels) ? input.videoModels.map(String).filter(Boolean) : [],
  };
}

function readLegacyApiProviders(): ApiProvider[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(API_PROVIDER_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.reduce<ApiProvider[]>((providers, item) => {
      const next = normalizeApiProvider(item, providers);
      return providers.some((provider) => provider.id === next.id) ? providers : [...providers, next];
    }, []);
  } catch {
    return [];
  }
}

function readLegacyDefaultImageProviderId() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(DEFAULT_IMAGE_PROVIDER_STORAGE_KEY) || "";
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

async function migrateLegacyApiSettingsIfNeeded(settings: ApiSettings) {
  if (typeof window === "undefined" || !window.forartConfig?.saveApiSettings) return settings;
  if (window.localStorage.getItem(API_SETTINGS_MIGRATION_STORAGE_KEY)) return settings;

  const legacyProviders = readLegacyApiProviders();
  const legacyDefaultImageProviderId = readLegacyDefaultImageProviderId();
  if (!legacyProviders.length && !legacyDefaultImageProviderId) {
    window.localStorage.setItem(API_SETTINGS_MIGRATION_STORAGE_KEY, new Date().toISOString());
    return settings;
  }
  if (settings.providers.length) {
    window.localStorage.setItem(API_SETTINGS_MIGRATION_STORAGE_KEY, new Date().toISOString());
    return settings;
  }

  const migrated = normalizeApiSettings({ providers: legacyProviders, defaultImageProviderId: legacyDefaultImageProviderId });
  await window.forartConfig.saveApiSettings(migrated);
  window.localStorage.setItem(API_SETTINGS_MIGRATION_STORAGE_KEY, new Date().toISOString());
  return migrated;
}

export function readApiProviders(): ApiProvider[] {
  return apiSettingsCache.providers;
}

export function readDefaultImageProviderId() {
  return apiSettingsCache.defaultImageProviderId;
}

export function readApiSettings(): ApiSettings {
  return apiSettingsCache;
}

export async function loadApiSettings(): Promise<ApiSettings> {
  if (!window.forartConfig?.loadApiSettings) {
    if (apiSettingsCacheLoaded) return apiSettingsCache;
    return setApiSettingsCache({ providers: readLegacyApiProviders(), defaultImageProviderId: readLegacyDefaultImageProviderId() });
  }
  const loaded = normalizeApiSettings(await window.forartConfig.loadApiSettings());
  return setApiSettingsCache(await migrateLegacyApiSettingsIfNeeded(loaded));
}

export async function saveApiSettings(settings: ApiSettings): Promise<ApiSettings> {
  const normalized = setApiSettingsCache(settings);
  if (window.forartConfig?.saveApiSettings) {
    const result = await window.forartConfig.saveApiSettings(normalized);
    return setApiSettingsCache(result.apiSettings);
  }
  return normalized;
}
