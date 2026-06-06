export type ForartMode = "local" | "remote";

export interface ForartAppConfig {
  mode: ForartMode;
  localLibraryPath: string;
  serverUrl: string;
  accessToken: string;
}

export interface ForartConfigApi {
  load: () => Promise<ForartAppConfig | null>;
  save: (config: ForartAppConfig) => Promise<{ ok: true; config: ForartAppConfig }>;
  chooseDirectory: () => Promise<{ canceled: boolean; path: string }>;
  testServer: (serverUrl: string) => Promise<{ ok: boolean; status?: number; error?: string; payload?: unknown }>;
  localServerStatus: () => Promise<{ ok: boolean; managed?: boolean; localLibraryPath?: string; status?: number; error?: string; payload?: unknown }>;
}

declare global {
  interface Window {
    forartConfig?: ForartConfigApi;
  }
}

export const DEFAULT_APP_CONFIG: ForartAppConfig = {
  mode: "local",
  localLibraryPath: "",
  serverUrl: "",
  accessToken: "",
};

export function normalizeConfig(input: Partial<ForartAppConfig>): ForartAppConfig {
  return {
    ...DEFAULT_APP_CONFIG,
    ...input,
    mode: input.mode === "remote" ? "remote" : "local",
    localLibraryPath: String(input.localLibraryPath || "").trim(),
    serverUrl: String(input.serverUrl || "").trim().replace(/\/+$/, ""),
    accessToken: String(input.accessToken || "").trim(),
  };
}
