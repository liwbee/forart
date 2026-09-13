import type {
  ForartExtensionModelRoute,
  ForartExtensionReasoningLevel,
  ForartExtensionSettings,
} from "../../app/appConfig";

export const EXTENSION_SETTINGS_CHANGED_EVENT = "forart-extension-settings-changed";

export const DEFAULT_EXTENSION_SETTINGS: ForartExtensionSettings = {
  backgroundRemovalEnabled: false,
  promptOptimizationEnabled: false,
  thinkingMode: false,
  reasoningLevel: "medium",
  imageGeneratorPromptOptimization: null,
};

function normalizeRoute(value: unknown): ForartExtensionModelRoute | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<ForartExtensionModelRoute>;
  const providerId = String(source.providerId || "").trim();
  const model = String(source.model || "").trim();
  return providerId && model ? { providerId, model } : null;
}

export function normalizeExtensionSettings(value: unknown): ForartExtensionSettings {
  const source = value && typeof value === "object" ? value as Partial<ForartExtensionSettings> : {};
  const reasoningLevel: ForartExtensionReasoningLevel = source.reasoningLevel === "minimal"
    || source.reasoningLevel === "low"
    || source.reasoningLevel === "medium"
    || source.reasoningLevel === "high"
    || source.reasoningLevel === "xhigh"
    || source.reasoningLevel === "max"
    ? source.reasoningLevel
    : "medium";
  return {
    backgroundRemovalEnabled: source.backgroundRemovalEnabled === true,
    promptOptimizationEnabled: source.promptOptimizationEnabled === true,
    thinkingMode: source.thinkingMode === true,
    reasoningLevel,
    imageGeneratorPromptOptimization: normalizeRoute(source.imageGeneratorPromptOptimization),
  };
}

let extensionSettingsCache = DEFAULT_EXTENSION_SETTINGS;
let extensionSettingsCacheLoaded = false;
let extensionSettingsLoadPromise: Promise<ForartExtensionSettings> | null = null;

function setExtensionSettingsCache(value: unknown) {
  extensionSettingsCache = normalizeExtensionSettings(value);
  extensionSettingsCacheLoaded = true;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EXTENSION_SETTINGS_CHANGED_EVENT));
  return extensionSettingsCache;
}

export function readExtensionSettings() { return extensionSettingsCache; }
export function hasLoadedExtensionSettings() { return extensionSettingsCacheLoaded; }

export async function loadExtensionSettings(): Promise<ForartExtensionSettings> {
  if (extensionSettingsLoadPromise) return extensionSettingsLoadPromise;
  extensionSettingsLoadPromise = (async () => {
    if (!window.forartConfig?.loadExtensionSettings) return setExtensionSettingsCache(await window.forartConfig?.loadAgentSettings?.() ?? extensionSettingsCache);
    return setExtensionSettingsCache(await window.forartConfig.loadExtensionSettings());
  })();
  try {
    return await extensionSettingsLoadPromise;
  } finally {
    extensionSettingsLoadPromise = null;
  }
}

export async function saveExtensionSettings(value: ForartExtensionSettings): Promise<ForartExtensionSettings> {
  const settings = normalizeExtensionSettings(value);
  if (!window.forartConfig?.saveExtensionSettings) {
    if (window.forartConfig?.saveAgentSettings) {
      const result = await window.forartConfig.saveAgentSettings(settings);
      return setExtensionSettingsCache(result.agentSettings);
    }
    return setExtensionSettingsCache(settings);
  }
  const result = await window.forartConfig.saveExtensionSettings(settings);
  return setExtensionSettingsCache(result.extensionSettings);
}
