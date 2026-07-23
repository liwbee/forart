export type ForartMode = "local" | "remote";

export interface ForartAppConfig {
  mode: ForartMode;
  localLibraryPath: string;
  serverUrl: string;
  imageDownloadPath: string;
  language: "zh-CN" | "en-US";
}

export type ForartApiProviderProtocol = "openai" | "compatible" | "gemini";

export interface ForartApiProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  accessKey?: string;
  secretKey?: string;
  protocol: ForartApiProviderProtocol;
  imageRequestMode?: "openai" | "openai-json";
  imageGenerationEndpoint?: string;
  imageEditEndpoint?: string;
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
  providerOrder?: string[];
  libtvMachineId?: string;
  libtvActionFissionConcurrency?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
}

export interface ForartImageReviewSettings {
  modelFolders: string;
  detailFolders: string;
}

export interface ForartInfiniteCanvasSettings {
  connectionsVisible: boolean;
  minimapOpen: boolean;
  snapToGrid: boolean;
  referenceComparisonViewer: {
    referenceComparisonEnabled: boolean;
    referencePanelPercent: number;
  };
}

export type GenerationTaskStatus =
  | "queued"
  | "preparing"
  | "submitting"
  | "running"
  | "result_processing"
  | "succeeded"
  | "failed"
  | "canceled"
  | "interrupted"
  | "superseded";

export interface GenerationTaskDto {
  id: string;
  target: {
    canvasId: string;
    kind: "imageGenerator" | "actionFissionRow";
    nodeId: string;
    rowId?: string;
  };
  executorKind: "api" | "libtv";
  providerId?: string;
  providerName?: string;
  model?: string;
  resolution?: string;
  aspectRatio?: string;
  quality?: string;
  status: GenerationTaskStatus;
  version: number;
  messageCode?: string;
  messageParams?: Record<string, string | number>;
  remoteMessage?: string;
  errorCode?: string;
  errorMessage?: string;
  startedAt: number;
  runningAt?: number;
  updatedAt: number;
  completedAt?: number;
  durationMs?: number;
  result?: {
    images: Array<{
      assetUrl: string;
      thumbUrl?: string;
      fileName?: string;
      width?: number;
      height?: number;
    }>;
  };
}

export interface ForartGenerationTasksApi {
  get: (taskId: string) => Promise<GenerationTaskDto | null>;
  getMany: (taskIds: string[]) => Promise<GenerationTaskDto[]>;
  listForCanvas: (canvasId: string) => Promise<GenerationTaskDto[]>;
  listRecent: (limit?: number) => Promise<GenerationTaskDto[]>;
  start: (executorKind: "api" | "libtv", payload: unknown) => Promise<GenerationTaskDto | null>;
  startMany: (executorKind: "api" | "libtv", payloads: unknown[]) => Promise<GenerationTaskDto[]>;
  stop: (taskId: string) => Promise<unknown>;
  onChanged: (callback: (task: GenerationTaskDto) => void) => () => void;
}

export interface ForartAppInfo {
  name: string;
  repoUrl: string;
  updateUrl: string;
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
  repoUrl: string;
  updateNotes?: ForartUpdateNotes;
  error?: string;
}

export interface ForartUpdateRunResult {
  ok: boolean;
  updated?: string[];
  count?: number;
  version?: string;
  error?: string;
}

export interface ForartUpdateProgress {
  phase: "listing" | "downloading" | "scheduling" | "scheduled" | string;
  percent: number;
  downloadedBytes: number;
  bytesPerSecond: number;
  currentFile: string;
  fileIndex: number;
  fileCount: number;
  fileBytes: number;
  fileTotalBytes: number;
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
  loadInfiniteCanvasSettings: () => Promise<ForartInfiniteCanvasSettings>;
  saveInfiniteCanvasSettings: (settings: ForartInfiniteCanvasSettings) => Promise<{ ok: true; infiniteCanvas: ForartInfiniteCanvasSettings }>;
  defaultPaths: () => Promise<{ imageDownloadPath: string }>;
  chooseDirectory: (payload?: { title?: string }) => Promise<{ canceled: boolean; path: string }>;
  testServer: (serverUrl: string) => Promise<{ ok: boolean; status?: number; error?: string; payload?: unknown }>;
  localServerStatus: () => Promise<{ ok: boolean; managed?: boolean; transport?: "ipc" | "http"; localLibraryPath?: string; status?: number; error?: string; payload?: unknown }>;
  appInfo: () => Promise<ForartAppInfo>;
  checkUpdate: () => Promise<ForartUpdateCheckResult>;
  runUpdate: () => Promise<ForartUpdateRunResult>;
  onUpdateProgress: (callback: (progress: ForartUpdateProgress) => void) => () => void;
  updateConnectivity: () => Promise<ForartUpdateConnectivityResult>;
}

