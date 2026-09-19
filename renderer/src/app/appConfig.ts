export type ForartMode = "local" | "remote";
export const TASK_HISTORY_RETENTION_DAY_OPTIONS = [1, 3, 7, 15, 30] as const;
export type TaskHistoryRetentionDays = typeof TASK_HISTORY_RETENTION_DAY_OPTIONS[number];

export interface ForartAppConfig {
  mode: ForartMode;
  localLibraryPath: string;
  serverUrl: string;
  serverAuthUsername: string;
  serverAuthToken: string;
  fileDownloadPath: string;
  /** @deprecated Use fileDownloadPath. Kept for compatibility with older integrations. */
  imageDownloadPath?: string;
  photoshopExecutablePath: string;
  taskHistoryRetentionDays: TaskHistoryRetentionDays;
  language: "zh-CN" | "en-US";
}

// IPC 边界上的 provider 形状与 features/settings/apiProviders 保持同一份定义；
// 归一化规则的唯一实现在主进程 config-store.cjs。
import type { ImagePresetFile } from "../features/infinite-canvas/imagePresets";
import type { ApiProvider, ApiSettings } from "../features/settings/apiProviders";
import type { NativeCanvasImageAdjustments } from "../features/infinite-canvas/imageAdjustments";
export type ForartApiProviderConfig = ApiProvider;
export type ForartApiSettingsConfig = ApiSettings;

export type ForartReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type ForartExtensionReasoningLevel = Exclude<ForartReasoningEffort, "none">;
export interface ForartExtensionModelRoute {
  providerId: string;
  model: string;
}

export interface ForartExtensionSettings {
  backgroundRemovalEnabled: boolean;
  promptOptimizationEnabled: boolean;
  thinkingMode: boolean;
  reasoningLevel: ForartExtensionReasoningLevel;
  imageGeneratorPromptOptimization: ForartExtensionModelRoute | null;
}

/** @deprecated Use the extension-prefixed names. Kept for persisted integrations. */
export type ForartAgentReasoningLevel = ForartExtensionReasoningLevel;
/** @deprecated Use ForartExtensionModelRoute. */
export type ForartAgentModelRoute = ForartExtensionModelRoute;
/** @deprecated Use ForartExtensionSettings. */
export type ForartAgentSettings = ForartExtensionSettings;

export interface ForartImageReviewSettings {
  modelFolders: string;
  detailFolders: string;
}

export interface ForartInfiniteCanvasSettings {
  connectionsVisible: boolean;
  minimapOpen: boolean;
  snapToGrid: boolean;
  promptEditorsExpanded: boolean;
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
  remoteExecutionStartedAt?: number;
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
  listPage: (payload: {
    limit: number;
    offset: number;
    filter: "all" | "active" | "succeeded" | "exceptional";
  }) => Promise<{
    tasks: GenerationTaskDto[];
    total: number;
    counts: { all: number; active: number; succeeded: number; exceptional: number };
  }>;
  start: (executorKind: "api" | "libtv", payload: unknown) => Promise<GenerationTaskDto | null>;
  startMany: (executorKind: "api" | "libtv", payloads: unknown[]) => Promise<GenerationTaskDto[]>;
  stop: (taskId: string) => Promise<unknown>;
  onChanged: (callback: (task: GenerationTaskDto) => void) => () => void;
}

export interface ForartCanvasAgentApi {
  run: (request: { runId: string; task: "smart-reverse" | "optimize-image-generator-prompt" | "generate-action-fission-prompts"; canvasId?: string; nodeId?: string; context: unknown; language?: "zh-CN" | "en-US"; modelRoute?: { providerId: string; model: string }; reasoning?: ForartReasoningEffort }) => Promise<unknown>;
  cancel: (runId: string) => Promise<{ ok: true; canceled: boolean }>;
  listActive: (canvasId?: string) => Promise<Array<{ runId: string; task: "smart-reverse" | "optimize-image-generator-prompt" | "generate-action-fission-prompts"; operation?: string; canvasId: string; nodeId: string; sourcePrompt?: string; stage: string; status: "running"; startedAt: number }>>;
  onProgress: (callback: (progress: { runId: string; task: "smart-reverse" | "optimize-image-generator-prompt" | "generate-action-fission-prompts"; operation?: string; canvasId: string; nodeId: string; sourcePrompt?: string; stage: string; status: "running" | "completed" | "failed" | "canceled"; startedAt: number; result?: unknown; error?: string }) => void) => () => void;
}

