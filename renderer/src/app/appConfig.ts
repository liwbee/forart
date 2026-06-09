export type ForartMode = "local" | "remote";

export interface ForartAppConfig {
  mode: ForartMode;
  localLibraryPath: string;
  serverUrl: string;
  accessToken: string;
  imageDownloadPath: string;
}

export type ForartApiProviderProtocol = "openai" | "async" | "gemini";

export interface ForartApiProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  protocol: ForartApiProviderProtocol;
  imageModels: string[];
  chatModels: string[];
  videoModels: string[];
}

export interface ForartApiSettingsConfig {
  providers: ForartApiProviderConfig[];
  defaultImageProviderId: string;
}

export interface ForartConfigApi {
  load: () => Promise<ForartAppConfig | null>;
  save: (config: ForartAppConfig) => Promise<{ ok: true; config: ForartAppConfig }>;
  loadApiSettings: () => Promise<ForartApiSettingsConfig>;
  saveApiSettings: (settings: ForartApiSettingsConfig) => Promise<{ ok: true; apiSettings: ForartApiSettingsConfig }>;
  chooseDirectory: () => Promise<{ canceled: boolean; path: string }>;
  testServer: (serverUrl: string) => Promise<{ ok: boolean; status?: number; error?: string; payload?: unknown }>;
  localServerStatus: () => Promise<{ ok: boolean; managed?: boolean; localLibraryPath?: string; status?: number; error?: string; payload?: unknown }>;
}

export interface EasyToolApi {
  saveResult: (payload: { dataUrl?: string; url?: string; defaultName?: string; directory?: string }) => Promise<{ canceled: boolean; filePath?: string }>;
  loadCanvas: () => Promise<unknown | null>;
  saveCanvas: (payload: unknown) => Promise<{ ok: true; filePath?: string }>;
  listCanvases: () => Promise<{ canvases: Array<{ id: string; title: string; icon?: string; color?: string; pinned?: boolean; createdAt: number; updatedAt: number; nodeCount: number }> }>;
  createCanvas: (payload: { title?: string; icon?: string; nodes?: unknown[]; connections?: unknown[]; viewport?: unknown }) => Promise<{ ok: true; canvas: unknown; record: unknown; filePath?: string }>;
  loadCanvasProject: (canvasId: string) => Promise<unknown | null>;
  saveCanvasProject: (canvasId: string, payload: unknown) => Promise<{ ok: true; canvas: unknown; record: unknown; filePath?: string }>;
  updateCanvasMeta: (canvasId: string, patch: { title?: string; icon?: string; color?: string; pinned?: boolean }) => Promise<{ ok: true; canvas: unknown; record: unknown; filePath?: string }>;
  deleteCanvas: (canvasId: string) => Promise<{ ok: true; filePath?: string }>;
  saveCanvasAsset: (payload: { dataUrl?: string; url?: string; defaultName?: string; kind?: "input" | "output" }) => Promise<{ url: string; fileName: string; filePath?: string }>;
}

declare global {
  interface Window {
    forartConfig?: ForartConfigApi;
    easyTool?: EasyToolApi;
  }
}

export const DEFAULT_APP_CONFIG: ForartAppConfig = {
  mode: "local",
  localLibraryPath: "",
  serverUrl: "",
  accessToken: "",
  imageDownloadPath: "",
};

export function normalizeConfig(input: Partial<ForartAppConfig>): ForartAppConfig {
  return {
    ...DEFAULT_APP_CONFIG,
    ...input,
    mode: input.mode === "remote" ? "remote" : "local",
    localLibraryPath: String(input.localLibraryPath || "").trim(),
    serverUrl: String(input.serverUrl || "").trim().replace(/\/+$/, ""),
    accessToken: String(input.accessToken || "").trim(),
    imageDownloadPath: String(input.imageDownloadPath || "").trim(),
  };
}