export interface ForartActionImportApi {
  chooseFolder: (payload?: { title?: string }) => Promise<{ canceled: boolean; path: string }>;
  scan: (payload: {
    projectId: string;
    sourcePath: string;
    existingActionNames: string[];
  }) => Promise<import("../features/action-library/actionFolderImportTypes").ActionFolderImportPreview>;
  startScan: (payload: {
    projectId: string;
    scanId?: string;
    sourcePath: string;
    existingActionNames: string[];
  }) => Promise<{ scanId: string }>;
  cancelScan: (payload: { scanId: string }) => Promise<{ ok: true }>;
  readEntry: (payload: {
    previewId: string;
    rowId: string;
  }) => Promise<{
    data: string;
    filename: string;
    mime_type: string;
    prompt: string;
  }>;
  clearPreview: () => Promise<{ ok: true }>;
  onScanProgress: (callback: (payload: {
    scanId: string;
    phase: "discovering" | "building";
    sourcePath: string;
    processedFiles?: number;
    totalFiles?: number;
    builtRows?: number;
    totalRows?: number;
    rows: import("../features/action-library/actionFolderImportTypes").ActionFolderImportRow[];
    summary: import("../features/action-library/actionFolderImportTypes").ActionFolderImportPreview;
  }) => void) => () => void;
  onScanComplete: (callback: (payload: {
    scanId: string;
    preview: import("../features/action-library/actionFolderImportTypes").ActionFolderImportPreview;
  }) => void) => () => void;
  onScanError: (callback: (payload: {
    scanId: string;
    message: string;
  }) => void) => () => void;
}

export interface ForartWindowApi {
  isMaximized: () => Promise<{ ok: boolean; maximized: boolean }>;
  minimize: () => Promise<{ ok: boolean }>;
  toggleMaximize: () => Promise<{ ok: boolean; maximized?: boolean }>;
  close: () => Promise<{ ok: boolean }>;
  onMaximizedChanged: (callback: (maximized: boolean) => void) => () => void;
}

export interface EasyToolApi {
  saveResult: (payload: { dataUrl?: string; url?: string; defaultName?: string; directory?: string }) => Promise<{ canceled: boolean; filePath?: string }>;
  listCanvases: () => Promise<{
    canvases: Array<{ id: string; title: string; icon?: string; canvasType?: string; source?: string; projectId?: string; color?: string; pinned?: boolean; createdAt: number; updatedAt: number; revision?: number; nodeCount: number }>;
    projects: Array<{ id: string; title: string; color?: string; sortOrder: number; createdAt: number; updatedAt: number }>;
  }>;
  createCanvas: (payload: { title?: string; icon?: string; canvasType?: string; source?: string; projectId?: string; nodes?: unknown[]; connections?: unknown[]; groups?: unknown[]; viewport?: unknown }) => Promise<{ ok: true; canvas: unknown; record: unknown; filePath?: string }>;
  createCanvasProject: (payload: { title?: string; color?: string; sortOrder?: number }) => Promise<{ ok: true; project: unknown }>;
  loadCanvas: (canvasId: string) => Promise<unknown | null>;
  saveCanvas: (canvasId: string, payload: unknown) => Promise<{ ok: true; canvas: unknown; record: unknown; filePath?: string }>;
  updateCanvasMeta: (canvasId: string, patch: { title?: string; icon?: string; projectId?: string; color?: string; pinned?: boolean }) => Promise<{ ok: true; canvas: unknown; record: unknown; filePath?: string }>;
  updateCanvasProject: (projectId: string, patch: { title?: string; color?: string; sortOrder?: number }) => Promise<{ ok: true; project: unknown }>;
  deleteCanvas: (canvasId: string) => Promise<{ ok: true; filePath?: string }>;
  deleteCanvasProject: (projectId: string) => Promise<{ ok: true; deletedCanvasIds?: string[] }>;
  moveCanvasToProject: (canvasId: string, projectId: string) => Promise<{ ok: true; canvas: unknown; record: unknown; filePath?: string }>;
  exportCanvasJson: (canvasId: string) => Promise<CanvasPackageExportResult>;
  exportCanvasPackage: (canvasId: string) => Promise<CanvasPackageExportResult>;
  importCanvas: (payload: { projectId?: string }) => Promise<CanvasPackageImportResult>;
  createCanvasPackageForUpload: (canvasId: string) => Promise<CanvasPackageExportResult>;
  importCanvasPackageFromPath: (payload: { filePath: string; projectId?: string }) => Promise<CanvasPackageImportResult>;
  uploadCanvasPackageToRemote: (payload: { filePath: string; uploadUrl: string }) => Promise<unknown>;
  downloadCanvasPackageFromRemote: (payload: { downloadUrl: string }) => Promise<{ ok: true; filePath: string }>;
  saveCanvasAsset: (payload: { dataUrl?: string; url?: string; defaultName?: string; kind?: "input" | "output"; type?: string }) => Promise<{ url: string; thumbUrl?: string; fileName: string; filePath?: string; thumbFilePath?: string }>;
  saveCanvasAssetThumbnail: (payload: { url?: string; filePath?: string }) => Promise<{ thumbUrl?: string; thumbFilePath?: string }>;
  ensureCanvasAssetThumbnail: (payload: { url?: string; filePath?: string }) => Promise<{ thumbUrl?: string; thumbFilePath?: string }>;
  cropCanvasAsset: (payload: { url?: string; filePath?: string; x: number; y: number; width: number; height: number; defaultName?: string }) => Promise<{ url: string; thumbUrl?: string; fileName: string; filePath?: string; thumbFilePath?: string; width: number; height: number }>;
  scanCanvasCache: () => Promise<CanvasCacheScanResult>;
  deleteCanvasCacheAssets: (payload: { ids: string[] }) => Promise<CanvasCacheDeleteResult>;
  revealCanvasCacheAsset: (payload: { id?: string; filePath?: string }) => Promise<{ ok: true }>;
  openCanvasCacheRoot: () => Promise<{ ok: true }>;
  writeCanvasClipboard: (payload: unknown) => Promise<{ ok: true }>;
}