export type CanvasTaskCategory = "image" | "video";
export interface CanvasTaskDto {
  id: string;
  category: CanvasTaskCategory;
  operation: "image_generate" | "action_fission_generate";
  canvasId: string;
  nodeId: string;
  rowId?: string;
  providerId?: string;
  providerName?: string;
  model?: string;
  resolution?: string;
  aspectRatio?: string;
  quality?: string;
  executorKind: "api" | "libtv";
  status: "queued" | "running" | "succeeded" | "failed" | "canceled" | "interrupted" | "superseded";
  version: number;
  createdAt: number;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  durationMs?: number;
  errorCode?: string;
  errorMessage?: string;
  resultKind: "image" | "text" | "structured";
  inputFingerprint?: string;
  applicationStatus?: "pending" | "applied" | "stale" | "discarded";
  input?: unknown;
  result?: unknown;
}

export interface ForartCanvasTasksApi {
  listPage: (payload: { category: CanvasTaskCategory; status: "all" | "active" | "succeeded" | "exceptional"; limit: number; offset: number }) => Promise<{ tasks: CanvasTaskDto[]; total: number; counts: { all: number; active: number; succeeded: number; exceptional: number } }>;
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
  recentReleases?: ForartUpdateRelease[];
  connectivity?: ForartUpdateConnectivityResult;
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
  items: ForartUpdateNoteItem[];
  error?: string;
}

export interface ForartUpdateRelease {
  version: string;
  updatedAt: string;
  items: ForartUpdateNoteItem[];
}

