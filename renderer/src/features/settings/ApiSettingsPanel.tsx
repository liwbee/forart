import { GripVertical, KeyRound, Plus, RefreshCw, TestTube2, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { AppScrollArea } from "../../components/AppScrollArea";
import { AppSelect as Select } from "../../components/AppSelect";
import { ConfirmingDeleteButton } from "../../components/ConfirmingDeleteButton";
import { DraggableList } from "../../components/DraggableList";
import { ErrorCopyLine } from "../../components/ErrorCopyLine";
import { NativeTabs, type NativeTabItem } from "../../components/NativeTabs";
import { SearchInput } from "../../components/SearchInput";
import { VirtualList } from "../../components/VirtualList";
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/skeleton";
import { ApimartLogo, ApimartSettingsPane, type ApiPanelStatus } from "./ApimartSettingsPane";
import { APIMART_PROVIDER_ID, createApiProvider, loadApiSettings, normalizeApiProvider, normalizeApiProviderOrder, readApiSettings, saveApiSettings, uniqueModels, type ApiModelKind, type ApiProvider } from "./apiProviders";
import { detectImageModelRuleId, IMAGE_MODEL_RULES, normalizeImageModelRuleId } from "./imageModelRules";
import { LibtvLogo, LibtvSettingsPane } from "./LibtvSettingsPane";

type ApiSettingsPane = "provider" | "apimart" | "libtv";
type ApiAction = "verify" | "fetch" | "";
type ModelPickerTab = ApiModelKind | "all";
type ApiSidebarItem =
  | { id: "libtv"; type: "libtv" }
  | { id: "apimart"; type: "apimart"; provider: ApiProvider }
  | { id: string; type: "provider"; provider: ApiProvider };
type FetchedModelEntry = { id: string; kind: ApiModelKind; selected: boolean };

function formatModelsUrl(provider: ApiProvider) {
  const rawBaseUrl = provider.baseUrl.trim();
  if (!rawBaseUrl) throw new Error("base-url-required");
  if (!/^https?:\/\//i.test(rawBaseUrl)) throw new Error("base-url-invalid");
  const baseUrl = rawBaseUrl.replace(/\/+$/, "");
  if (/\/models(?:\?.*)?$/i.test(baseUrl)) return baseUrl;
  if (provider.protocol === "gemini") {
    const geminiRoot = baseUrl.replace(/\/(?:api\/)?v\d+(?:beta)?$/i, "");
    return baseUrl.endsWith("/v1beta") ? `${baseUrl}/models` : `${geminiRoot}/v1beta/models`;
  }
  return /\/(?:api\/)?v\d+(?:beta)?$/i.test(baseUrl) ? `${baseUrl}/models` : `${baseUrl}/v1/models`;
}

function extractModelIds(payload: unknown) {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
  const source = Array.isArray(payload) ? payload
    : Array.isArray(record?.data) ? record.data
      : Array.isArray(record?.models) ? record.models
        : Array.isArray(record?.list) ? record.list
          : Array.isArray(record?.model_list) ? record.model_list : [];
  return uniqueModels(source.map((item) => {
    if (typeof item === "string") return item;
    if (!item || typeof item !== "object") return "";
    const value = (item as Record<string, unknown>).id || (item as Record<string, unknown>).name || (item as Record<string, unknown>).model || (item as Record<string, unknown>).model_id || (item as Record<string, unknown>).modelId;
    return typeof value === "string" ? value.replace(/^models\//, "") : "";
  }));
}

function classifyModel(id: string): ApiModelKind {
  const text = id.toLowerCase();
  if (/(image|img|dall-e|gpt-image|flux|sdxl|stable-diffusion|seedream|midjourney|ideogram|recraft|qwen-image|kolors|hidream|imagen)/i.test(text)) return "image";
  if (/(video|veo|sora|seedance|wan|kling|hailuo|runway|pika|luma|t2v|i2v)/i.test(text)) return "video";
  return "chat";
}

export function ApiSettingsPanel() {
  const { t } = useTranslation();
  const imageModelListViewportRef = useRef<HTMLDivElement | null>(null);
  const chatModelListViewportRef = useRef<HTMLDivElement | null>(null);
  const videoModelListViewportRef = useRef<HTMLDivElement | null>(null);
  const [initialSettings] = useState(readApiSettings);
  const [providers, setProviders] = useState<ApiProvider[]>(initialSettings.providers);
  const [providerOrder, setProviderOrder] = useState<string[]>(() => normalizeApiProviderOrder(initialSettings.providerOrder, initialSettings.providers));
  const [defaultImageProviderId, setDefaultImageProviderId] = useState(initialSettings.defaultImageProviderId || "");
  const [libtvMachineId, setLibtvMachineId] = useState(initialSettings.libtvMachineId || "");
  const [libtvActionFissionConcurrency, setLibtvActionFissionConcurrency] = useState(initialSettings.libtvActionFissionConcurrency ?? 1);
  const [selectedProviderId, setSelectedProviderId] = useState(APIMART_PROVIDER_ID);
  const [activePane, setActivePane] = useState<ApiSettingsPane>("apimart");
  const [action, setAction] = useState<ApiAction>("");
  const [status, setStatus] = useState<ApiPanelStatus>({ tone: "idle", text: t("settings:apiActionReady") });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelPickerFilter, setModelPickerFilter] = useState("");
  const [modelPickerTab, setModelPickerTab] = useState<ModelPickerTab>("all");
  const [fetchedModels, setFetchedModels] = useState<FetchedModelEntry[]>([]);
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) || providers[0] || null;

  const sidebarItems = useMemo<ApiSidebarItem[]>(() => {
    const providersById = new Map(providers.map((provider) => [provider.id, provider]));
    return normalizeApiProviderOrder(providerOrder, providers).reduce<ApiSidebarItem[]>((items, id) => {
      if (id === "libtv") return [...items, { id: "libtv", type: "libtv" }];
      const provider = providersById.get(id);
      if (!provider) return items;
      return provider.id === APIMART_PROVIDER_ID ? [...items, { id: "apimart", type: "apimart", provider }] : [...items, { id, type: "provider", provider }];
    }, []);
  }, [providerOrder, providers]);

  useEffect(() => {
    let canceled = false;
    void loadApiSettings()
      .then((settings) => {
        if (canceled) return;
        setProviders(settings.providers);
        setProviderOrder(normalizeApiProviderOrder(settings.providerOrder, settings.providers));
        setDefaultImageProviderId(settings.defaultImageProviderId || "");
        setLibtvMachineId(settings.libtvMachineId || "");
        setLibtvActionFissionConcurrency(settings.libtvActionFissionConcurrency ?? 1);
        setSelectedProviderId((current) => settings.providers.some((provider) => provider.id === current) ? current : APIMART_PROVIDER_ID);
        setSettingsLoaded(true);
      })
      .catch((error) => {
        if (canceled) return;
        setStatus({ tone: "error", text: error instanceof Error ? error.message : String(error) });
        setSettingsLoaded(true);
      });
    return () => { canceled = true; };
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    const nextOrder = normalizeApiProviderOrder(providerOrder, providers);
    if (nextOrder.join("\n") !== providerOrder.join("\n")) {
      setProviderOrder(nextOrder);
      return;
    }
    const timeout = window.setTimeout(() => {
      void saveApiSettings({ providers, defaultImageProviderId, providerOrder: nextOrder, libtvMachineId, libtvActionFissionConcurrency })
        .catch((error) => setStatus({
          tone: "error",
          text: t("settings:apiSaveFailed", { message: error instanceof Error ? error.message : String(error) }),
        }));
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [defaultImageProviderId, libtvActionFissionConcurrency, libtvMachineId, providerOrder, providers, settingsLoaded, t]);

  useEffect(() => {
    if (providers.length && !providers.some((provider) => provider.id === selectedProviderId)) setSelectedProviderId(providers[0].id);
  }, [providers, selectedProviderId]);

  useEffect(() => {
    setStatus({ tone: "idle", text: t("settings:apiActionReady") });
    setAction("");
    setModelPickerOpen(false);
    setFetchedModels([]);
    setModelPickerFilter("");
    setModelPickerTab("all");
  }, [selectedProviderId, t]);

  function addProvider() {
    setProviders((current) => {
      const provider = createApiProvider(current);
      setSelectedProviderId(provider.id);
      setActivePane("provider");
      setProviderOrder((order) => normalizeApiProviderOrder([...order, provider.id], [...current, provider]));
      return [...current, provider];
    });
  }

  function applySidebarOrder(nextOrder: string[]) {
    setProviderOrder(nextOrder);
    setProviders((current) => {
      const byId = new Map(current.map((provider) => [provider.id, provider]));
      return nextOrder.filter((id) => id !== "libtv").map((id) => byId.get(id)).filter((provider): provider is ApiProvider => Boolean(provider));
    });
  }

  function patchSelectedProvider(patch: Partial<ApiProvider>) {
    if (!selectedProvider) return;
    setProviders((current) => current.map((provider) => provider.id === selectedProvider.id ? normalizeApiProvider({ ...provider, ...patch }, current.filter((item) => item.id !== provider.id)) : provider));
  }

  async function requestModels(provider: ApiProvider) {
    const headers: HeadersInit = { Accept: "application/json" };
    if (provider.protocol === "gemini" && provider.apiKey.trim()) headers["x-goog-api-key"] = provider.apiKey.trim();
    else if (provider.apiKey.trim()) headers.Authorization = `Bearer ${provider.apiKey.trim()}`;
    const response = await fetch(formatModelsUrl(provider), { method: "GET", headers });
    const text = await response.text();
    let payload: unknown = null;
    if (text) { try { payload = JSON.parse(text); } catch { payload = text; } }
    if (!response.ok) {
      const message = payload && typeof payload === "object" ? String((payload as Record<string, unknown>).error || (payload as Record<string, unknown>).message || "") : String(payload || "");
      throw new Error(`${response.status}${message ? ` ${message}` : ""}`);
    }
    return extractModelIds(payload);
  }

  const protocolLabel = (provider: ApiProvider) => provider.protocol === "gemini" ? t("settings:protocolGemini") : provider.protocol === "compatible" ? t("settings:protocolCompatible") : t("settings:protocolOpenAI");

  function setRequestError(error: unknown, mode: "verify" | "fetch", protocol: string) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus({
      tone: "error",
      text: message === "base-url-required" ? t("settings:apiBaseUrlRequired")
        : message === "base-url-invalid" ? t("settings:apiBaseUrlInvalid")
          : t(mode === "verify" ? "settings:apiVerifyFailedWithProtocol" : "settings:apiFetchFailedWithProtocol", { protocol, message }),
    });
  }

  async function verifyAddress() {
    if (!selectedProvider) return;
    const protocol = protocolLabel(selectedProvider);
    setAction("verify"); setStatus({ tone: "busy", text: "" });
    try {
      const models = await requestModels(selectedProvider);
      setStatus({ tone: "ready", text: models.length ? t("settings:apiVerifySuccess", { count: models.length }) : t("settings:apiVerifyNoModels") });
    } catch (error) { setRequestError(error, "verify", protocol); }
    finally { setAction(""); }
  }

  async function fetchModels() {
    if (!selectedProvider) return;
    const protocol = protocolLabel(selectedProvider);
    setAction("fetch"); setStatus({ tone: "busy", text: "" });
    try {
      const models = await requestModels(selectedProvider);
      if (!models.length) { setStatus({ tone: "error", text: t("settings:apiNoModelsFetched") }); return; }
      const existingImage = new Set(selectedProvider.imageModels);
      const existingChat = new Set(selectedProvider.chatModels);
      const existingVideo = new Set(selectedProvider.videoModels);
      setFetchedModels(models.map((model) => ({
        id: model,
        kind: existingImage.has(model) ? "image" : existingVideo.has(model) ? "video" : existingChat.has(model) ? "chat" : classifyModel(model),
        selected: existingImage.has(model) || existingChat.has(model) || existingVideo.has(model),
      })));
      setModelPickerFilter(""); setModelPickerTab("all"); setModelPickerOpen(true);
      setStatus({ tone: "ready", text: t("settings:apiFetchPickerReady", { total: models.length }) });
    } catch (error) { setRequestError(error, "fetch", protocol); }
    finally { setAction(""); }
  }

  const filteredFetchedModels = fetchedModels.filter((model) => {
    const filter = modelPickerFilter.trim().toLowerCase();
    return (modelPickerTab === "all" || model.kind === modelPickerTab) && (!filter || model.id.toLowerCase().includes(filter));
  });
  const fetchedModelCounts = useMemo(() => fetchedModels.reduce<Record<ApiModelKind | "all" | "selected", number>>((result, model) => {
    result.all += 1; result[model.kind] += 1; if (model.selected) result.selected += 1; return result;
  }, { all: 0, image: 0, chat: 0, video: 0, selected: 0 }), [fetchedModels]);
  const modelPickerTabs = useMemo<NativeTabItem<ModelPickerTab>[]>(() => (["all", "image", "chat", "video"] as ModelPickerTab[]).map((kind) => ({
    value: kind,
    label: kind === "all" ? t("settings:allModels") : kind === "image" ? t("settings:imageModels") : kind === "chat" ? t("settings:chatModels") : t("settings:videoModels"),
    meta: fetchedModelCounts[kind],
  })), [fetchedModelCounts, t]);

  function applyFetchedModels() {
    if (!selectedProvider) return;
    const grouped = fetchedModels.filter((model) => model.selected).reduce<Record<ApiModelKind, string[]>>((result, model) => { result[model.kind].push(model.id); return result; }, { image: [], chat: [], video: [] });
    const imageModels = uniqueModels([...selectedProvider.imageModels, ...grouped.image]);
    const imageRules = grouped.image.reduce<Record<string, string>>((result, model) => { result[model] = selectedProvider.modelRules.image[model] || detectImageModelRuleId(model); return result; }, { ...selectedProvider.modelRules.image });
    patchSelectedProvider({
      imageModels,
      chatModels: uniqueModels([...selectedProvider.chatModels, ...grouped.chat]),
      videoModels: uniqueModels([...selectedProvider.videoModels, ...grouped.video]),
      modelRules: { ...selectedProvider.modelRules, image: Object.fromEntries(Object.entries(imageRules).filter(([model]) => imageModels.includes(model))) },
    });
    setModelPickerOpen(false);
    setStatus({ tone: "ready", text: t("settings:apiImportSuccess", { image: grouped.image.length, chat: grouped.chat.length, video: grouped.video.length }) });
  }

  function deleteSelectedProvider() {
    if (!selectedProvider || selectedProvider.id === APIMART_PROVIDER_ID) return;
    setProviders((current) => {
      const next = current.filter((provider) => provider.id !== selectedProvider.id);
      setProviderOrder((order) => normalizeApiProviderOrder(order.filter((id) => id !== selectedProvider.id), next));
      const nextProviderId = next[0]?.id || APIMART_PROVIDER_ID;
      setSelectedProviderId(nextProviderId);
      setActivePane(nextProviderId === APIMART_PROVIDER_ID ? "apimart" : "provider");
      return next;
    });
  }

  function patchModelList(kind: ApiModelKind, models: string[]) {
    patchSelectedProvider({ [kind === "image" ? "imageModels" : kind === "chat" ? "chatModels" : "videoModels"]: models } as Partial<ApiProvider>);
  }

  function updateModelAlias(kind: ApiModelKind, model: string, value: string) {
    if (!selectedProvider || !model) return;
    patchSelectedProvider({ modelAliases: { ...selectedProvider.modelAliases, [kind]: { ...selectedProvider.modelAliases[kind], [model]: value } } });
  }

  function clearEmptyModelAlias(kind: ApiModelKind, model: string) {
    if (!selectedProvider || !model || selectedProvider.modelAliases[kind]?.[model]?.trim()) return;
    const aliases = { ...selectedProvider.modelAliases[kind] };
    delete aliases[model];
    patchSelectedProvider({ modelAliases: { ...selectedProvider.modelAliases, [kind]: aliases } });
  }

  function deleteModel(kind: ApiModelKind, index: number) {
    if (!selectedProvider) return;
    const key = kind === "image" ? "imageModels" : kind === "chat" ? "chatModels" : "videoModels";
    const model = selectedProvider[key][index];
    const aliases = { ...selectedProvider.modelAliases[kind] };
    const rules = { ...selectedProvider.modelRules.image };
    delete aliases[model];
    delete rules[model];
    patchSelectedProvider({
      [key]: selectedProvider[key].filter((_, modelIndex) => modelIndex !== index),
      modelAliases: { ...selectedProvider.modelAliases, [kind]: aliases },
      ...(kind === "image" ? { modelRules: { ...selectedProvider.modelRules, image: rules } } : {}),
    } as Partial<ApiProvider>);
  }

  function renderModelList(kind: ApiModelKind) {
    if (!selectedProvider) return null;
    const key = kind === "image" ? "imageModels" : kind === "chat" ? "chatModels" : "videoModels";
    const title = kind === "image" ? t("settings:imageModels") : kind === "chat" ? t("settings:chatModels") : t("settings:videoModels");
    const models = selectedProvider[key];
    const viewportRef = kind === "image" ? imageModelListViewportRef : kind === "chat" ? chatModelListViewportRef : videoModelListViewportRef;
    const rows = models.map((model, index) => ({ id: `${kind}-${model}`, model, index }));
    return (
      <section className="settings-api-model-card">
        <div className="settings-api-model-head"><div><h3>{title}</h3></div></div>
        <div className="settings-api-model-list-wrap">
          <AppScrollArea className="settings-api-model-list" viewportClassName="settings-api-model-list__viewport" viewportRef={viewportRef} scrollbars={models.length > 1 ? "vertical" : "none"}>
            <DraggableList
              items={rows}
              getId={(row) => row.id}
              className="settings-api-model-sortable-list"
              scrollContainerRef={viewportRef}
              onReorder={(nextRows) => patchModelList(kind, nextRows.map((row) => row.model))}
              renderItem={(row, { dragHandleProps }) => {
                const { model, index } = row;
                const imageRuleId = kind === "image" && model ? normalizeImageModelRuleId(selectedProvider.modelRules.image[model] || detectImageModelRuleId(model)) : "generic-image";
                return (
                  <div className={`settings-api-model-row${kind === "image" && model ? " has-rule" : ""}`}>
                    <span className="settings-api-model-drag-handle" aria-hidden="true" {...dragHandleProps}><GripVertical size={14} /></span>
                    <label className="settings-api-model-alias">
                      <input value={selectedProvider.modelAliases[kind]?.[model] ?? model} onChange={(event) => updateModelAlias(kind, model, event.target.value)} onBlur={() => clearEmptyModelAlias(kind, model)} placeholder={model || t("settings:modelNamePlaceholder")} title={model || undefined} />
                      {model ? <small title={model}>{model}</small> : null}
                    </label>
                    {kind === "image" && model ? (
                      <label className="settings-api-model-rule"><Select value={imageRuleId} options={IMAGE_MODEL_RULES.map((rule) => ({ value: rule.id, label: rule.labelKey ? t(`settings:${rule.labelKey}`) : rule.label }))} onChange={(ruleId) => patchSelectedProvider({ modelRules: { ...selectedProvider.modelRules, image: { ...selectedProvider.modelRules.image, [model]: normalizeImageModelRuleId(ruleId) } } })} ariaLabel={t("settings:modelRule")} menuPlacement="bottom" /></label>
                    ) : null}
                    <Button type="button" variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" aria-label={t("settings:deleteModel")} title={t("settings:deleteModel")} onClick={() => deleteModel(kind, index)}><Trash2 aria-hidden="true" /></Button>
                  </div>
                );
              }}
              empty={<div className="settings-api-empty-row">{t("settings:noModels")}</div>}
            />
          </AppScrollArea>
        </div>
      </section>
    );
  }

  function renderSidebarContent(item: ApiSidebarItem, dragHandleProps: { onPointerDown: (event: PointerEvent<HTMLElement>) => void }) {
    return (
      <>
        <span className="settings-api-provider-drag-handle" aria-hidden="true" {...dragHandleProps}><GripVertical size={14} /></span>
        {item.type === "libtv" ? <span className="settings-api-provider-logo settings-libtv-sidebar-logo"><LibtvLogo /></span>
          : item.type === "apimart" ? <span className="settings-api-provider-logo settings-api-provider-logo--apimart"><ApimartLogo /></span>
            : <><span className="settings-api-provider-info"><strong>{item.provider.name || item.provider.id}</strong><small>{item.provider.baseUrl || t("settings:baseUrlNotConfigured")}</small></span><span className="settings-api-provider-pill">{item.provider.protocol}</span></>}
      </>
    );
  }

  return (
    <>
      {!settingsLoaded ? (
          <div className="settings-api-layout" role="tabpanel" aria-label={t("settings:apiSettings")} aria-busy="true">
            <aside className="settings-api-sidebar" aria-label={t("settings:providerList")}>
              <div className="settings-api-sidebar-title">{t("settings:providerList")}</div>
              <div className="settings-api-provider-list">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            </aside>
            <main className="settings-api-content">
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-56 w-full" />
            </main>
          </div>
        ) : (
        <div className="settings-api-layout" role="tabpanel" aria-label={t("settings:apiSettings")}>
        <aside className="settings-api-sidebar" aria-label={t("settings:providerList")}>
          <div className="settings-api-sidebar-title">{t("settings:providerList")}</div>
          <DraggableList
            items={sidebarItems}
            getId={(item) => item.id}
            className="settings-api-provider-list"
            onReorder={(items) => applySidebarOrder(items.map((item) => item.id))}
            renderItem={(item, { isDragging, dragHandleProps }) => {
              const selected = item.type === "libtv" ? activePane === "libtv" : item.type === "apimart" ? activePane === "apimart" : activePane === "provider" && item.id === selectedProvider?.id;
              return (
                <Button type="button" variant={selected ? "default" : "outline"} data-sidebar-item-id={item.id} className={`settings-api-provider-card${item.type !== "provider" ? " settings-api-provider-card--fixed" : ""}${isDragging ? " is-dragging" : ""}`} aria-label={item.type === "libtv" ? t("settings:libtvCliSettings") : item.type === "apimart" ? t("settings:apimartSettings") : undefined} onClick={() => {
                  if (item.type === "libtv") setActivePane("libtv");
                  else { setSelectedProviderId(item.id); setActivePane(item.type === "apimart" ? "apimart" : "provider"); }
                }}>
                  {renderSidebarContent(item, dragHandleProps)}
                </Button>
              );
            }}
          />
          <Button type="button" className="w-full" onClick={addProvider}><Plus data-icon="inline-start" aria-hidden="true" /><span>{t("settings:addProvider")}</span></Button>
        </aside>

        <main className="settings-api-content">
          {activePane === "libtv" ? (
            <LibtvSettingsPane
              machineId={libtvMachineId}
              actionFissionConcurrency={libtvActionFissionConcurrency}
              onMachineIdChange={setLibtvMachineId}
              onActionFissionConcurrencyChange={setLibtvActionFissionConcurrency}
            />
          ) : activePane === "apimart" && selectedProvider?.id === APIMART_PROVIDER_ID ? (
            <><ApimartSettingsPane provider={selectedProvider} fetchingModels={action === "fetch"} status={status} onProviderChange={patchSelectedProvider} onFetchModels={fetchModels} />{renderModelList("image")}{renderModelList("chat")}{renderModelList("video")}</>
          ) : selectedProvider ? (
            <>
              <header className="settings-api-content-head"><div><h2>{selectedProvider.name || t("settings:provider")}</h2></div><div className="settings-api-content-actions"><ConfirmingDeleteButton label={t("settings:deleteProvider")} confirmLabel={t("common:bulk.confirmDelete")} resetKey={selectedProvider.id} cancelLabel={t("common:actions.cancel")} onDelete={deleteSelectedProvider} /></div></header>
              <section className="settings-api-block">
                <div className="settings-api-block-head"><div><h3>{t("settings:basicInfo")}</h3></div></div>
                <div className="settings-api-form">
                  <label className="settings-field"><span>{t("settings:providerName")}</span><input value={selectedProvider.name} onChange={(event) => patchSelectedProvider({ name: event.target.value })} placeholder={t("settings:providerNamePlaceholder")} /></label>
                  <label className="settings-field"><span>{t("settings:baseUrl")}</span><input value={selectedProvider.baseUrl} onChange={(event) => patchSelectedProvider({ baseUrl: event.target.value })} placeholder="https://api.example.com/v1" /></label>
                  <label className="settings-field"><span>{t("settings:apiKey")}</span><input type="password" value={selectedProvider.apiKey} onChange={(event) => patchSelectedProvider({ apiKey: event.target.value })} placeholder={t("settings:apiKeyPlaceholder")} /></label>
                  <div className="settings-api-control-row" data-has-request-mode={selectedProvider.protocol === "openai" ? "true" : "false"}>
                    <label className="settings-field"><span>{t("settings:protocol")}</span><Select value={selectedProvider.protocol} options={[{ value: "compatible", label: t("settings:protocolCompatible") }, { value: "openai", label: t("settings:protocolOpenAI") }, { value: "gemini", label: t("settings:protocolGemini") }]} onChange={(protocol) => patchSelectedProvider({ protocol: protocol as ApiProvider["protocol"] })} ariaLabel={t("settings:protocol")} menuPlacement="bottom" /></label>
                    {selectedProvider.protocol === "openai" ? <label className="settings-field"><span>{t("settings:imageRequestMode")}</span><Select value={selectedProvider.imageRequestMode} options={[{ value: "openai", label: t("settings:imageRequestModeOpenAI") }, { value: "openai-json", label: t("settings:imageRequestModeOpenAIJson") }]} onChange={(imageRequestMode) => patchSelectedProvider({ imageRequestMode: imageRequestMode as ApiProvider["imageRequestMode"] })} ariaLabel={t("settings:imageRequestMode")} menuPlacement="bottom" /></label> : null}
                    <Button type="button" className="settings-api-control-button" disabled={action !== ""} onClick={verifyAddress}><TestTube2 data-icon="inline-start" aria-hidden="true" /><span>{action === "verify" ? t("settings:apiVerifying") : t("settings:verifyAddress")}</span></Button>
                    <Button type="button" className="settings-api-control-button" disabled={action !== ""} onClick={fetchModels}><RefreshCw data-icon="inline-start" aria-hidden="true" /><span>{action === "fetch" ? t("settings:apiFetching") : t("settings:fetchModels")}</span></Button>
                  </div>
                  {status.text && (status.tone === "ready" || status.tone === "error") ? status.tone === "error" ? <ErrorCopyLine className="settings-inline-status settings-api-action-status" text={status.text} ariaLive="polite" /> : <div className="settings-inline-status settings-api-action-status" data-tone={status.tone} aria-live="polite">{status.text}</div> : null}
                </div>
              </section>
              {renderModelList("image")}{renderModelList("chat")}{renderModelList("video")}
            </>
          ) : <section className="settings-section settings-section--api"><div className="settings-empty-state"><KeyRound size={22} aria-hidden="true" /><p>{t("settings:noApiProviders")}</p><Button type="button" onClick={addProvider}><Plus data-icon="inline-start" aria-hidden="true" /><span>{t("settings:addProvider")}</span></Button></div></section>}
        </main>
        </div>
      )}

      {settingsLoaded && modelPickerOpen && selectedProvider ? createPortal(
        <div className="settings-api-modal-backdrop" role="presentation" onMouseDown={() => setModelPickerOpen(false)}>
          <section className="settings-api-model-picker" role="dialog" aria-modal="true" aria-label={t("settings:selectModels")} onMouseDown={(event) => event.stopPropagation()}>
            <header className="settings-api-model-picker-head"><div><h2>{t("settings:selectModels")}</h2><p>{t("settings:selectModelsDescription", { total: fetchedModelCounts.all })}</p></div><Button type="button" variant="ghost" onClick={() => setModelPickerOpen(false)}>{t("common:actions.cancel")}</Button></header>
            <div className="settings-api-model-picker-tools"><SearchInput className="settings-api-model-search" value={modelPickerFilter} onChange={setModelPickerFilter} placeholder={t("settings:searchModels")} clearLabel={t("modelLibrary:clearSearch")} /><NativeTabs items={modelPickerTabs} value={modelPickerTab} onChange={setModelPickerTab} ariaLabel={t("settings:modelList")} className="settings-api-picker-tabs" /></div>
            <div className="settings-api-picker-bulk"><span>{t("settings:visibleModelCount", { count: filteredFetchedModels.length })}</span><div><Button type="button" variant="ghost" size="sm" onClick={() => { const ids = new Set(filteredFetchedModels.map((model) => model.id)); setFetchedModels((current) => current.map((model) => ids.has(model.id) ? { ...model, selected: true } : model)); }}>{t("settings:selectVisible")}</Button><Button type="button" variant="ghost" size="sm" onClick={() => { const ids = new Set(filteredFetchedModels.map((model) => model.id)); setFetchedModels((current) => current.map((model) => ids.has(model.id) ? { ...model, selected: false } : model)); }}>{t("settings:clearVisible")}</Button></div></div>
            <VirtualList items={filteredFetchedModels} className="settings-api-picker-list settings-virtual-list" viewportClassName="settings-virtual-list__viewport settings-api-picker-list__viewport" estimateSize={58} overscan={8} getItemKey={(model) => model.id} renderItem={(model) => <div className={`settings-api-picker-row${model.selected ? " selected" : ""}`}><label><input type="checkbox" checked={model.selected} onChange={() => setFetchedModels((current) => current.map((item) => item.id === model.id ? { ...item, selected: !item.selected } : item))} /><span title={model.id}>{model.id}</span></label><Select value={model.kind} options={[{ value: "image", label: t("settings:imageModels") }, { value: "chat", label: t("settings:chatModels") }, { value: "video", label: t("settings:videoModels") }]} onChange={(kind) => setFetchedModels((current) => current.map((item) => item.id === model.id ? { ...item, kind: kind as ApiModelKind } : item))} ariaLabel={t("settings:selectModels")} menuPlacement="bottom" /></div>} spacerClassName="settings-virtual-list__spacer" itemClassName="settings-virtual-list__item" empty={<div className="settings-api-picker-empty">{t("settings:noMatchingModels")}</div>} />
            <footer className="settings-api-model-picker-foot"><div className="settings-api-picker-summary"><span>{t("settings:selectedModelCount", { count: fetchedModelCounts.selected })}</span><span>{t("settings:imageModels")}: {fetchedModels.filter((model) => model.selected && model.kind === "image").length}</span><span>{t("settings:chatModels")}: {fetchedModels.filter((model) => model.selected && model.kind === "chat").length}</span><span>{t("settings:videoModels")}: {fetchedModels.filter((model) => model.selected && model.kind === "video").length}</span></div><Button type="button" disabled={!fetchedModelCounts.selected} onClick={applyFetchedModels}>{t("settings:importSelectedModels")}</Button></footer>
          </section>
        </div>, document.body,
      ) : null}
    </>
  );
}
