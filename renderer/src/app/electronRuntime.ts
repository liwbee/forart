export function isElectronRuntime() {
  return Boolean(window.forartWindow && window.forartConfig);
}

export function allowsBrowserDiagnosticRuntime() {
  if (process.env.NODE_ENV === "production") return false;
  return new URLSearchParams(window.location.search).get("diagnostic") === "1";
}

export function missingElectronBridgeNames() {
  const missing: string[] = [];
  if (!window.forartWindow) missing.push("forartWindow");
  if (!window.forartConfig) missing.push("forartConfig");
  return missing;
}

export function requireElectronBridge<T>(value: T | undefined, name: string): T {
  if (!value) throw new Error(`${name} bridge is unavailable. Use the Forart desktop app.`);
  return value;
}