export interface ForartUpdateNoteItem {
  category: "new" | "improvement" | "fix";
  text: string;
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

/** 调色预设的读写（整份覆盖）。 */
export interface ForartImagePresetsApi {
  load: () => Promise<ImagePresetFile>;
  save: (payload: ImagePresetFile) => Promise<ImagePresetFile>;
}

export interface ForartConfigApi {
  load: () => Promise<ForartAppConfig | null>;
  save: (config: ForartAppConfig) => Promise<{ ok: true; config: ForartAppConfig }>;
  loadApiSettings: () => Promise<ForartApiSettingsConfig>;
  saveApiSettings: (settings: ForartApiSettingsConfig) => Promise<{ ok: true; apiSettings: ForartApiSettingsConfig }>;
  loadExtensionSettings: () => Promise<ForartExtensionSettings>;
  saveExtensionSettings: (settings: ForartExtensionSettings) => Promise<{ ok: true; extensionSettings: ForartExtensionSettings }>;
  /** @deprecated Use loadExtensionSettings/saveExtensionSettings. */
  loadAgentSettings: () => Promise<ForartExtensionSettings>;
  /** @deprecated Use loadExtensionSettings/saveExtensionSettings. */
  saveAgentSettings: (settings: ForartExtensionSettings) => Promise<{ ok: true; agentSettings: ForartExtensionSettings }>;
  requestProviderModels: (payload: { providerId: string }) => Promise<{ models: string[] }>;
  requestApimartBalance: (payload: { providerId: string }) => Promise<{ status: "idle" | "ready"; remainCredits?: number; usedCredits?: number }>;
  loadImageReviewSettings: () => Promise<ForartImageReviewSettings>;
  saveImageReviewSettings: (settings: ForartImageReviewSettings) => Promise<{ ok: true; imageReview: ForartImageReviewSettings }>;
  loadInfiniteCanvasSettings: () => Promise<ForartInfiniteCanvasSettings>;
  saveInfiniteCanvasSettings: (settings: ForartInfiniteCanvasSettings) => Promise<{ ok: true; infiniteCanvas: ForartInfiniteCanvasSettings }>;
  defaultPaths: () => Promise<{ fileDownloadPath: string }>;
  chooseDirectory: (payload?: { title?: string }) => Promise<{ canceled: boolean; path: string }>;
  chooseFile: (payload?: { title?: string; filterName?: string; extensions?: string[] }) => Promise<{ canceled: boolean; path: string }>;
  testServer: (serverUrl: string) => Promise<{ ok: boolean; status?: number; error?: string; payload?: unknown }>;
  serverLogin: (payload: { serverUrl: string; username: string; password: string }) => Promise<{ ok: boolean; status?: number; error?: string; user?: { id: string; username?: string; name?: string; role?: string }; config?: ForartAppConfig }>;
  serverSession: (payload?: { serverUrl?: string; token?: string }) => Promise<{ ok: boolean; status?: number; error?: string; user?: { id: string; username?: string; name?: string; role?: string }; permissions?: string[] }>;
  serverLogout: () => Promise<{ ok: true; config: ForartAppConfig }>;
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
  openOfficialWebsite: (providerId: "apimart" | "libtv") => Promise<{ ok: boolean }>;
  onMaximizedChanged: (callback: (maximized: boolean) => void) => () => void;
}

export type CanvasTransferType = "export" | "import" | "upload";
export type CanvasTransferPhase = "queued" | "preparing" | "reading" | "scanning" | "packing" | "writing" | "uploading" | "downloading" | "extracting" | "saving" | "working";

export interface CanvasTransferProgress {
  operationId: string;
  transferType: CanvasTransferType;
  phase: CanvasTransferPhase;
  percent: number;
  loadedBytes: number;
  totalBytes: number;
}

export interface CanvasSaveRequest {
  title: string;
  icon: string;
  projectId: string;
  color: string;
  pinned: boolean;
  jsonText: string;
  nodeCount: number;
  allowEmpty: boolean;
  saveSequence: number;
  saveSessionId: string;
  saveSessionStartedAt: number;
}

export interface EasyToolApi {
  backgroundRemovalStatus: () => Promise<{ id: string; downloaded: boolean; downloading: boolean; size: number; downloadedBytes: number }>;
  downloadBackgroundRemovalModel: () => Promise<{ id: string; downloaded: boolean; downloading: boolean; size: number; downloadedBytes: number }>;
  removeBackgroundRemovalModel: () => Promise<{ id: string; downloaded: boolean; downloading: boolean; size: number; downloadedBytes: number }>;
  removeImageBackground: (payload: { filePath?: string; bytes?: Uint8Array }) => Promise<Uint8Array>;
  onBackgroundRemovalModelState: (callback: (state: "loading" | "ready" | "error") => void) => () => void;
  saveResult: (payload: { dataUrl?: string; url?: string; defaultName?: string; directory?: string; convertToPng?: boolean }) => Promise<{ canceled: boolean; filePath?: string }>;
  listCanvases: () => Promise<{
    canvases: Array<{ id: string; title: string; icon?: string; canvasType?: string; source?: string; projectId?: string; color?: string; pinned?: boolean; createdAt: number; updatedAt: number; revision?: number; nodeCount: number }>;
    projects: Array<{ id: string; title: string; color?: string; sortOrder: number; createdAt: number; updatedAt: number }>;
  }>;
  createCanvas: (payload: { title?: string; icon?: string; canvasType?: string; source?: string; projectId?: string; nodes?: unknown[]; connections?: unknown[]; groups?: unknown[]; viewport?: unknown }) => Promise<{ ok: true; canvas: unknown; record: unknown; filePath?: string }>;
  createCanvasProject: (payload: { title?: string; color?: string; sortOrder?: number }) => Promise<{ ok: true; project: unknown }>;
  loadCanvas: (canvasId: string) => Promise<unknown | null>;
  saveCanvas: (canvasId: string, payload: CanvasSaveRequest) => Promise<{ ok: boolean; record?: unknown; skipped?: boolean; stale?: boolean }>;
  updateCanvasMeta: (canvasId: string, patch: { title?: string; icon?: string; projectId?: string; color?: string; pinned?: boolean }) => Promise<{ ok: true; canvas: unknown; record: unknown; filePath?: string }>;
  updateCanvasProject: (projectId: string, patch: { title?: string; color?: string; sortOrder?: number }) => Promise<{ ok: true; project: unknown }>;
  deleteCanvas: (canvasId: string) => Promise<{ ok: true; filePath?: string }>;
  deleteCanvasProject: (projectId: string) => Promise<{ ok: true; deletedCanvasIds?: string[] }>;
  moveCanvasToProject: (canvasId: string, projectId: string) => Promise<{ ok: true; canvas: unknown; record: unknown; filePath?: string }>;
  exportCanvasJson: (canvasId: string, operationId?: string) => Promise<CanvasPackageExportResult>;
  exportCanvasPackage: (canvasId: string, operationId?: string) => Promise<CanvasPackageExportResult>;
  importCanvas: (payload: { projectId?: string; operationId?: string }) => Promise<CanvasPackageImportResult>;
  createCanvasPackageForUpload: (canvasId: string, operationId?: string) => Promise<CanvasPackageExportResult>;
  importCanvasPackageFromPath: (payload: { filePath: string; projectId?: string; operationId?: string }) => Promise<CanvasPackageImportResult>;
  uploadCanvasPackageToRemote: (payload: { filePath: string; uploadUrl: string; operationId?: string }) => Promise<unknown>;
  uploadCanvasToRemote: (payload: { canvasId: string; projectId?: string; uploadUrl: string; operationId?: string; authToken?: string }) => Promise<unknown>;
  downloadCanvasPackageFromRemote: (payload: { downloadUrl: string; operationId?: string }) => Promise<{ ok: true; filePath: string }>;
  copyRemoteCanvasToLocal: (payload: { transferUrl: string; remoteCanvasId: string; projectId?: string; operationId?: string; authToken?: string }) => Promise<unknown>;
  cancelCanvasTransfer: (operationId: string) => Promise<{ ok: true; canceled: boolean }>;
  onCanvasTransferProgress: (callback: (progress: CanvasTransferProgress) => void) => () => void;
  saveCanvasAsset: (payload: { dataUrl?: string; url?: string; defaultName?: string; kind?: "input" | "output"; type?: string }) => Promise<{ url: string; thumbUrl?: string; fileName: string; filePath?: string; thumbFilePath?: string }>;
  captureVideoFrame: (payload: { sourceUrl: string; timeSeconds?: number; mode?: "first" | "last" | "current"; defaultName?: string; kind?: "input" | "output" }) => Promise<{ url: string; thumbUrl?: string; fileName: string; filePath?: string; thumbFilePath?: string; width?: number; height?: number }>;
  saveCanvasAssetThumbnail: (payload: { url?: string; filePath?: string }) => Promise<{ thumbUrl?: string; thumbFilePath?: string }>;
  ensureCanvasAssetThumbnail: (payload: { url?: string; filePath?: string }) => Promise<{ thumbUrl?: string; thumbFilePath?: string }>;
  importCanvasAssetFile: (payload: { file?: File; filePath?: string; fileName?: string; mimeType?: string }) => Promise<{
    url: string;
    thumbUrl?: string;
    thumbFilePath?: string;
    fileName: string;
    storedFileName?: string;
    filePath?: string;
    assetType: "image" | "video";
    mimeType?: string;
    width: number;
    height: number;
    durationMs?: number;
    sizeBytes?: number;
    codec?: string;
  }>;
  /**
   * 裁剪素材。`unit: "percent"` 时 x/y/width/height 是百分比（0-100），
   * 由主进程按源图真实尺寸换算像素；缺省按像素处理。
   */
  cropCanvasAsset: (payload: { url?: string; filePath?: string; unit?: "percent"; x: number; y: number; width: number; height: number; defaultName?: string }) => Promise<{ url: string; thumbUrl?: string; fileName: string; filePath?: string; thumbFilePath?: string; width: number; height: number }>;
  adjustCanvasAsset: (payload: { url?: string; filePath?: string; adjustments: Partial<NativeCanvasImageAdjustments>; defaultName?: string }) => Promise<{ url: string; thumbUrl?: string; fileName: string; filePath?: string; thumbFilePath?: string; width: number; height: number }>;
  scanCanvasCache: () => Promise<CanvasCacheScanResult>;
  deleteCanvasCacheAssets: (payload: { ids: string[] }) => Promise<CanvasCacheDeleteResult>;
  revealCanvasCacheAsset: (payload: { id?: string; filePath?: string }) => Promise<{ ok: true }>;
  openCanvasCacheRoot: () => Promise<{ ok: true }>;
  writeCanvasClipboard: (payload: unknown) => Promise<{ ok: true }>;
  getCanvasClipboardStatus: () => Promise<{ hasImage: boolean; hasNodes: boolean }>;
  pasteCanvasClipboard: () => Promise<{ ok: true }>;
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
  originalUrl: string;
  thumbnailUrl: string;
  previewUrl: string;
  size: number;
  lastModified: number;
  reviewStatus: "approved" | "rejected" | null;
}

export interface ImageReviewProduct {
  id: string;
  hasModelImages: boolean;
  modelImages: ImageReviewImage[];
  detailImages: ImageReviewImage[];
}

export interface ImageReviewApi {
  chooseRoot: (payload?: { title?: string }) => Promise<{ canceled: boolean; path: string }>;
  restoreRoot: (payload: { root: string }) => Promise<{ ok: true; path: string } | { ok: false; path: "" }>;
  products: (payload: { root: string; modelFolders: string }) => Promise<{ products: ImageReviewProduct[] }>;
  productImages: (payload: { root: string; productId: string; modelFolders: string; detailFolders: string; requestPriority: number }) => Promise<{ product: ImageReviewProduct }>;
  setReviewStatus: (payload: {
    root: string;
    productId: string;
    imageRelativePath: string;
    status: "approved" | "rejected" | null;
  }) => Promise<{
    ok: true;
    review: {
      status: "approved" | "rejected" | null;
    };
  }>;
  clearScaledImageCache: () => Promise<{ ok: true }>;
  openProductFolder: (payload: { root: string; productId: string }) => Promise<
    { ok: true } | { ok: false; reason: "product-folder-not-found" | "open-failed" }
  >;
  openInPhotoshop: (payload: { originalUrl: string }) => Promise<
    { ok: true } | { ok: false; reason: "unsupported-platform" | "image-not-found" | "photoshop-not-found" | "launch-failed" }
  >;
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
    forartImagePresets?: ForartImagePresetsApi;
    easyTool?: EasyToolApi;
    forartReview?: ImageReviewApi;
    forartActionImport?: ForartActionImportApi;
    forartLocalApi?: ForartLocalApi;
    forartGenerationTasks?: ForartGenerationTasksApi;
    forartCanvasAgent?: ForartCanvasAgentApi;
    forartCanvasTasks?: ForartCanvasTasksApi;
    libtv?: LibtvApi;
  }
}

