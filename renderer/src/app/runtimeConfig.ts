const DEFAULT_APP_TITLE = "Forart";

interface RuntimeConfig {
  appTitle?: string;
}

declare global {
  interface Window {
    __FORART_CONFIG__?: RuntimeConfig;
  }
}

export function getAppTitle() {
  if (typeof window === "undefined") return DEFAULT_APP_TITLE;
  const title = window.__FORART_CONFIG__?.appTitle?.trim();
  return title || DEFAULT_APP_TITLE;
}
