import { ChevronDown, Download, FolderOpen, GripVertical, HardDrive, KeyRound, LogIn, LogOut, Plus, RefreshCw, Settings, TestTube2, Trash2 } from "lucide-react";
import { PointerEvent, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { ForartAppConfig, ForartMode, normalizeConfig, type CanvasCacheAsset, type CanvasCacheDeleteResult, type CanvasCacheScanResult, type LibtvAccountRecord } from "../../app/appConfig";
import { Select } from "../../components/Select";
import { createApiProvider, getModelDisplayName, loadApiSettings, normalizeApiProvider, readApiProviders, saveApiSettings, uniqueModels, type ApiModelKind, type ApiProvider } from "./apiProviders";
import { detectImageModelRuleId, IMAGE_MODEL_RULES, normalizeImageModelRuleId } from "./imageModelRules";

interface SettingsPageProps {
  config: ForartAppConfig;
  onConfigChange: (config: ForartAppConfig) => void;
}

interface StatusState {
  tone: "idle" | "ready" | "error" | "busy";
  text: string;
}

type SettingsTab = "general" | "api" | "cache";
type ApiSettingsPane = "provider" | "libtv";
type ApiAction = "verify" | "fetch" | "libtv-check" | "libtv-install" | "libtv-login" | "libtv-logout" | "";
type CacheAction = "scan" | "delete" | "delete-old" | "open-root" | "";
type CacheKindFilter = "all" | "input" | "output";
type CacheStatusFilter = "all" | "referenced" | "cleanable" | "missing";
type ApiSidebarItem = { id: "libtv"; type: "libtv" } | { id: string; type: "provider"; provider: ApiProvider };
interface ApiSidebarDragOverlay {
  item: ApiSidebarItem;
  top: number;
  width: number;
}

interface FetchedModelEntry {
  id: string;
  kind: ApiModelKind;
  selected: boolean;
}

interface LibtvAccountSummary {
  accountName: string;
  memberName: string;
  updatedAt: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function accountText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function formatLibtvUpdatedAt(date = new Date()) {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function summarizeLibtvAccount(account: unknown): LibtvAccountSummary {
  const root = asRecord(account);
  const user = asRecord(root?.user);
  const activeAccount = asRecord(root?.activeAccount);
  const memberAccount = asRecord(activeAccount?.memberAccount);
  return {
    accountName: accountText(activeAccount?.accountName, memberAccount?.memberName, user?.nickname),
    memberName: accountText(memberAccount?.memberName, activeAccount?.memberName, root?.memberName),
    updatedAt: formatLibtvUpdatedAt(),
  };
}

function libtvAccountTypeLabel(account: LibtvAccountRecord, t: (key: string) => string) {
  return account.accountType === 2 ? t("settings:libtvTeamAccount") : t("settings:libtvPersonalAccount");
}

function apiProviderProtocolLabel(provider: ApiProvider, t: (key: string) => string) {
  if (provider.protocol === "gemini") return t("settings:protocolGemini");
  if (provider.protocol === "compatible") return t("settings:protocolCompatible");
  return t("settings:protocolOpenAI");
}

function normalizeProviderOrder(order: string[] | undefined, providers: ApiProvider[]) {
  const validIds = new Set(["libtv", ...providers.map((provider) => provider.id)]);
  const next = (order || []).map(String).filter((id, index, ids) => validIds.has(id) && ids.indexOf(id) === index);
  providers.forEach((provider) => {
    if (!next.includes(provider.id)) next.push(provider.id);
  });
  if (!next.includes("libtv")) next.unshift("libtv");
  return next;
}

function sameAppConfig(left: ForartAppConfig, right: ForartAppConfig) {
  return left.mode === right.mode
    && left.localLibraryPath === right.localLibraryPath
    && left.imageDownloadPath === right.imageDownloadPath
    && left.serverUrl === right.serverUrl
    && left.language === right.language;
}

function formatModelsUrl(provider: ApiProvider) {
  const rawBaseUrl = provider.baseUrl.trim();
  if (!rawBaseUrl) throw new Error("base-url-required");
  if (!/^https?:\/\//i.test(rawBaseUrl)) throw new Error("base-url-invalid");
  const baseUrl = rawBaseUrl.replace(/\/+$/, "");
  if (/\/models(?:\?.*)?$/i.test(baseUrl)) return baseUrl;
  if (provider.protocol === "gemini") {
    return baseUrl.endsWith("/v1beta") ? `${baseUrl}/models` : `${baseUrl}/v1beta/models`;
  }
  return baseUrl.endsWith("/v1") ? `${baseUrl}/models` : `${baseUrl}/v1/models`;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatCacheTime(timestamp: number) {
  if (!timestamp) return "-";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function modelValueToId(item: unknown): string {
  if (typeof item === "string") return item;
  if (!item || typeof item !== "object") return "";
  const record = item as Record<string, unknown>;
  const value = record.id || record.name || record.model || record.model_id || record.modelId;
  return typeof value === "string" ? value.replace(/^models\//, "") : "";
}

function extractModelIds(payload: unknown) {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
  const source = Array.isArray(payload)
    ? payload
    : Array.isArray(record?.data)
      ? record.data
      : Array.isArray(record?.models)
        ? record.models
        : Array.isArray(record?.list)
          ? record.list
          : Array.isArray(record?.model_list)
            ? record.model_list
            : [];
  return uniqueModels(source.map(modelValueToId));
}

function classifyModel(id: string): ApiModelKind {
  const text = id.toLowerCase();
  if (/(image|img|dall-e|gpt-image|flux|sdxl|stable-diffusion|seedream|midjourney|ideogram|recraft|qwen-image|kolors|hidream|imagen)/i.test(text)) return "image";
  if (/(video|veo|sora|seedance|wan|kling|hailuo|runway|pika|luma|t2v|i2v)/i.test(text)) return "video";
  return "chat";
}

function LibtvLogo() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="77" height="17" fill="currentColor" viewBox="0 0 76.234 16.79" aria-hidden="true">
      <path d="M16.576 16.616H0l.833-4.418H17.65z" />
      <path d="m0 16.616 2.314-12.27h4.448l-2.316 12.27zM8.27 0h16.936l-.832 4.416H7.544z" />
      <path d="m25.206 0-2.314 12.27-4.512.002L20.76 0zM30.857 14.816 33.09 2.217h2.7l-1.82 10.276h4.968l-.415 2.321h-7.666zM41.025 6.328h2.556l-1.639 8.488h-2.537l1.619-8.488zm.235-2.51c0-.882.701-1.547 1.566-1.547.81 0 1.367.54 1.367 1.315 0 .882-.702 1.547-1.566 1.547-.81 0-1.367-.54-1.367-1.314M53.696 9.488c0 3.077-2.232 5.435-4.933 5.435-1.458 0-2.268-.559-2.735-1.296l-.45 1.189h-2.232L45.56 2.217h2.538l-.738 4.265c.63-.63 1.44-1.025 2.555-1.025 2.214 0 3.78 1.71 3.78 4.03m-2.574.198c0-1.422-.756-2.16-1.87-2.16-1.657 0-2.7 1.547-2.7 3.168 0 1.421.774 2.16 1.89 2.16 1.638 0 2.682-1.548 2.682-3.168zM53.929 2.217h9.934l-.395 2.321H59.85L58.03 14.814h-2.699l1.819-10.276h-3.618zM72.934 2.217h2.879l-6.497 12.599h-3.222L64.042 2.217h2.772l1.368 9.322z" />
    </svg>
  );
}

export function SettingsPage({ config, onConfigChange }: SettingsPageProps) {
  const { i18n, t } = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [mode, setMode] = useState<ForartMode>(config.mode);
  const [runModeExpanded, setRunModeExpanded] = useState(false);
  const [localLibraryPath, setLocalLibraryPath] = useState(config.localLibraryPath);
  const [imageDownloadPath, setImageDownloadPath] = useState(config.imageDownloadPath);
  const [defaultImageDownloadPath, setDefaultImageDownloadPath] = useState("");
  const [serverUrl, setServerUrl] = useState(config.serverUrl);
  const [status, setStatus] = useState<StatusState>({ tone: "idle", text: t("settings:connectionChecking") });
  const didMountGeneralSettings = useRef(false);
  const savingConfigRef = useRef(false);
  const pendingSaveRef = useRef(false);
  const [apiProviders, setApiProviders] = useState<ApiProvider[]>(readApiProviders);
  const [apiProviderOrder, setApiProviderOrder] = useState<string[]>(() => normalizeProviderOrder([], readApiProviders()));
  const [draggedApiSidebarItemId, setDraggedApiSidebarItemId] = useState("");
  const [apiSidebarDragOverlay, setApiSidebarDragOverlay] = useState<ApiSidebarDragOverlay | null>(null);
  const [apiSidebarInsertIndex, setApiSidebarInsertIndex] = useState<number | null>(null);
  const apiSidebarInsertIndexRef = useRef<number | null>(null);
  const apiSidebarListRef = useRef<HTMLDivElement | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState(() => readApiProviders()[0]?.id || "");
  const [activeApiPane, setActiveApiPane] = useState<ApiSettingsPane>("provider");
  const [apiAction, setApiAction] = useState<ApiAction>("");
  const [apiStatus, setApiStatus] = useState<StatusState>({ tone: "idle", text: t("settings:apiActionReady") });
  const [libtvStatus, setLibtvStatus] = useState<StatusState>({ tone: "idle", text: t("settings:libtvStatusIdle") });
  const [libtvLoggedIn, setLibtvLoggedIn] = useState(false);
  const [libtvAvailable, setLibtvAvailable] = useState(false);
  const [libtvAccount, setLibtvAccount] = useState<LibtvAccountSummary | null>(null);
  const [libtvAccounts, setLibtvAccounts] = useState<LibtvAccountRecord[]>([]);
  const [activeLibtvAccountId, setActiveLibtvAccountId] = useState("");
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelPickerFilter, setModelPickerFilter] = useState("");
  const [modelPickerTab, setModelPickerTab] = useState<ApiModelKind | "all">("all");
  const [fetchedModels, setFetchedModels] = useState<FetchedModelEntry[]>([]);
  const [cacheScan, setCacheScan] = useState<CanvasCacheScanResult | null>(null);
  const [cacheAction, setCacheAction] = useState<CacheAction>("");
  const [cacheStatus, setCacheStatus] = useState<StatusState>({ tone: "idle", text: "Ready" });
  const [cacheKindFilter, setCacheKindFilter] = useState<CacheKindFilter>("all");
  const [cacheStatusFilter, setCacheStatusFilter] = useState<CacheStatusFilter>("all");
  const [cacheCanvasFilter, setCacheCanvasFilter] = useState("all");
  const [selectedCacheAssetIds, setSelectedCacheAssetIds] = useState<Set<string>>(new Set());
  const [apiSettingsLoaded, setApiSettingsLoaded] = useState(false);
  const selectedProvider = apiProviders.find((provider) => provider.id === selectedProviderId) || apiProviders[0] || null;
  const cacheAssets = useMemo(() => {
    if (!cacheScan) return [];
    return [...cacheScan.assets, ...cacheScan.missingReferences];
  }, [cacheScan]);
  const cacheCanvasOptions = useMemo(() => {
    const byId = new Map<string, string>();
    cacheAssets.forEach((asset) => {
      asset.references.forEach((reference) => {
        if (reference.canvasId) byId.set(reference.canvasId, reference.canvasTitle || reference.canvasId);
      });
    });
    return Array.from(byId.entries()).map(([id, title]) => ({ value: id, label: title })).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }));
  }, [cacheAssets]);
  const filteredCacheAssets = useMemo(() => {
    return cacheAssets.filter((asset) => {
      if (cacheKindFilter !== "all" && asset.kind !== cacheKindFilter) return false;
      if (cacheStatusFilter === "referenced" && (!asset.exists || !asset.referenced)) return false;
      if (cacheStatusFilter === "cleanable" && (!asset.exists || asset.referenced)) return false;
      if (cacheStatusFilter === "missing" && asset.exists) return false;
      if (cacheCanvasFilter !== "all" && !asset.references.some((reference) => reference.canvasId === cacheCanvasFilter)) return false;
      return true;
    });
  }, [cacheAssets, cacheCanvasFilter, cacheKindFilter, cacheStatusFilter]);
  const selectedCacheAssets = useMemo(() => cacheAssets.filter((asset) => selectedCacheAssetIds.has(asset.id)), [cacheAssets, selectedCacheAssetIds]);
  const selectedCleanableCacheAssets = useMemo(() => selectedCacheAssets.filter((asset) => asset.exists && !asset.referenced), [selectedCacheAssets]);
  const apiSidebarItems = useMemo<ApiSidebarItem[]>(() => {
    const providersById = new Map(apiProviders.map((provider) => [provider.id, provider]));
    return normalizeProviderOrder(apiProviderOrder, apiProviders).reduce<ApiSidebarItem[]>((items, id) => {
      if (id === "libtv") return [...items, { id: "libtv", type: "libtv" }];
      const provider = providersById.get(id);
      return provider ? [...items, { id, type: "provider", provider }] : items;
    }, []);
  }, [apiProviderOrder, apiProviders]);
  useEffect(() => {
    if (savingConfigRef.current) return;
    setMode(config.mode);
    setLocalLibraryPath(config.localLibraryPath);
    setImageDownloadPath(config.imageDownloadPath);
    setServerUrl(config.serverUrl);
  }, [config]);

  useEffect(() => {
    let canceled = false;
    async function loadDefaultPaths() {
      const paths = await window.forartConfig?.defaultPaths().catch(() => null);
      if (!canceled && paths?.imageDownloadPath) setDefaultImageDownloadPath(paths.imageDownloadPath);
    }
    void loadDefaultPaths();
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    let canceled = false;
    async function loadStoredApiSettings() {
      const settings = await loadApiSettings();
      if (canceled) return;
      setApiProviders(settings.providers);
      setApiProviderOrder(normalizeProviderOrder(settings.providerOrder, settings.providers));
      setSelectedProviderId((current) => (
        current && settings.providers.some((provider) => provider.id === current)
          ? current
          : settings.providers[0]?.id || ""
      ));
      setApiSettingsLoaded(true);
    }
    void loadStoredApiSettings();
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (!apiSettingsLoaded) return;
    const nextOrder = normalizeProviderOrder(apiProviderOrder, apiProviders);
    if (nextOrder.join("\n") !== apiProviderOrder.join("\n")) {
      setApiProviderOrder(nextOrder);
      return;
    }
    void saveApiSettings({ providers: apiProviders, providerOrder: nextOrder });
    if (apiProviders.length && !apiProviders.some((provider) => provider.id === selectedProviderId)) {
      setSelectedProviderId(apiProviders[0].id);
    }
    if (!apiProviders.length && selectedProviderId) setSelectedProviderId("");
  }, [apiProviderOrder, apiProviders, apiSettingsLoaded, selectedProviderId]);

  useEffect(() => {
    setApiStatus({ tone: "idle", text: t("settings:apiActionReady") });
    setApiAction("");
    setModelPickerOpen(false);
    setFetchedModels([]);
    setModelPickerFilter("");
    setModelPickerTab("all");
  }, [selectedProviderId, t]);

  useEffect(() => {
    if (activeTab !== "api" || activeApiPane !== "libtv" || !window.libtv?.status) return;
    void refreshLibtvStatus();
  }, [activeTab, activeApiPane]);

  useEffect(() => {
    setCacheStatus({ tone: "idle", text: t("settings:cacheReady") });
  }, [t]);

  useEffect(() => {
    if (activeTab !== "cache" || cacheScan || cacheAction) return;
    void scanCanvasCache();
  }, [activeTab, cacheScan, cacheAction]);

  useEffect(() => {
    if (!didMountGeneralSettings.current) {
      didMountGeneralSettings.current = true;
      void refreshConnectionStatus(config.mode, config.serverUrl);
      return;
    }

    const timeout = window.setTimeout(() => {
      void saveGeneralSettings();
    }, 450);

    return () => window.clearTimeout(timeout);
  }, [mode, localLibraryPath, imageDownloadPath, serverUrl, i18n.language]);

  async function chooseDirectory() {
    const result = await window.forartConfig?.chooseDirectory();
    if (result && !result.canceled) setLocalLibraryPath(result.path);
  }

  async function chooseImageDownloadDirectory() {
    const result = await window.forartConfig?.chooseDirectory();
    if (result && !result.canceled) setImageDownloadPath(result.path);
  }

  async function refreshConnectionStatus(nextMode = mode, nextServerUrl = serverUrl) {
    if (nextMode === "local") {
      setStatus({ tone: "busy", text: t("settings:localStatusBusy") });
      const result = await window.forartConfig?.localServerStatus();
      if (result?.ok) {
        setStatus({
          tone: "ready",
          text: result.transport === "ipc" ? t("settings:serverOk") : result.managed ? t("settings:localStatusManaged") : t("settings:localStatusExternal"),
        });
        return;
      }
      setStatus({ tone: "error", text: result?.error || t("settings:localStatusDisconnected") });
      return;
    }

    const trimmedServerUrl = nextServerUrl.trim();
    if (!trimmedServerUrl) {
      setStatus({ tone: "idle", text: t("settings:serverUrlRequired") });
      return;
    }

    setStatus({ tone: "busy", text: t("settings:testingServer") });
    const result = await window.forartConfig?.testServer(trimmedServerUrl);
    if (result?.ok) {
      setStatus({ tone: "ready", text: t("settings:serverOk") });
      return;
    }
    setStatus({ tone: "error", text: result?.error || `${t("settings:connectionFailed")}${result?.status ? ` (${result.status})` : ""}` });
  }

  async function saveGeneralSettings() {
    const nextConfig = normalizeConfig({ mode, localLibraryPath, imageDownloadPath, serverUrl, language: i18n.language === "en-US" ? "en-US" : "zh-CN" });

    if (nextConfig.mode === "local" && !nextConfig.localLibraryPath) {
      setStatus({ tone: "error", text: t("settings:localPathRequired") });
      return;
    }

    if (nextConfig.mode === "remote" && !nextConfig.serverUrl) {
      setStatus({ tone: "error", text: t("settings:serverUrlRequired") });
      return;
    }

    if (savingConfigRef.current) {
      pendingSaveRef.current = true;
      return;
    }

    if (sameAppConfig(nextConfig, config)) {
      void refreshConnectionStatus(nextConfig.mode, nextConfig.serverUrl);
      return;
    }

    savingConfigRef.current = true;
    try {
      const result = await window.forartConfig?.save(nextConfig);
      const savedConfig = result?.config || nextConfig;
      onConfigChange(savedConfig);
      await refreshConnectionStatus(savedConfig.mode, savedConfig.serverUrl);
    } catch (error) {
      setStatus({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      savingConfigRef.current = false;
      if (pendingSaveRef.current) {
        pendingSaveRef.current = false;
        void saveGeneralSettings();
      }
    }
  }

  async function scanCanvasCache(nextStatus?: StatusState) {
    setCacheAction("scan");
    setCacheStatus({ tone: "busy", text: t("settings:cacheScanning") });
    try {
      if (!window.easyTool?.scanCanvasCache) throw new Error("Canvas cache bridge is not available.");
      const result = await window.easyTool.scanCanvasCache();
      setCacheScan(result);
      setSelectedCacheAssetIds(new Set());
      setCacheStatus(nextStatus || { tone: "ready", text: t("settings:cacheScanComplete", { count: result.assets.length, cleanable: result.totals.cleanableCount }) });
    } catch (error) {
      setCacheStatus({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setCacheAction("");
    }
  }

  async function deleteCacheAssets(assets: CanvasCacheAsset[], action: CacheAction, olderThanDays?: number) {
    const cleanable = assets.filter((asset) => asset.exists && !asset.referenced);
    if (!cleanable.length) {
      setCacheStatus({ tone: "idle", text: t("settings:cacheNoCleanableSelected") });
      return;
    }
    const totalBytes = cleanable.reduce((sum, asset) => sum + asset.sizeBytes, 0);
    const message = olderThanDays
      ? t("settings:cacheDeleteOldConfirm", { count: cleanable.length, size: formatBytes(totalBytes), days: olderThanDays })
      : t("settings:cacheDeleteConfirm", { count: cleanable.length, size: formatBytes(totalBytes) });
    if (!window.confirm(message)) return;

    setCacheAction(action);
    setCacheStatus({ tone: "busy", text: t("settings:cacheDeleting") });
    try {
      if (!window.easyTool?.deleteCanvasCacheAssets) throw new Error("Canvas cache bridge is not available.");
      const result: CanvasCacheDeleteResult = await window.easyTool.deleteCanvasCacheAssets({ ids: cleanable.map((asset) => asset.id), olderThanDays });
      await scanCanvasCache({
        tone: result.failedCount ? "error" : "ready",
        text: t("settings:cacheDeleteComplete", {
          deleted: result.deletedCount,
          skipped: result.skippedCount,
          failed: result.failedCount,
          size: formatBytes(result.freedBytes),
        }),
      });
    } catch (error) {
      setCacheStatus({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setCacheAction("");
    }
  }

  async function openCanvasCacheRoot() {
    setCacheAction("open-root");
    try {
      if (!window.easyTool?.openCanvasCacheRoot) throw new Error("Canvas cache bridge is not available.");
      await window.easyTool.openCanvasCacheRoot();
    } catch (error) {
      setCacheStatus({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setCacheAction("");
    }
  }

  async function revealCanvasCacheAsset(asset: CanvasCacheAsset) {
    try {
      if (!window.easyTool?.revealCanvasCacheAsset) throw new Error("Canvas cache bridge is not available.");
      await window.easyTool.revealCanvasCacheAsset({ id: asset.id, filePath: asset.filePath });
    } catch (error) {
      setCacheStatus({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  function toggleCacheAssetSelection(asset: CanvasCacheAsset) {
    if (!asset.exists || asset.referenced) return;
    setSelectedCacheAssetIds((current) => {
      const next = new Set(current);
      if (next.has(asset.id)) next.delete(asset.id);
      else next.add(asset.id);
      return next;
    });
  }

  function addApiProvider() {
    setApiProviders((current) => {
      const provider = createApiProvider(current);
      setSelectedProviderId(provider.id);
      setActiveApiPane("provider");
      setApiProviderOrder((order) => normalizeProviderOrder([...order, provider.id], [...current, provider]));
      return [...current, provider];
    });
  }

  function applyApiSidebarOrder(nextOrder: string[]) {
    setApiProviderOrder(nextOrder);
    setApiProviders((current) => {
      const providerById = new Map(current.map((provider) => [provider.id, provider]));
      return nextOrder
        .filter((id) => id !== "libtv")
        .map((id) => providerById.get(id))
        .filter((provider): provider is ApiProvider => Boolean(provider));
    });
  }

  function getApiSidebarInsertIndex(container: HTMLElement, clientY: number, sourceId: string) {
    const cards = Array.from(container.querySelectorAll<HTMLElement>(":scope > .settings-api-provider-card[data-sidebar-item-id]"));
    const currentOrder = normalizeProviderOrder(apiProviderOrder, apiProviders);
    const sourceIndex = currentOrder.indexOf(sourceId);
    const visibleCards = cards.filter((card) => card.dataset.sidebarItemId !== sourceId);
    let compactIndex = visibleCards.length;
    for (let index = 0; index < visibleCards.length; index += 1) {
      const rect = visibleCards[index].getBoundingClientRect();
      if (clientY <= rect.top + rect.height / 2) {
        compactIndex = index;
        break;
      }
    }
    return sourceIndex >= 0 && compactIndex >= sourceIndex ? compactIndex + 1 : compactIndex;
  }

  function setApiSidebarInsertIndexValue(index: number | null) {
    apiSidebarInsertIndexRef.current = index;
    setApiSidebarInsertIndex(index);
  }

  function moveApiSidebarItemToIndex(sourceId: string, insertIndex: number) {
    if (!sourceId) return;
    const currentOrder = normalizeProviderOrder(apiProviderOrder, apiProviders);
    const sourceIndex = currentOrder.indexOf(sourceId);
    if (sourceIndex < 0) return;
    const nextOrder = currentOrder.filter((id) => id !== sourceId);
    const adjustedIndex = Math.max(0, Math.min(insertIndex > sourceIndex ? insertIndex - 1 : insertIndex, nextOrder.length));
    nextOrder.splice(adjustedIndex, 0, sourceId);
    applyApiSidebarOrder(nextOrder);
  }

  function finishApiSidebarDrag(sourceId: string, insertIndex: number | null) {
    setDraggedApiSidebarItemId("");
    setApiSidebarDragOverlay(null);
    setApiSidebarInsertIndexValue(null);
    if (insertIndex !== null) moveApiSidebarItemToIndex(sourceId, insertIndex);
  }

  function handleApiSidebarPointerDown(event: PointerEvent<HTMLElement>, id: string) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const list = apiSidebarListRef.current;
    if (!list) return;
    const sourceId = id;
    const sourceItem = apiSidebarItems.find((item) => item.id === sourceId);
    if (!sourceItem) return;
    const sourceIndex = normalizeProviderOrder(apiProviderOrder, apiProviders).indexOf(sourceId);
    const listRect = list.getBoundingClientRect();
    const cardRect = event.currentTarget.closest<HTMLElement>(".settings-api-provider-card")?.getBoundingClientRect();
    const pointerOffsetY = cardRect ? event.clientY - cardRect.top : 0;
    setDraggedApiSidebarItemId(sourceId);
    setApiSidebarDragOverlay({
      item: sourceItem,
      top: (cardRect ? cardRect.top : event.clientY) - listRect.top,
      width: cardRect?.width || listRect.width,
    });
    setApiSidebarInsertIndexValue(sourceIndex >= 0 ? sourceIndex : null);

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      moveEvent.preventDefault();
      const nextListRect = list.getBoundingClientRect();
      setApiSidebarDragOverlay((current) => current ? {
        ...current,
        top: moveEvent.clientY - nextListRect.top - pointerOffsetY,
      } : current);
      const nextIndex = getApiSidebarInsertIndex(list, moveEvent.clientY, sourceId);
      setApiSidebarInsertIndexValue(nextIndex);
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      finishApiSidebarDrag(sourceId, apiSidebarInsertIndexRef.current);
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  }

  function patchSelectedProvider(patch: Partial<ApiProvider>) {
    if (!selectedProvider) return;
    setApiProviders((current) => current.map((provider) => (provider.id === selectedProvider.id ? normalizeApiProvider({ ...provider, ...patch }, current.filter((item) => item.id !== provider.id)) : provider)));
  }

  function renderApiSidebarCardContent(item: ApiSidebarItem) {
    if (item.type === "libtv") {
      return (
        <>
          <span className="settings-api-provider-drag-handle" aria-hidden="true" onPointerDown={(event) => handleApiSidebarPointerDown(event, "libtv")}>
            <GripVertical size={14} />
          </span>
          <span className="settings-api-provider-logo">
            <LibtvLogo />
          </span>
        </>
      );
    }
    return (
      <>
        <span className="settings-api-provider-drag-handle" aria-hidden="true" onPointerDown={(event) => handleApiSidebarPointerDown(event, item.provider.id)}>
          <GripVertical size={14} />
        </span>
        <span className="settings-api-provider-mark">
          <KeyRound size={15} aria-hidden="true" />
        </span>
        <span className="settings-api-provider-info">
          <strong>{item.provider.name || item.provider.id}</strong>
          <small>{item.provider.baseUrl || t("settings:baseUrlNotConfigured")}</small>
        </span>
        <span className="settings-api-provider-pill">{item.provider.protocol}</span>
      </>
    );
  }

  async function requestProviderModels(provider: ApiProvider) {
    const url = formatModelsUrl(provider);
    const headers: HeadersInit = { Accept: "application/json" };
    if (provider.protocol === "gemini" && provider.apiKey.trim()) {
      headers["x-goog-api-key"] = provider.apiKey.trim();
    } else if (provider.apiKey.trim()) {
      headers.Authorization = `Bearer ${provider.apiKey.trim()}`;
    }
    const response = await fetch(url, { method: "GET", headers });
    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }
    if (!response.ok) {
      const message = payload && typeof payload === "object"
        ? String((payload as Record<string, unknown>).error || (payload as Record<string, unknown>).message || "")
        : String(payload || "");
      throw new Error(`${response.status}${message ? ` ${message}` : ""}`);
    }
    return extractModelIds(payload);
  }

  async function verifyApiAddress() {
    if (!selectedProvider) return;
    const protocol = apiProviderProtocolLabel(selectedProvider, t);
    setApiAction("verify");
    setApiStatus({ tone: "busy", text: "" });
    try {
      const models = await requestProviderModels(selectedProvider);
      if (!models.length) {
        setApiStatus({
          tone: "ready",
          text: t("settings:apiVerifyNoModels"),
        });
        return;
      }
      setApiStatus({
        tone: "ready",
        text: t("settings:apiVerifySuccess", { count: models.length }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setApiStatus({
        tone: "error",
        text: message === "base-url-required"
          ? t("settings:apiBaseUrlRequired")
          : message === "base-url-invalid"
            ? t("settings:apiBaseUrlInvalid")
            : t("settings:apiVerifyFailedWithProtocol", { protocol, message }),
      });
    } finally {
      setApiAction("");
    }
  }

  async function refreshLibtvStatus() {
    setApiAction("libtv-check");
    setLibtvStatus({ tone: "busy", text: t("settings:libtvChecking") });
    try {
      if (!window.libtv?.status || !window.libtv.account) throw new Error("LibTV bridge is not available.");
      const statusResult = await window.libtv.status();
      setLibtvAvailable(Boolean(statusResult.available));
      if (!statusResult.available) {
        setLibtvLoggedIn(false);
        setLibtvAccount(null);
        setLibtvAccounts([]);
        setActiveLibtvAccountId("");
        setLibtvStatus({ tone: "error", text: statusResult.error || t("settings:libtvUnavailable") });
        return;
      }
      const accountResult = await window.libtv.account();
      setLibtvLoggedIn(Boolean(accountResult.loggedIn));
      setLibtvAccount(accountResult.loggedIn ? summarizeLibtvAccount(accountResult.account) : null);
      if (accountResult.loggedIn && window.libtv.accounts) {
        const accountsResult = await window.libtv.accounts();
        const accounts = accountsResult.accounts || [];
        setLibtvAccounts(accounts);
        const activeAccount = accounts.find((account) => account.isActive) || accounts[0];
        setActiveLibtvAccountId(activeAccount?.accountId !== undefined ? String(activeAccount.accountId) : "");
      } else {
        setLibtvAccounts([]);
        setActiveLibtvAccountId("");
      }
      setLibtvStatus({
        tone: accountResult.loggedIn ? "ready" : "error",
        text: accountResult.loggedIn ? t("settings:libtvLoggedIn") : t("settings:libtvNotLoggedIn"),
      });
    } catch (error) {
      setLibtvLoggedIn(false);
      setLibtvAvailable(false);
      setLibtvAccount(null);
      setLibtvAccounts([]);
      setActiveLibtvAccountId("");
      setLibtvStatus({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setApiAction("");
    }
  }

  async function installLibtvCli() {
    setApiAction("libtv-install");
    setLibtvStatus({ tone: "busy", text: t("settings:libtvInstalling") });
    try {
      if (!window.libtv?.install) throw new Error("LibTV bridge is not available.");
      await window.libtv.install();
      setLibtvStatus({ tone: "ready", text: t("settings:libtvInstallSuccess") });
      await refreshLibtvStatus();
    } catch (error) {
      setLibtvStatus({ tone: "error", text: t("settings:libtvInstallFailed", { message: error instanceof Error ? error.message : String(error) }) });
    } finally {
      setApiAction("");
    }
  }

  async function loginLibtvWeb() {
    setApiAction("libtv-login");
    setLibtvStatus({ tone: "busy", text: t("settings:libtvOpeningLogin") });
    try {
      if (!window.libtv?.loginWeb) throw new Error("LibTV bridge is not available.");
      await window.libtv.loginWeb();
      await refreshLibtvStatus();
    } catch (error) {
      setLibtvStatus({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setApiAction("");
    }
  }

  async function switchLibtvAccount(accountId: string) {
    if (!accountId || accountId === activeLibtvAccountId) return;
    setApiAction("libtv-check");
    setActiveLibtvAccountId(accountId);
    setLibtvStatus({ tone: "busy", text: t("settings:libtvSwitchingAccount") });
    try {
      if (!window.libtv?.useAccount) throw new Error("LibTV bridge is not available.");
      await window.libtv.useAccount(accountId);
      await refreshLibtvStatus();
    } catch (error) {
      setLibtvStatus({ tone: "error", text: error instanceof Error ? error.message : String(error) });
      await refreshLibtvStatus();
    } finally {
      setApiAction("");
    }
  }

  async function logoutLibtv() {
    setApiAction("libtv-logout");
    setLibtvStatus({ tone: "busy", text: t("settings:libtvLoggingOut") });
    try {
      if (!window.libtv?.logout) throw new Error("LibTV bridge is not available.");
      await window.libtv.logout();
      setLibtvLoggedIn(false);
      setLibtvAccount(null);
      setLibtvAccounts([]);
      setActiveLibtvAccountId("");
      setLibtvStatus({ tone: "idle", text: t("settings:libtvLoggedOut") });
    } catch (error) {
      setLibtvStatus({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setApiAction("");
    }
  }

  async function fetchApiModels() {
    if (!selectedProvider) return;
    const protocol = apiProviderProtocolLabel(selectedProvider, t);
    setApiAction("fetch");
    setApiStatus({ tone: "busy", text: "" });
    try {
      const models = await requestProviderModels(selectedProvider);
      if (!models.length) {
        setApiStatus({
          tone: "error",
          text: t("settings:apiNoModelsFetched"),
        });
        return;
      }
      const existingImage = new Set(selectedProvider.imageModels);
      const existingChat = new Set(selectedProvider.chatModels);
      const existingVideo = new Set(selectedProvider.videoModels);
      const entries = models.map<FetchedModelEntry>((model) => {
        const kind = existingImage.has(model)
          ? "image"
          : existingVideo.has(model)
            ? "video"
            : existingChat.has(model)
              ? "chat"
              : classifyModel(model);
        return {
          id: model,
          kind,
          selected: existingImage.has(model) || existingChat.has(model) || existingVideo.has(model),
        };
      });
      setFetchedModels(entries);
      setModelPickerFilter("");
      setModelPickerTab("all");
      setModelPickerOpen(true);
      setApiStatus({
        tone: "ready",
        text: t("settings:apiFetchPickerReady", { total: models.length }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setApiStatus({
        tone: "error",
        text: message === "base-url-required"
          ? t("settings:apiBaseUrlRequired")
          : message === "base-url-invalid"
            ? t("settings:apiBaseUrlInvalid")
            : t("settings:apiFetchFailedWithProtocol", { protocol, message }),
      });
    } finally {
      setApiAction("");
    }
  }

  function toggleFetchedModel(modelId: string) {
    setFetchedModels((current) => current.map((model) => (model.id === modelId ? { ...model, selected: !model.selected } : model)));
  }

  function patchFetchedModelKind(modelId: string, kind: ApiModelKind) {
    setFetchedModels((current) => current.map((model) => (model.id === modelId ? { ...model, kind } : model)));
  }

  function selectVisibleFetchedModels(selected: boolean) {
    const visibleIds = new Set(filteredFetchedModels.map((model) => model.id));
    setFetchedModels((current) => current.map((model) => (visibleIds.has(model.id) ? { ...model, selected } : model)));
  }

  function applyFetchedModels() {
    if (!selectedProvider) return;
    const selected = fetchedModels.filter((model) => model.selected);
    const grouped = selected.reduce<Record<ApiModelKind, string[]>>((result, model) => {
      result[model.kind].push(model.id);
      return result;
    }, { image: [], chat: [], video: [] });
    const nextImageModels = uniqueModels([...(selectedProvider.imageModels || []), ...grouped.image]);
    const nextImageRules = grouped.image.reduce<Record<string, string>>((result, model) => {
      result[model] = selectedProvider.modelRules.image[model] || detectImageModelRuleId(model);
      return result;
    }, { ...selectedProvider.modelRules.image });
    patchSelectedProvider({
      imageModels: nextImageModels,
      chatModels: uniqueModels([...(selectedProvider.chatModels || []), ...grouped.chat]),
      videoModels: uniqueModels([...(selectedProvider.videoModels || []), ...grouped.video]),
      modelRules: {
        ...selectedProvider.modelRules,
        image: Object.fromEntries(Object.entries(nextImageRules).filter(([model]) => nextImageModels.includes(model))),
      },
    });
    setModelPickerOpen(false);
    setApiStatus({
      tone: "ready",
      text: t("settings:apiImportSuccess", {
        image: grouped.image.length,
        chat: grouped.chat.length,
        video: grouped.video.length,
      }),
    });
  }

  const fetchedModelCounts = fetchedModels.reduce<Record<ApiModelKind | "all" | "selected", number>>((result, model) => {
    result.all += 1;
    result[model.kind] += 1;
    if (model.selected) result.selected += 1;
    return result;
  }, { all: 0, image: 0, chat: 0, video: 0, selected: 0 });

  const filteredFetchedModels = fetchedModels.filter((model) => {
    const filter = modelPickerFilter.trim().toLowerCase();
    if (modelPickerTab !== "all" && model.kind !== modelPickerTab) return false;
    return !filter || model.id.toLowerCase().includes(filter);
  });

  function deleteSelectedProvider() {
    if (!selectedProvider) return;
    setApiProviders((current) => {
      const next = current.filter((provider) => provider.id !== selectedProvider.id);
      setApiProviderOrder((order) => normalizeProviderOrder(order.filter((id) => id !== selectedProvider.id), next));
      setSelectedProviderId(next[0]?.id || "");
      if (!next.length) setActiveApiPane("libtv");
      return next;
    });
  }

  function addModel(kind: ApiModelKind) {
    if (!selectedProvider) return;
    const key = kind === "image" ? "imageModels" : kind === "chat" ? "chatModels" : "videoModels";
    patchSelectedProvider({ [key]: [...selectedProvider[key], ""] } as Partial<ApiProvider>);
  }

  function updateModel(kind: ApiModelKind, index: number, value: string) {
    if (!selectedProvider) return;
    const key = kind === "image" ? "imageModels" : kind === "chat" ? "chatModels" : "videoModels";
    const previousModel = selectedProvider[key][index];
    const nextModels = selectedProvider[key].map((model, modelIndex) => (modelIndex === index ? value : model));
    if (kind !== "image") {
      patchSelectedProvider({ [key]: nextModels } as Partial<ApiProvider>);
      return;
    }
    const { [previousModel]: previousRule, ...restRules } = selectedProvider.modelRules.image;
    const nextModel = value.trim();
    patchSelectedProvider({
      imageModels: nextModels,
      modelRules: {
        ...selectedProvider.modelRules,
        image: nextModel ? { ...restRules, [nextModel]: previousRule || detectImageModelRuleId(nextModel) } : restRules,
      },
    });
  }

  function updateModelAlias(kind: ApiModelKind, model: string, value: string) {
    if (!selectedProvider || !model) return;
    patchSelectedProvider({
      modelAliases: {
        ...selectedProvider.modelAliases,
        [kind]: {
          ...selectedProvider.modelAliases[kind],
          [model]: value,
        },
      },
    });
  }

  function clearEmptyModelAlias(kind: ApiModelKind, model: string) {
    if (!selectedProvider || !model) return;
    const current = selectedProvider.modelAliases[kind]?.[model];
    if (current === undefined || current.trim()) return;
    const { [model]: _removed, ...nextAliases } = selectedProvider.modelAliases[kind];
    patchSelectedProvider({
      modelAliases: {
        ...selectedProvider.modelAliases,
        [kind]: nextAliases,
      },
    });
  }

  function deleteModel(kind: ApiModelKind, index: number) {
    if (!selectedProvider) return;
    const key = kind === "image" ? "imageModels" : kind === "chat" ? "chatModels" : "videoModels";
    const model = selectedProvider[key][index];
    const { [model]: _removed, ...nextAliases } = selectedProvider.modelAliases[kind];
    const { [model]: _removedRule, ...nextImageRules } = selectedProvider.modelRules.image;
    patchSelectedProvider({
      [key]: selectedProvider[key].filter((_, modelIndex) => modelIndex !== index),
      modelAliases: {
        ...selectedProvider.modelAliases,
        [kind]: nextAliases,
      },
      ...(kind === "image" ? {
        modelRules: {
          ...selectedProvider.modelRules,
          image: nextImageRules,
        },
      } : {}),
    } as Partial<ApiProvider>);
  }

  function updateImageModelRule(model: string, ruleId: string) {
    if (!selectedProvider || !model) return;
    patchSelectedProvider({
      modelRules: {
        ...selectedProvider.modelRules,
        image: {
          ...selectedProvider.modelRules.image,
          [model]: normalizeImageModelRuleId(ruleId),
        },
      },
    });
  }

  function renderModelList(kind: ApiModelKind) {
    if (!selectedProvider) return null;
    const key = kind === "image" ? "imageModels" : kind === "chat" ? "chatModels" : "videoModels";
    const title = kind === "image" ? t("settings:imageModels") : kind === "chat" ? t("settings:chatModels") : t("settings:videoModels");
    const models = selectedProvider[key];
    return (
      <section className="settings-api-model-card">
        <div className="settings-api-model-head">
          <div>
            <h3>{title}</h3>
          </div>
          <button type="button" className="settings-api-small-button" onClick={() => addModel(kind)}>
            <Plus size={14} aria-hidden="true" />
            <span>{t("settings:addModel")}</span>
          </button>
        </div>
        <div className="settings-api-model-list-wrap">
          <div className="settings-api-model-list scrollbar-thin-stable" data-kind={kind}>
            {models.length ? models.map((model, index) => {
              const alias = selectedProvider.modelAliases[kind]?.[model];
              const displayName = alias ?? model;
              const imageRuleId = kind === "image" && model ? normalizeImageModelRuleId(selectedProvider.modelRules.image[model] || detectImageModelRuleId(model)) : "generic-image";
              return (
              <div className="settings-api-model-row" key={`${kind}-${index}`}>
                {model ? (
                  <label className="settings-api-model-alias">
                    <input
                      value={displayName}
                      onChange={(event) => updateModelAlias(kind, model, event.target.value)}
                      onBlur={() => clearEmptyModelAlias(kind, model)}
                      placeholder={model}
                      title={model}
                    />
                    <small title={model}>{model}</small>
                  </label>
                ) : (
                  <label className="settings-api-model-alias">
                    <input value={model} onChange={(event) => updateModel(kind, index, event.target.value)} placeholder={t("settings:modelNamePlaceholder")} />
                  </label>
                )}
                {kind === "image" && model ? (
                  <label className="settings-api-model-rule">
                    <Select
                      value={imageRuleId}
                      className="settings-select"
                      menuClassName="settings-select-menu"
                      options={IMAGE_MODEL_RULES.map((rule) => ({ value: rule.id, label: rule.label }))}
                      onChange={(nextRuleId) => updateImageModelRule(model, nextRuleId)}
                      ariaLabel="Rule"
                      portal
                      menuPlacement="bottom"
                    />
                  </label>
                ) : null}
                <button type="button" aria-label={t("settings:deleteModel")} title={t("settings:deleteModel")} onClick={() => deleteModel(kind, index)}>
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </div>
            );}) : <div className="settings-api-empty-row">{t("settings:noModels")}</div>}
          </div>
        </div>
      </section>
    );
  }

  function cacheKindLabel(kind: CanvasCacheAsset["kind"]) {
    if (kind === "input") return t("settings:cacheKindInput");
    if (kind === "output") return t("settings:cacheKindOutput");
    return t("settings:cacheKindMissing");
  }

  function cacheStatusLabel(asset: CanvasCacheAsset) {
    if (!asset.exists) return t("settings:cacheStatusMissing");
    if (asset.referenced) return t("settings:cacheStatusReferenced");
    return t("settings:cacheStatusCleanable");
  }

  function renderCacheMetric(label: string, count: number, bytes?: number) {
    return (
      <div className="settings-cache-metric">
        <span>{label}</span>
        <strong>{count}</strong>
        {bytes !== undefined ? <small>{formatBytes(bytes)}</small> : null}
      </div>
    );
  }

  function renderCachePanel() {
    const cleanableAssets = cacheScan?.assets.filter((asset) => asset.exists && !asset.referenced) || [];
    const oldCleanableAssets = cleanableAssets.filter((asset) => asset.modifiedAt < Date.now() - 14 * 24 * 60 * 60 * 1000);
    const allVisibleCleanableSelected = filteredCacheAssets.some((asset) => asset.exists && !asset.referenced)
      && filteredCacheAssets.filter((asset) => asset.exists && !asset.referenced).every((asset) => selectedCacheAssetIds.has(asset.id));

    return (
      <div className="settings-cache-layout" role="tabpanel" aria-label={t("settings:cacheCleanup")}>
        <section className="settings-section settings-cache-section">
          <div className="settings-inline-status settings-cache-action-status" data-tone={cacheStatus.tone} aria-live="polite">
            {cacheStatus.text}
          </div>

          <div className="settings-cache-summary">
            {renderCacheMetric(t("settings:cacheInputImages"), cacheScan?.totals.inputCount || 0, cacheScan?.totals.inputBytes || 0)}
            {renderCacheMetric(t("settings:cacheOutputImages"), cacheScan?.totals.outputCount || 0, cacheScan?.totals.outputBytes || 0)}
            {renderCacheMetric(t("settings:cacheReferencedImages"), cacheScan?.totals.referencedCount || 0, cacheScan?.totals.referencedBytes || 0)}
            {renderCacheMetric(t("settings:cacheCleanableImages"), cacheScan?.totals.cleanableCount || 0, cacheScan?.totals.cleanableBytes || 0)}
            {renderCacheMetric(t("settings:cacheMissingImages"), cacheScan?.totals.missingReferenceCount || 0)}
          </div>

          <div className="settings-cache-toolbar">
            <div className="settings-segmented settings-cache-segmented" role="tablist" aria-label={t("settings:cacheKindFilter")}>
              {(["all", "input", "output"] as CacheKindFilter[]).map((kind) => (
                <button key={kind} type="button" className={cacheKindFilter === kind ? "active" : ""} onClick={() => setCacheKindFilter(kind)}>
                  {kind === "all" ? t("common:labels.all") : kind === "input" ? t("settings:cacheKindInput") : t("settings:cacheKindOutput")}
                </button>
              ))}
            </div>
            <div className="settings-segmented settings-cache-segmented settings-cache-segmented--status" role="tablist" aria-label={t("settings:cacheStatusFilter")}>
              {(["all", "referenced", "cleanable", "missing"] as CacheStatusFilter[]).map((statusFilter) => (
                <button key={statusFilter} type="button" className={cacheStatusFilter === statusFilter ? "active" : ""} onClick={() => setCacheStatusFilter(statusFilter)}>
                  {statusFilter === "all" ? t("common:labels.all") : statusFilter === "referenced" ? t("settings:cacheStatusReferenced") : statusFilter === "cleanable" ? t("settings:cacheStatusCleanable") : t("settings:cacheStatusMissing")}
                </button>
              ))}
            </div>
            <Select
              value={cacheCanvasFilter}
              className="settings-select settings-cache-canvas-select"
              menuClassName="settings-select-menu"
              options={[{ value: "all", label: t("settings:cacheAllCanvases") }, ...cacheCanvasOptions]}
              onChange={setCacheCanvasFilter}
              ariaLabel={t("settings:cacheCanvasFilter")}
              portal
              menuPlacement="bottom"
            />
          </div>

          <div className="settings-cache-actions">
            <button type="button" className="settings-api-action-button settings-api-action-button--danger" disabled={cacheAction !== "" || !cleanableAssets.length} onClick={() => deleteCacheAssets(cleanableAssets, "delete")}>
              <Trash2 size={15} aria-hidden="true" />
              <span>{t("settings:cacheDeleteAllCleanable")}</span>
            </button>
            <button type="button" className="settings-api-action-button" disabled={cacheAction !== "" || !oldCleanableAssets.length} onClick={() => deleteCacheAssets(oldCleanableAssets, "delete-old", 14)}>
              <Trash2 size={15} aria-hidden="true" />
              <span>{t("settings:cacheDeleteOldCleanable")}</span>
            </button>
            <button type="button" className="settings-api-action-button" disabled={cacheAction !== ""} onClick={openCanvasCacheRoot}>
              <FolderOpen size={15} aria-hidden="true" />
              <span>{t("settings:cacheOpenRoot")}</span>
            </button>
            <button type="button" className="settings-api-action-button settings-api-action-button--primary" disabled={cacheAction !== ""} onClick={() => void scanCanvasCache()}>
              <RefreshCw size={15} aria-hidden="true" />
              <span>{cacheAction === "scan" ? t("settings:cacheScanningButton") : t("settings:cacheRefresh")}</span>
            </button>
          </div>

          <div className="settings-cache-list-head">
            <label>
              <input
                type="checkbox"
                checked={allVisibleCleanableSelected}
                disabled={!filteredCacheAssets.some((asset) => asset.exists && !asset.referenced)}
                onChange={() => {
                  const visibleCleanable = filteredCacheAssets.filter((asset) => asset.exists && !asset.referenced);
                  setSelectedCacheAssetIds((current) => {
                    const next = new Set(current);
                    if (allVisibleCleanableSelected) visibleCleanable.forEach((asset) => next.delete(asset.id));
                    else visibleCleanable.forEach((asset) => next.add(asset.id));
                    return next;
                  });
                }}
              />
              <span>{t("settings:cacheVisibleCount", { count: filteredCacheAssets.length })}</span>
            </label>
            <span>{cacheScan?.rootPath || ""}</span>
          </div>

          <div className="settings-cache-list">
            {filteredCacheAssets.length ? filteredCacheAssets.map((asset) => {
              const canDelete = asset.exists && !asset.referenced;
              return (
                <article key={asset.id} className={`settings-cache-row${!asset.exists ? " settings-cache-row--missing" : ""}`}>
                  <label className="settings-cache-row-select" aria-label={t("settings:cacheSelectAsset")}>
                    <input type="checkbox" checked={selectedCacheAssetIds.has(asset.id)} disabled={!canDelete} onChange={() => toggleCacheAssetSelection(asset)} />
                  </label>
                  <div className="settings-cache-thumb">
                    {asset.exists ? <img src={asset.url} alt={asset.fileName} loading="lazy" decoding="async" /> : <HardDrive size={20} aria-hidden="true" />}
                  </div>
                  <div className="settings-cache-info">
                    <div className="settings-cache-title-line">
                      <strong title={asset.fileName}>{asset.fileName}</strong>
                      <span className={`settings-cache-pill settings-cache-pill--${asset.exists ? asset.referenced ? "referenced" : "cleanable" : "missing"}`}>{cacheStatusLabel(asset)}</span>
                      <span className="settings-cache-pill">{cacheKindLabel(asset.kind)}</span>
                    </div>
                    <div className="settings-cache-meta">
                      <span>{formatBytes(asset.sizeBytes)}</span>
                      <span>{formatCacheTime(asset.modifiedAt)}</span>
                      <span>{t("settings:cacheReferenceCount", { count: asset.references.length })}</span>
                    </div>
                    <div className="settings-cache-reference-line" title={asset.references.map((reference) => `${reference.canvasTitle || reference.canvasId}${reference.nodeTitle ? ` / ${reference.nodeTitle}` : ""}`).join("\n")}>
                      {asset.references.length ? asset.references.slice(0, 3).map((reference) => reference.canvasTitle || reference.canvasId || "-").join(" / ") : t("settings:cacheNoReferences")}
                    </div>
                  </div>
                  <div className="settings-cache-row-actions">
                    <button type="button" className="settings-api-small-button" disabled={!asset.filePath} onClick={() => revealCanvasCacheAsset(asset)}>
                      {t("settings:cacheShowInFolder")}
                    </button>
                    <button type="button" className="settings-api-small-button settings-api-action-button--danger" disabled={!canDelete || cacheAction !== ""} title={canDelete ? t("common:actions.delete") : t("settings:cacheReferencedCannotDelete")} onClick={() => deleteCacheAssets([asset], "delete")}>
                      {t("common:actions.delete")}
                    </button>
                  </div>
                </article>
              );
            }) : (
              <div className="settings-empty-state">
                <HardDrive size={22} aria-hidden="true" />
                <p>{cacheAction === "scan" ? t("settings:cacheScanning") : t("settings:cacheNoAssets")}</p>
              </div>
            )}
          </div>

          {selectedCacheAssetIds.size ? (
            <div className="settings-cache-selection-bar">
              <span>{t("settings:cacheSelectedSummary", { selected: selectedCacheAssetIds.size, cleanable: selectedCleanableCacheAssets.length, size: formatBytes(selectedCleanableCacheAssets.reduce((sum, asset) => sum + asset.sizeBytes, 0)) })}</span>
              <div>
                <button type="button" className="settings-api-small-button" onClick={() => setSelectedCacheAssetIds(new Set())}>{t("settings:cacheClearSelection")}</button>
                <button type="button" className="settings-api-action-button settings-api-action-button--danger" disabled={cacheAction !== "" || !selectedCleanableCacheAssets.length} onClick={() => deleteCacheAssets(selectedCleanableCacheAssets, "delete")}>
                  <Trash2 size={15} aria-hidden="true" />
                  <span>{t("settings:cacheDeleteSelected")}</span>
                </button>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    );
  }

  return (
    <section className="settings-page" aria-label={t("settings:title")}>
      <div className="settings-shell">
        <header className="settings-header">
          <div>
            <h1>{t("settings:title")}</h1>
          </div>
          <div className="settings-status" data-tone={status.tone}>
            {status.text}
          </div>
        </header>

        <nav className="settings-nav" aria-label={t("settings:settingsNavigation")} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "general"}
            className={activeTab === "general" ? "active" : ""}
            onClick={() => setActiveTab("general")}
          >
            <Settings size={16} aria-hidden="true" />
            <span>{t("settings:generalSettings")}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "api"}
            className={activeTab === "api" ? "active" : ""}
            onClick={() => setActiveTab("api")}
          >
            <KeyRound size={16} aria-hidden="true" />
            <span>{t("settings:apiSettings")}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "cache"}
            className={activeTab === "cache" ? "active" : ""}
            onClick={() => setActiveTab("cache")}
          >
            <HardDrive size={16} aria-hidden="true" />
            <span>{t("settings:cacheCleanup")}</span>
          </button>
        </nav>

        {activeTab === "general" ? (
          <div className="settings-layout" role="tabpanel" aria-label={t("settings:generalSettings")}>
            <section className="settings-section" aria-label={t("settings:generalSettings")}>
              <div className="settings-section__head">
                <div>
                  <h2>{t("settings:generalSettings")}</h2>
                </div>
              </div>

              <div className={`settings-subsection settings-run-mode${runModeExpanded ? " settings-run-mode--expanded" : ""}`}>
                <div className="settings-run-mode-row">
                  <div className="settings-run-mode-title">
                    <div>
                      <h3>{t("settings:runMode")}</h3>
                    </div>
                  </div>
                  <div className="settings-run-mode-controls">
                    <div className="settings-segmented settings-segmented--compact" role="radiogroup" aria-label={t("settings:runMode")}>
                      <button className={mode === "local" ? "active" : ""} type="button" role="radio" aria-checked={mode === "local"} onClick={() => {
                        setMode("local");
                        setRunModeExpanded(true);
                      }}>
                        {t("settings:localMode")}
                      </button>
                      <button className={mode === "remote" ? "active" : ""} type="button" role="radio" aria-checked={mode === "remote"} onClick={() => {
                        setMode("remote");
                        setRunModeExpanded(true);
                      }}>
                        {t("settings:remoteMode")}
                      </button>
                    </div>
                    <button
                      type="button"
                      className="settings-expand-button"
                      aria-expanded={runModeExpanded}
                      aria-controls="settings-run-mode-panel"
                      aria-label={runModeExpanded ? t("settings:collapseRunModeConfig") : t("settings:expandRunModeConfig")}
                      title={runModeExpanded ? t("settings:collapseRunModeConfig") : t("settings:expandRunModeConfig")}
                      onClick={() => setRunModeExpanded((expanded) => !expanded)}
                    >
                      <ChevronDown size={18} aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {runModeExpanded ? (
                  <div id="settings-run-mode-panel" className="settings-run-mode-panel" aria-label={mode === "local" ? t("settings:localConfig") : t("settings:serverConfig")}>
                    {mode === "local" ? (
                      <>
                        <label className="settings-field">
                          <span>{t("settings:libraryPath")}</span>
                          <div className="settings-path-row">
                            <input value={localLibraryPath} onChange={(event) => setLocalLibraryPath(event.target.value)} placeholder="D:/ForartLibrary" />
                            <button type="button" className="settings-icon-button" title={t("setup:chooseDirectory")} aria-label={t("setup:chooseDirectory")} onClick={chooseDirectory}>
                              <FolderOpen size={18} aria-hidden="true" />
                            </button>
                          </div>
                        </label>

                      </>
                    ) : (
                      <>
                        <label className="settings-field">
                          <span>{t("settings:serverUrl")}</span>
                          <input value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} placeholder="http://192.168.1.20:6980" />
                        </label>
                      </>
                    )}
                  </div>
                ) : null}
              </div>

              <div className="settings-subsection settings-download-path-row" aria-label={t("settings:imageDownloadConfig")}>
                <h3>{t("settings:imageDownloadPath")}</h3>
                <div className="settings-download-path-control">
                  <input
                    value={imageDownloadPath}
                    onChange={(event) => setImageDownloadPath(event.target.value)}
                    placeholder={defaultImageDownloadPath || t("settings:imageDownloadDefault")}
                    aria-label={t("settings:imageDownloadDirectory")}
                  />
                  <button type="button" className="settings-icon-button" title={t("setup:chooseDirectory")} aria-label={t("setup:chooseDirectory")} onClick={chooseImageDownloadDirectory}>
                    <FolderOpen size={18} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </section>

          </div>
        ) : activeTab === "cache" ? renderCachePanel() : (
          <div className="settings-api-layout" role="tabpanel" aria-label={t("settings:apiSettings")}>
            <aside className="settings-api-sidebar" aria-label={t("settings:providerList")}>
              <div className="settings-api-sidebar-title">{t("settings:providerList")}</div>
              <div
                ref={apiSidebarListRef}
                className={`settings-api-provider-list${draggedApiSidebarItemId ? " is-sorting" : ""}${apiSidebarInsertIndex !== null ? " has-insert" : ""}`}
                style={apiSidebarInsertIndex !== null ? { "--settings-api-insert-index": apiSidebarInsertIndex } as CSSProperties : undefined}
              >
                {apiSidebarItems.map((item) => {
                  if (item.type === "libtv") {
                    return (
                      <div
                        key="libtv"
                        role="button"
                        tabIndex={0}
                        data-sidebar-item-id="libtv"
                        className={`settings-api-provider-card settings-api-provider-card--libtv${activeApiPane === "libtv" ? " active" : ""}${draggedApiSidebarItemId === "libtv" ? " is-dragging" : ""}`}
                        aria-label={t("settings:libtvCliSettings")}
                        title={t("settings:libtvCliSettings")}
                        onClick={() => setActiveApiPane("libtv")}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          setActiveApiPane("libtv");
                        }}
                      >
                        {renderApiSidebarCardContent(item)}
                      </div>
                    );
                  }
                  const provider = item.provider;
                  return (
                    <div
                      key={provider.id}
                      role="button"
                      tabIndex={0}
                      data-sidebar-item-id={provider.id}
                      className={`settings-api-provider-card${activeApiPane === "provider" && provider.id === selectedProvider?.id ? " active" : ""}${draggedApiSidebarItemId === provider.id ? " is-dragging" : ""}`}
                      onClick={() => {
                        setActiveApiPane("provider");
                        setSelectedProviderId(provider.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        setActiveApiPane("provider");
                        setSelectedProviderId(provider.id);
                      }}
                    >
                      {renderApiSidebarCardContent(item)}
                    </div>
                  );
                })}
                {apiSidebarDragOverlay ? (
                  <div
                    className={`settings-api-provider-card settings-api-provider-card--overlay${apiSidebarDragOverlay.item.type === "libtv" ? " settings-api-provider-card--libtv" : ""}`}
                    style={{
                      top: apiSidebarDragOverlay.top,
                      width: apiSidebarDragOverlay.width,
                    }}
                    aria-hidden="true"
                  >
                    {renderApiSidebarCardContent(apiSidebarDragOverlay.item)}
                  </div>
                ) : null}
                {!apiProviders.length ? <div className="settings-api-provider-empty">{t("settings:noApiProviders")}</div> : null}
              </div>
              <button type="button" className="settings-api-add-button" onClick={addApiProvider}>
                <Plus size={16} aria-hidden="true" />
                <span>{t("settings:addProvider")}</span>
              </button>
            </aside>

            <main className="settings-api-content">
              {activeApiPane === "libtv" ? (
                <section className="settings-api-block settings-libtv-card">
                  <div className="settings-libtv-brand-panel">
                    <span className="settings-api-provider-logo settings-api-provider-logo--head settings-libtv-brand-logo">
                      <LibtvLogo />
                    </span>
                    <div className="settings-libtv-install-control">
                      {libtvAvailable ? (
                        <button
                          type="button"
                          className="settings-libtv-installed-button"
                          disabled={apiAction !== ""}
                          onClick={installLibtvCli}
                          aria-label={t("settings:libtvUpdateCli")}
                          title={t("settings:libtvUpdateCli")}
                        >
                          <RefreshCw size={15} aria-hidden="true" />
                          <span className="settings-libtv-installed-button__divider" aria-hidden="true" />
                          <span>{apiAction === "libtv-install" ? t("settings:libtvInstallingButton") : t("settings:libtvInstalled")}</span>
                        </button>
                      ) : (
                        <button type="button" className="settings-api-action-button settings-api-action-button--primary" disabled={apiAction !== ""} onClick={installLibtvCli}>
                          <Download size={15} aria-hidden="true" />
                          <span>{apiAction === "libtv-install" ? t("settings:libtvInstallingButton") : t("settings:libtvInstallCli")}</span>
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="settings-libtv-account-panel">
                    <label className="settings-libtv-account-switcher">
                      <span>{t("settings:libtvAccountName")}</span>
                      <Select
                        value={activeLibtvAccountId}
                        className="settings-select"
                        menuClassName="settings-select-menu"
                        disabled={apiAction !== "" || !libtvAccounts.length}
                        onChange={(accountId) => void switchLibtvAccount(accountId)}
                        options={libtvAccounts.length ? libtvAccounts.map((account) => ({
                          value: String(account.accountId ?? ""),
                          label: `${account.accountName || account.accountId || "-"} · ${libtvAccountTypeLabel(account, t)}`,
                        })) : [{ value: "", label: t("settings:libtvNoAccounts") }]}
                        ariaLabel={t("settings:libtvAccountName")}
                        portal
                        menuPlacement="bottom"
                      />
                    </label>
                    <div className="settings-libtv-account-grid">
                      <div className="settings-libtv-account-field">
                        <span>{t("settings:libtvPlanInfo")}</span>
                        <strong>{libtvAccount?.memberName || "-"}</strong>
                      </div>
                      <div className="settings-libtv-account-field">
                        <span>{t("settings:libtvAccountUpdatedAt")}</span>
                        <strong>{libtvAccount?.updatedAt || "-"}</strong>
                      </div>
                    </div>
                    <div className="settings-api-test-actions">
                      {libtvLoggedIn ? (
                        <>
                          <button type="button" className="settings-api-action-button settings-libtv-status-button settings-libtv-status-button--ready" disabled={apiAction !== ""} onClick={refreshLibtvStatus}>
                            <RefreshCw size={15} aria-hidden="true" />
                            <span>{apiAction === "libtv-check" ? t("settings:libtvCheckingButton") : t("settings:libtvLoggedInShort")}</span>
                          </button>
                          <button type="button" className="settings-api-action-button" disabled={apiAction !== ""} onClick={logoutLibtv}>
                            <LogOut size={15} aria-hidden="true" />
                            <span>{t("settings:libtvLogout")}</span>
                          </button>
                        </>
                      ) : libtvAvailable ? (
                        <button type="button" className="settings-api-action-button settings-api-action-button--primary" disabled={apiAction !== ""} onClick={loginLibtvWeb}>
                          <LogIn size={15} aria-hidden="true" />
                          <span>{apiAction === "libtv-login" ? t("settings:libtvLoginWaiting") : t("settings:libtvLoginWeb")}</span>
                        </button>
                      ) : null}
                    </div>
                  </div>
                </section>
              ) : selectedProvider ? (
                <>
                  <header className="settings-api-content-head">
                    <div>
                      <h2>{selectedProvider.name || t("settings:provider")}</h2>
                    </div>
                    <div className="settings-api-content-actions">
                      <button type="button" className="settings-api-action-button settings-api-action-button--danger" onClick={deleteSelectedProvider}>
                        <Trash2 size={15} aria-hidden="true" />
                        <span>{t("settings:deleteProvider")}</span>
                      </button>
                    </div>
                  </header>

                  <section className="settings-api-block">
                    <div className="settings-api-block-head">
                      <div>
                        <h3>{t("settings:basicInfo")}</h3>
                      </div>
                    </div>
                    <div className="settings-api-form">
                      <label className="settings-field">
                        <span>{t("settings:providerName")}</span>
                        <input value={selectedProvider.name} onChange={(event) => patchSelectedProvider({ name: event.target.value })} placeholder={t("settings:providerNamePlaceholder")} />
                      </label>
                      <label className="settings-field">
                        <span>{t("settings:baseUrl")}</span>
                        <input value={selectedProvider.baseUrl} onChange={(event) => patchSelectedProvider({ baseUrl: event.target.value })} placeholder="https://api.example.com/v1" />
                      </label>
                      <label className="settings-field">
                        <span>{t("settings:apiKey")}</span>
                        <input type="password" value={selectedProvider.apiKey} onChange={(event) => patchSelectedProvider({ apiKey: event.target.value })} placeholder={t("settings:apiKeyPlaceholder")} />
                      </label>
                      <div className="settings-api-control-row" data-has-request-mode={selectedProvider.protocol === "openai" ? "true" : "false"}>
                        <label className="settings-field">
                          <span>{t("settings:protocol")}</span>
                          <Select
                            value={selectedProvider.protocol}
                            className="settings-select"
                            menuClassName="settings-select-menu"
                            options={[
                              { value: "compatible", label: t("settings:protocolCompatible") },
                              { value: "openai", label: t("settings:protocolOpenAI") },
                              { value: "gemini", label: t("settings:protocolGemini") },
                            ]}
                            onChange={(protocol) => patchSelectedProvider({ protocol: protocol as ApiProvider["protocol"] })}
                            ariaLabel={t("settings:protocol")}
                            portal
                            menuPlacement="bottom"
                          />
                        </label>
                        {selectedProvider.protocol === "openai" ? (
                          <label className="settings-field">
                            <span>{t("settings:imageRequestMode")}</span>
                            <Select
                              value={selectedProvider.imageRequestMode}
                              className="settings-select"
                              menuClassName="settings-select-menu"
                              options={[
                                { value: "openai", label: t("settings:imageRequestModeOpenAI") },
                                { value: "openai-json", label: t("settings:imageRequestModeOpenAIJson") },
                              ]}
                              onChange={(imageRequestMode) => patchSelectedProvider({ imageRequestMode: imageRequestMode as ApiProvider["imageRequestMode"] })}
                              ariaLabel={t("settings:imageRequestMode")}
                              portal
                              menuPlacement="bottom"
                            />
                          </label>
                        ) : null}
                        <button type="button" className="settings-api-action-button settings-api-control-button" disabled={apiAction !== ""} onClick={verifyApiAddress}>
                          <TestTube2 size={15} aria-hidden="true" />
                          <span>{apiAction === "verify" ? t("settings:apiVerifying") : t("settings:verifyAddress")}</span>
                        </button>
                        <button type="button" className="settings-api-action-button settings-api-action-button--primary settings-api-control-button" disabled={apiAction !== ""} onClick={fetchApiModels}>
                          <RefreshCw size={15} aria-hidden="true" />
                          <span>{apiAction === "fetch" ? t("settings:apiFetching") : t("settings:fetchModels")}</span>
                        </button>
                      </div>
                      {apiStatus.text && (apiStatus.tone === "ready" || apiStatus.tone === "error") ? (
                        <div className="settings-inline-status settings-api-action-status" data-tone={apiStatus.tone} aria-live="polite">
                          {apiStatus.text}
                        </div>
                      ) : null}
                    </div>
                  </section>

                  {renderModelList("image")}
                  {renderModelList("chat")}
                  {renderModelList("video")}
                </>
              ) : (
                <section className="settings-section settings-section--api" aria-label={t("settings:apiSettings")}>
                  <div className="settings-section__head">
                    <div>
                      <h2>{t("settings:apiSettings")}</h2>
                    </div>
                  </div>
                  <div className="settings-empty-state">
                    <KeyRound size={22} aria-hidden="true" />
                    <p>{t("settings:noApiProviders")}</p>
                    <button type="button" className="settings-api-add-button settings-api-add-button--inline" onClick={addApiProvider}>
                      <Plus size={16} aria-hidden="true" />
                      <span>{t("settings:addProvider")}</span>
                    </button>
                  </div>
                </section>
              )}
            </main>
          </div>
        )}

        {modelPickerOpen && selectedProvider ? (
          <div className="settings-api-modal-backdrop" role="presentation" onMouseDown={() => setModelPickerOpen(false)}>
            <section className="settings-api-model-picker" role="dialog" aria-modal="true" aria-label={t("settings:selectModels")} onMouseDown={(event) => event.stopPropagation()}>
              <header className="settings-api-model-picker-head">
                <div>
                  <h2>{t("settings:selectModels")}</h2>
                  <p>{t("settings:selectModelsDescription", { total: fetchedModelCounts.all })}</p>
                </div>
                <button type="button" className="settings-api-action-button" onClick={() => setModelPickerOpen(false)}>
                  {t("common:actions.cancel")}
                </button>
              </header>

              <div className="settings-api-model-picker-tools">
                <input value={modelPickerFilter} onChange={(event) => setModelPickerFilter(event.target.value)} placeholder={t("settings:searchModels")} />
                <div className="settings-api-picker-tabs" role="tablist" aria-label={t("settings:modelList")}>
                  {(["all", "image", "chat", "video"] as Array<ApiModelKind | "all">).map((kind) => (
                    <button key={kind} type="button" className={modelPickerTab === kind ? "active" : ""} onClick={() => setModelPickerTab(kind)}>
                      <span>{kind === "all" ? t("settings:allModels") : kind === "image" ? t("settings:imageModels") : kind === "chat" ? t("settings:chatModels") : t("settings:videoModels")}</span>
                      <small>{fetchedModelCounts[kind]}</small>
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-api-picker-bulk">
                <span>{t("settings:visibleModelCount", { count: filteredFetchedModels.length })}</span>
                <div>
                  <button type="button" className="settings-api-small-button" onClick={() => selectVisibleFetchedModels(true)}>{t("settings:selectVisible")}</button>
                  <button type="button" className="settings-api-small-button" onClick={() => selectVisibleFetchedModels(false)}>{t("settings:clearVisible")}</button>
                </div>
              </div>

              <div className="settings-api-picker-list">
                {filteredFetchedModels.length ? filteredFetchedModels.map((model) => (
                  <div className={`settings-api-picker-row${model.selected ? " selected" : ""}`} key={model.id}>
                    <label>
                      <input type="checkbox" checked={model.selected} onChange={() => toggleFetchedModel(model.id)} />
                      <span title={model.id}>{model.id}</span>
                    </label>
                    <Select
                      value={model.kind}
                      className="settings-select"
                      menuClassName="settings-select-menu"
                      options={[
                        { value: "image", label: t("settings:imageModels") },
                        { value: "chat", label: t("settings:chatModels") },
                        { value: "video", label: t("settings:videoModels") },
                      ]}
                      onChange={(kind) => patchFetchedModelKind(model.id, kind as ApiModelKind)}
                      ariaLabel={t("settings:selectModels")}
                      portal
                      menuPlacement="bottom"
                    />
                  </div>
                )) : <div className="settings-api-picker-empty">{t("settings:noMatchingModels")}</div>}
              </div>

              <footer className="settings-api-model-picker-foot">
                <div className="settings-api-picker-summary">
                  <span>{t("settings:selectedModelCount", { count: fetchedModelCounts.selected })}</span>
                  <span>{t("settings:imageModels")}: {fetchedModels.filter((model) => model.selected && model.kind === "image").length}</span>
                  <span>{t("settings:chatModels")}: {fetchedModels.filter((model) => model.selected && model.kind === "chat").length}</span>
                  <span>{t("settings:videoModels")}: {fetchedModels.filter((model) => model.selected && model.kind === "video").length}</span>
                </div>
                <button type="button" className="settings-api-action-button settings-api-action-button--primary" disabled={!fetchedModelCounts.selected} onClick={applyFetchedModels}>
                  {t("settings:importSelectedModels")}
                </button>
              </footer>
            </section>
          </div>
        ) : null}
      </div>
    </section>
  );
}