export const DEFAULT_APP_CONFIG: ForartAppConfig = {
  mode: "local",
  localLibraryPath: "",
  serverUrl: "",
  serverAuthUsername: "",
  serverAuthToken: "",
  fileDownloadPath: "",
  photoshopExecutablePath: "",
  taskHistoryRetentionDays: 15,
  language: "zh-CN",
};

export function normalizeConfig(input: Partial<ForartAppConfig>): ForartAppConfig {
  return {
    ...DEFAULT_APP_CONFIG,
    ...input,
    mode: input.mode === "remote" ? "remote" : "local",
    localLibraryPath: String(input.localLibraryPath || "").trim(),
    serverUrl: String(input.serverUrl || "").trim().replace(/\/+$/, ""),
    serverAuthUsername: String(input.serverAuthUsername || "").trim(),
    serverAuthToken: String(input.serverAuthToken || "").trim(),
    fileDownloadPath: String(input.fileDownloadPath ?? input.imageDownloadPath ?? "").trim(),
    photoshopExecutablePath: String(input.photoshopExecutablePath || "").trim(),
    taskHistoryRetentionDays: TASK_HISTORY_RETENTION_DAY_OPTIONS.includes(Number(input.taskHistoryRetentionDays) as TaskHistoryRetentionDays)
      ? Number(input.taskHistoryRetentionDays) as TaskHistoryRetentionDays
      : DEFAULT_APP_CONFIG.taskHistoryRetentionDays,
    language: input.language === "en-US" ? "en-US" : "zh-CN",
  };
}
