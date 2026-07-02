export type ForartMode = "local" | "remote";

export interface ForartAppConfig {
  mode: ForartMode;
  localLibraryPath: string;
  serverUrl: string;
  imageDownloadPath: string;
  language: "zh-CN" | "en-US";
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

export interface ForartImageReviewSettings {
  modelFolders: string;
  detailFolders: string;
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
  updateNotes?: ForartUpdateNotes;
  error?: string;
}

export interface ForartUpdateRunResult {
  ok: boolean;
  stdout?: string;
  stderr?: string;
  restartRequired?: boolean;
  backupDir?: string;
  updated?: string[];
  count?: number;
  version?: string;
  error?: string;
}

export interface ForartUpdateNotes {
  version?: string;
  updatedAt?: string;
  revision?: string;
  source?: string;
  items: string[];
  error?: string;
}

export interface ForartUpdateConnectivityItem {
  name: string;
  ok: boolean;
  required: boolean;
  elapsedMs: number;
  status?: number;
  detail?: string;
}

export interface ForartUpdateConnectivityResult {
  ok: boolean;
  results: ForartUpdateConnectivityItem[];
}

export interface ForartConfigApi {
  load: () => Promise<ForartAppConfig | null>;
  save: (config: ForartAppConfig) => Promise<{ ok: true; config: ForartAppConfig }>;
  loadApiSettings: () => Promise<ForartApiSettingsConfig>;
  saveApiSettings: (settings: ForartApiSettingsConfig) => Promise<{ ok: true; apiSettings: ForartApiSettingsConfig }>;
  loadImageReviewSettings: () => Promise<ForartImageReviewSettings>;
  saveImageReviewSettings: (settings: ForartImageReviewSettings) => Promise<{ ok: true; imageReview: ForartImageReviewSettings }>;
  defaultPaths: () => Promise<{ imageDownloadPath: string }>;
  chooseDirectory: (payload?: { title?: string }) => Promise<{ canceled: boolean; path: string }>;
  testServer: (serverUrl: string) => Promise<{ ok: boolean; status?: number; error?: string; payload?: unknown }>;
  localServerStatus: () => Promise<{ ok: boolean; managed?: boolean; localLibraryPath?: string; status?: number; error?: string; payload?: unknown }>;
  appInfo: () => Promise<ForartAppInfo>;
  checkUpdate: () => Promise<ForartUpdateCheckResult>;
  runUpdate: () => Promise<ForartUpdateRunResult>;
  updateConnectivity: () => Promise<ForartUpdateConnectivityResult>;
  openUpdatePage: () => Promise<{ ok: true }>;
}

export interface EasyToolApi {
  saveResult: (payload: { dataUrl?: string; url?: string; defaultName?: string; directory?: string }) => Promise<{ canceled: boolean; filePath?: string }>;
  listCanvases: () => Promise<{
    canvases: Array<{ id: string; title: string; icon?: string; canvasType?: string; source?: string; projectId?: string; color?: string; pinned?: boolean; createdAt: number; updatedAt: number; nodeCount: number }>;
    projects: Array<{ id: string; title: string; color?: string; createdAt: number; updatedAt: number }>;
  }>;
  createCanvas: (payload: { title?: string; icon?: string; canvasType?: string; source?: string; projectId?: string; nodes?: unknown[]; connections?: unknown[]; groups?: unknown[]; viewport?: unknown }) => Promise<{ ok: true; canvas: unknown; record: unknown; filePath?: string }>;
  createCanvasProject: (payload: { title?: string; color?: string }) => Promise<{ ok: true; project: unknown }>;
  loadCanvas: (canvasId: string) => Promise<unknown | null>;
  saveCanvas: (canvasId: string, payload: unknown) => Promise<{ ok: true; canvas: unknown; record: unknown; filePath?: string }>;
  updateCanvasMeta: (canvasId: string, patch: { title?: string; icon?: string; projectId?: string; color?: string; pinned?: boolean }) => Promise<{ ok: true; canvas: unknown; record: unknown; filePath?: string }>;
  updateCanvasProject: (projectId: string, patch: { title?: string; color?: string }) => Promise<{ ok: true; project: unknown }>;
  deleteCanvas: (canvasId: string) => Promise<{ ok: true; filePath?: string }>;
  deleteCanvasProject: (projectId: string) => Promise<{ ok: true; deletedCanvasIds?: string[] }>;
  moveCanvasToProject: (canvasId: string, projectId: string) => Promise<{ ok: true; canvas: unknown; record: unknown; filePath?: string }>;
  saveCanvasAsset: (payload: { dataUrl?: string; url?: string; defaultName?: string; kind?: "input" | "output" }) => Promise<{ url: string; fileName: string; filePath?: string }>;
  scanCanvasCache: () => Promise<CanvasCacheScanResult>;
  deleteCanvasCacheAssets: (payload: { ids: string[]; olderThanDays?: number }) => Promise<CanvasCacheDeleteResult>;
  revealCanvasCacheAsset: (payload: { id?: string; filePath?: string }) => Promise<{ ok: true }>;
  openCanvasCacheRoot: () => Promise<{ ok: true }>;
  getGenerationTask: (taskId: string) => Promise<unknown | null>;
  createGenerationTask: (payload: unknown) => Promise<unknown>;
  updateGenerationTask: (taskId: string, patch: unknown) => Promise<unknown>;
  resumeGenerationTask: (taskId: string, payload?: unknown) => Promise<unknown>;
  stopGenerationTask: (taskId: string) => Promise<unknown>;
  stopGenerationTasksForTarget: (canvasId: string, target: unknown) => Promise<{ ok: true; tasks: unknown[]; taskIds: string[] }>;
  stopGenerationTasksForNode: (canvasId: string, nodeId: string) => Promise<{ ok: true; tasks: unknown[]; taskIds: string[] }>;
  stopGenerationTasksForCanvas: (canvasId: string) => Promise<{ ok: true; tasks: unknown[]; taskIds: string[] }>;
  writeCanvasClipboard: (payload: unknown) => Promise<{ ok: true }>;
}

export interface CanvasCacheReference {
  canvasId: string;
  canvasTitle: string;
  nodeId?: string;
  nodeTitle?: string;
  source: string;
}

export interface CanvasCacheAsset {
  id: string;
  kind: "input" | "output" | "missing";
  url: string;
  filePath: string;
  fileName: string;
  sizeBytes: number;
  modifiedAt: number;
  exists: boolean;
  referenced: boolean;
  references: CanvasCacheReference[];
}

export interface CanvasCacheScanResult {
  rootPath: string;
  scannedAt: number;
  assets: CanvasCacheAsset[];
  missingReferences: CanvasCacheAsset[];
  totals: {
    inputCount: number;
    inputBytes: number;
    outputCount: number;
    outputBytes: number;
    referencedCount: number;
    referencedBytes: number;
    cleanableCount: number;
    cleanableBytes: number;
    missingReferenceCount: number;
  };
}

export interface CanvasCacheDeleteResult {
  ok: true;
  deletedCount: number;
  skippedCount: number;
  failedCount: number;
  freedBytes: number;
  failures: Array<{ id: string; message: string }>;
}

export interface ImageReviewImage {
  id: string;
  name: string;
  relativePath: string;
  url: string;
  size: number;
  lastModified: number;
}

export interface ImageReviewProduct {
  id: string;
  hasModelImages: boolean;
  modelImages: ImageReviewImage[];
  detailImages: ImageReviewImage[];
  unknownImages: ImageReviewImage[];
}

export interface ImageReviewApi {
  products: (payload: { root: string; modelFolders: string }) => Promise<{ products: ImageReviewProduct[] }>;
  productImages: (payload: { root: string; productId: string; modelFolders: string; detailFolders: string }) => Promise<{ product: ImageReviewProduct }>;
  loadIssue: (payload: { root: string; path: string }) => Promise<{ issue: string }>;
  saveIssue: (payload: { root: string; path: string; issue: string }) => Promise<{ ok: true }>;
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

export interface LibtvWorkspaceRecord {
  id: string;
  name: string;
  fileCnt?: number;
}

export interface LibtvProjectRecord {
  uuid: string;
  name: string;
}

export interface LibtvImageModelRecord {
  modelKey: string;
  modelName: string;
}

export interface LibtvImageGenerationResult {
  ok: true;
  url: string;
  localUrl: string;
  fileName: string;
  filePath?: string;
  remoteNodeId: string;
  remoteNodeTitle?: string;
  remoteReferenceNodeIds: string[];
  remoteReferenceNodeTitles?: string[];
  groupNodeId?: string;
  groupTitle?: string;
  projectUuid?: string;
  projectName?: string;
  createdAt: number;
}

export interface LibtvBatchGenerationFailureResult {
  ok: false;
  id?: string;
  error: string;
  remoteNodeId?: string;
  remoteNodeTitle?: string;
  remoteReferenceNodeIds?: string[];
  remoteReferenceNodeTitles?: string[];
  createdAt: number;
}

export interface LibtvBatchGenerationResult {
  ok: true;
  projectUuid?: string;
  projectName?: string;
  groupNodeId?: string;
  groupTitle?: string;
  results: Array<(LibtvImageGenerationResult & { id?: string }) | LibtvBatchGenerationFailureResult>;
  createdAt: number;
}

export interface LibtvApi {
  status: () => Promise<{ ok: boolean; available: boolean; path?: string; version?: string; error?: string }>;
  install: () => Promise<{ ok: true; path?: string; stdout?: string; stderr?: string }>;
  account: () => Promise<{ ok: boolean; loggedIn: boolean; account?: unknown; error?: string }>;
  accounts: () => Promise<{ ok: boolean; accounts: LibtvAccountRecord[] }>;
  useAccount: (account: string | number) => Promise<{ ok: true }>;
  loginWeb: () => Promise<{ ok: true }>;
  logout: () => Promise<{ ok: true }>;
  workspaces: (payload?: { page?: number; pageSize?: number }) => Promise<{ ok: true; workspaces: LibtvWorkspaceRecord[] }>;
  projects: (payload: { workspaceId: string; page?: number; pageSize?: number }) => Promise<{ ok: true; projects: LibtvProjectRecord[] }>;
  imageModels: () => Promise<{ ok: true; models: LibtvImageModelRecord[] }>;
  generateImage: (payload: {
    workspaceId?: string;
    projectUuid?: string;
    prompt: string;
    modelName: string;
    aspectRatio?: string;
    quality?: string;
    referenceImages?: string[];
    nodeTitle?: string;
    x?: number;
    y?: number;
  }) => Promise<LibtvImageGenerationResult>;
  generateBatch: (payload: {
    workspaceId?: string;
    projectUuid?: string;
    modelName?: string;
    aspectRatio?: string;
    quality?: string;
    groupTitle?: string;
    jobs: Array<{
      id?: string;
      localTargetId?: string;
      prompt: string;
      modelName?: string;
      aspectRatio?: string;
      quality?: string;
      referenceImages?: string[];
      nodeTitle?: string;
      x?: number;
      y?: number;
    }>;
  }) => Promise<LibtvBatchGenerationResult>;
}

declare global {
  interface Window {
    forartConfig?: ForartConfigApi;
    easyTool?: EasyToolApi;
    forartReview?: ImageReviewApi;
    libtv?: LibtvApi;
  }
}

export const DEFAULT_APP_CONFIG: ForartAppConfig = {
  mode: "local",
  localLibraryPath: "",
  serverUrl: "",
  imageDownloadPath: "",
  language: "zh-CN",
};

export function normalizeConfig(input: Partial<ForartAppConfig>): ForartAppConfig {
  return {
    ...DEFAULT_APP_CONFIG,
    ...input,
    mode: input.mode === "remote" ? "remote" : "local",
    localLibraryPath: String(input.localLibraryPath || "").trim(),
    serverUrl: String(input.serverUrl || "").trim().replace(/\/+$/, ""),
    imageDownloadPath: String(input.imageDownloadPath || "").trim(),
    language: input.language === "en-US" ? "en-US" : "zh-CN",
  };
}
