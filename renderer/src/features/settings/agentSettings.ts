/** @deprecated Import extensionSettings instead. */
export {
  EXTENSION_SETTINGS_CHANGED_EVENT as AGENT_SETTINGS_CHANGED_EVENT,
  DEFAULT_EXTENSION_SETTINGS as DEFAULT_AGENT_SETTINGS,
  normalizeExtensionSettings as normalizeAgentSettings,
  readExtensionSettings as readAgentSettings,
  hasLoadedExtensionSettings as hasLoadedAgentSettings,
  loadExtensionSettings as loadAgentSettings,
  saveExtensionSettings as saveAgentSettings,
} from "./extensionSettings";
