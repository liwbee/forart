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
  accessKey?: string;
  secretKey?: string;
  protocol: ForartApiProviderProtocol;
  imageModels: string[];
  chatModels: string[];
  videoModels: string[];
  modelAliases?: {
    image?: Record<string, string>;
    chat?: Record<string, string>;
    video?: Record<string, string>;
  };
  modelRules?: {
    image?: Record<string, string>;
  };
}

export interface ForartApiSettingsConfig {
  providers: ForartApiProviderConfig[];
  defaultImageProviderId: string;
}

export interface ForartAppInfo {
  name: string;
  repoUrl: string;
  updateUrl: string;
  canGitUpdate: boolean;
  currentRevision: string;
  currentUpdatedAt: string;
}

export interface ForartUpdateCheckResult {
  ok: boolean;
  currentRevision: string;
  latestRevision: string;
  currentUpdatedAt: string;
  latestUpdatedAt: string;
  updateAvailable: boolean;
  canGitUpdate: boolean;
  repoUrl: string;
  error?: string;
}

export interface ForartUpdateRunResult {
  ok: boolean;
  stdout?: string;
  stderr?: string;
  restartRequired?: boolean;
  error?: string;
}

export interface ForartConfigApi {
  load: () => Promise<ForartAppConfig | null>;
  save: (config: ForartAppConfig) => Promise<{ ok: true; config: ForartAppConfig }>;
  loadApiSettings: () => Promise<ForartApiSettingsConfig>;
  saveApiSettings: (settings: ForartApiSettingsConfig) => Promise<{ ok: true; apiSettings: ForartApiSettingsConfig }>;
  chooseDirectory: () => Promise<{ canceled: boolean; path: string }>;
  testServer: (serverUrl: string) => Promise<{ ok: boolean; status?: number; error?: string; payload?: unknown }>;
  localServerStatus: () => Promise<{ ok: boolean; managed?: boolean; localLibraryPath?: string; status?: number; error?: string; payload?: unknown }>;
  appInfo: () => Promise<ForartAppInfo>;
  checkUpdate: () => Promise<ForartUpdateCheckResult>;
  runUpdate: () => Promise<ForartUpdateRunResult>;
  openUpdatePage: () => Promise<{ ok: true }>;
}

export interface EasyToolApi {
  saveResult: (payload: { dataUrl?: string; url?: string; defaultName?: string; directory?: string }) => Promise<{ canceled: boolean; filePath?: string }>;
  listCanvases: () => Promise<{ canvases: Array<{ id: string; title: string; icon?: string; canvasType?: string; source?: string; libtvProjectId?: string; libtvProjectName?: string; color?: string; pinned?: boolean; createdAt: number; updatedAt: number; nodeCount: number }> }>;
  createCanvas: (payload: { title?: string; icon?: string; canvasType?: string; source?: string; libtvProjectId?: string; libtvProjectName?: string; nodes?: unknown[]; connections?: unknown[]; groups?: unknown[]; viewport?: unknown }) => Promise<{ ok: true; canvas: unknown; record: unknown; filePath?: string }>;
  loadCanvasProject: (canvasId: string) => Promise<unknown | null>;
  saveCanvasProject: (canvasId: string, payload: unknown) => Promise<{ ok: true; canvas: unknown; record: unknown; filePath?: string }>;
  updateCanvasMeta: (canvasId: string, patch: { title?: string; icon?: string; color?: string; pinned?: boolean }) => Promise<{ ok: true; canvas: unknown; record: unknown; filePath?: string }>;
  deleteCanvas: (canvasId: string) => Promise<{ ok: true; filePath?: string }>;
  saveCanvasAsset: (payload: { dataUrl?: string; url?: string; defaultName?: string; kind?: "input" | "output" }) => Promise<{ url: string; fileName: string; filePath?: string }>;
}

export interface LibtvModelOption {
  key: string;
  name: string;
  label: string;
}

