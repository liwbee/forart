import type {
  ForartAgentModelRoute,
  ForartAgentReasoningLevel,
  ForartAgentSettings,
} from "../../app/appConfig";

export const AGENT_SETTINGS_CHANGED_EVENT = "forart-agent-settings-changed";

export const DEFAULT_AGENT_SETTINGS: ForartAgentSettings = {
  thinkingMode: false,
  reasoningLevel: "medium",
  imageGeneratorPromptOptimization: null,
};

function normalizeRoute(value: unknown): ForartAgentModelRoute | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<ForartAgentModelRoute>;
  const providerId = String(source.providerId || "").trim();
  const model = String(source.model || "").trim();
  return providerId && model ? { providerId, model } : null;
}

export function normalizeAgentSettings(value: unknown): ForartAgentSettings {
  const source = value && typeof value === "object" ? value as Partial<ForartAgentSettings> : {};
  const reasoningLevel: ForartAgentReasoningLevel = source.reasoningLevel === "minimal"
    || source.reasoningLevel === "low"
    || source.reasoningLevel === "medium"
    || source.reasoningLevel === "high"
    || source.reasoningLevel === "xhigh"
    || source.reasoningLevel === "max"
    ? source.reasoningLevel
    : "medium";
  return {
    thinkingMode: source.thinkingMode === true,
    reasoningLevel,
    imageGeneratorPromptOptimization: normalizeRoute(source.imageGeneratorPromptOptimization),
  };
}

let agentSettingsCache = DEFAULT_AGENT_SETTINGS;
let agentSettingsCacheLoaded = false;

function setAgentSettingsCache(value: unknown) {
  agentSettingsCache = normalizeAgentSettings(value);
  agentSettingsCacheLoaded = true;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(AGENT_SETTINGS_CHANGED_EVENT));
  return agentSettingsCache;
}

export function readAgentSettings() {
  return agentSettingsCache;
}

export function hasLoadedAgentSettings() {
  return agentSettingsCacheLoaded;
}

export async function loadAgentSettings(): Promise<ForartAgentSettings> {
  if (!window.forartConfig?.loadAgentSettings) return setAgentSettingsCache(agentSettingsCache);
  return setAgentSettingsCache(await window.forartConfig.loadAgentSettings());
}

export async function saveAgentSettings(value: ForartAgentSettings): Promise<ForartAgentSettings> {
  const settings = normalizeAgentSettings(value);
  if (!window.forartConfig?.saveAgentSettings) return setAgentSettingsCache(settings);
  const result = await window.forartConfig.saveAgentSettings(settings);
  return setAgentSettingsCache(result.agentSettings);
}