export interface CanvasPackageWarning {
  source?: string;
  url?: string;
  message: string;
}

export interface CanvasPackageExportResult {
  ok: true;
  canceled?: boolean;
  filePath?: string;
  warnings?: CanvasPackageWarning[];
}

export interface CanvasPackageImportResult {
  ok: true;
  canceled?: boolean;
  canvas?: unknown;
  record?: unknown;
  filePath?: string;
  warnings?: CanvasPackageWarning[];
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
  thumbUrl?: string;
  thumbFilePath?: string;
  thumbSizeBytes?: number;
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
}

export interface ImageReviewApi {
  chooseRoot: (payload?: { title?: string }) => Promise<{ canceled: boolean; path: string }>;
  products: (payload: { root: string; modelFolders: string }) => Promise<{ products: ImageReviewProduct[] }>;
  productImages: (payload: { root: string; productId: string; modelFolders: string; detailFolders: string }) => Promise<{ product: ImageReviewProduct }>;
}

export interface ForartLocalApiRequestPayload {
  path: string;
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface ForartLocalApiResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

export interface ForartLocalApi {
  request: (payload: ForartLocalApiRequestPayload) => Promise<ForartLocalApiResponse>;
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

export interface LibtvApi {
  status: () => Promise<{ ok: boolean; available: boolean; path?: string; version?: string; error?: string }>;
  install: () => Promise<{ ok: true; path?: string; stdout?: string; stderr?: string }>;
  account: () => Promise<{ ok: boolean; loggedIn: boolean; account?: unknown; error?: string }>;
  accounts: () => Promise<{ ok: boolean; accounts: LibtvAccountRecord[] }>;
  power: () => Promise<{ ok: true; total: number | null; remaining: number | null }>;
  useAccount: (account: string | number) => Promise<{ ok: true }>;
  loginWeb: () => Promise<{ ok: true }>;
  logout: () => Promise<{ ok: true }>;
  workspaces: (payload?: { page?: number; pageSize?: number }) => Promise<{ ok: true; workspaces: LibtvWorkspaceRecord[] }>;
  projects: (payload: { workspaceId: string; page?: number; pageSize?: number }) => Promise<{ ok: true; projects: LibtvProjectRecord[] }>;
  imageModels: () => Promise<{ ok: true; models: LibtvImageModelRecord[] }>;
  imageModelSchema: (payload: { model: string }) => Promise<Record<string, unknown> & { ok: true }>;
}

declare global {
  interface Window {
    forartWindow?: ForartWindowApi;
    forartConfig?: ForartConfigApi;
    easyTool?: EasyToolApi;
    forartReview?: ImageReviewApi;
    forartActionImport?: ForartActionImportApi;
    forartLocalApi?: ForartLocalApi;
    forartGenerationTasks?: ForartGenerationTasksApi;
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