export interface LibtvImportResult {
  title?: string;
  nodes: unknown[];
  connections: unknown[];
  groups: unknown[];
  viewport?: unknown;
}

export interface LibtvProjectRecord {
  id?: number;
  uuid: string;
  name: string;
  teamId?: number;
  updatedAtMs?: number;
  createdAtMs?: number;
  coverUrl?: string;
}

export interface LibtvGeneratePayload {
  projectId: string;
  nodeId: string;
  prompt?: string;
  model?: string;
  resolution?: string;
  aspectRatio?: string;
  content?: string | string[];
  url?: string | string[];
  originalUrl?: string | string[];
  left?: string | string[];
  leftAdd?: string | string[];
  leftRemove?: string | string[];
}

export interface LibtvGenerateResult {
  nodeId: string;
  projectId: string;
  url?: string;
  fileName?: string;
  status?: string;
  raw?: unknown;
}

export interface LibtvCreateNodePayload {
  projectId: string;
  title?: string;
  type: "image" | "text";
  x?: number;
  y?: number;
  prompt?: string;
  model?: string;
  resolution?: string;
  aspectRatio?: string;
  content?: string | string[];
}

export interface LibtvCreateNodeResult {
  nodeId: string;
  projectId: string;
  title?: string;
  type?: string;
  url?: string;
  fileName?: string;
  raw?: unknown;
}

export interface LibtvUploadNodeResult {
  nodeId: string;
  projectId: string;
  title?: string;
  url?: string;
  fileName?: string;
  raw?: unknown;
}

export interface LibtvImportProgress {
  projectId?: string;
  stage: "loadingProject" | "loadingNodeDetails" | "mappingNodes" | "creatingCanvas" | "done";
  current?: number;
  total?: number;
  message?: string;
}

export interface LibtvAccountRecord {
  accountId?: number | string;
  accountName?: string;
  accountType?: number;
  isActive?: boolean;
  owner?: boolean;
  memberAccount?: {
    memberName?: string;
    accountLevel?: number | string;
    effective?: boolean;
  };
}

export interface LibtvApi {
  status: () => Promise<{ ok: boolean; available: boolean; path?: string; version?: string; error?: string }>;
  install: () => Promise<{ ok: true; path?: string; stdout?: string; stderr?: string }>;
  account: () => Promise<{ ok: boolean; loggedIn: boolean; account?: unknown; error?: string }>;
  accounts: () => Promise<{ ok: boolean; accounts: LibtvAccountRecord[] }>;
  useAccount: (account: string | number) => Promise<{ ok: true }>;
  loginWeb: () => Promise<{ ok: true }>;
  logout: () => Promise<{ ok: true }>;
  imageModels: () => Promise<{ models: LibtvModelOption[] }>;
  searchProjects: (payload: { name?: string; page?: number; pageSize?: number; teamId?: number | null }) => Promise<{ projects: LibtvProjectRecord[]; total: number }>;
  importProject: (projectId: string) => Promise<LibtvImportResult>;
  onImportProgress?: (callback: (payload: LibtvImportProgress) => void) => () => void;
  createNode: (payload: LibtvCreateNodePayload) => Promise<LibtvCreateNodeResult>;
  deleteNode: (payload: { projectId: string; nodeId: string; title?: string; type?: string }) => Promise<{ ok: true; projectId: string; nodeId: string }>;
  runImageNode: (payload: LibtvGeneratePayload) => Promise<LibtvGenerateResult>;
  updateNode: (payload: LibtvGeneratePayload) => Promise<LibtvGenerateResult>;
  uploadNode: (payload: { projectId: string; title?: string; filePath: string; x?: number; y?: number }) => Promise<LibtvUploadNodeResult>;
  syncNode: (payload: { projectId: string; nodeId: string }) => Promise<LibtvGenerateResult>;
}

declare global {
  interface Window {
    forartConfig?: ForartConfigApi;
    easyTool?: EasyToolApi;
    libtv?: LibtvApi;
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
