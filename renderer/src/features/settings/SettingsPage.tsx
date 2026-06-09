import { FolderOpen, KeyRound, Plus, RefreshCw, Save, Server, Settings, TestTube2, Trash2 } from "lucide-react";
import { FormEvent, PointerEvent, UIEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ForartAppConfig, ForartMode, normalizeConfig } from "../../app/appConfig";
import { createApiProvider, loadApiSettings, normalizeApiProvider, readApiProviders, readDefaultImageProviderId, saveApiSettings, uniqueModels, type ApiProvider } from "./apiProviders";

interface SettingsPageProps {
  config: ForartAppConfig;
  onConfigChange: (config: ForartAppConfig) => void;
}

interface StatusState {
  tone: "idle" | "ready" | "error" | "busy";
  text: string;
}

type SettingsTab = "general" | "api";
type ApiModelKind = "image" | "chat" | "video";
type ApiAction = "verify" | "fetch" | "";

interface FetchedModelEntry {
  id: string;
  kind: ApiModelKind;
  selected: boolean;
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

export function SettingsPage({ config, onConfigChange }: SettingsPageProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [mode, setMode] = useState<ForartMode>(config.mode);
  const [localLibraryPath, setLocalLibraryPath] = useState(config.localLibraryPath);
  const [imageDownloadPath, setImageDownloadPath] = useState(config.imageDownloadPath);
  const [serverUrl, setServerUrl] = useState(config.serverUrl);
  const [accessToken, setAccessToken] = useState(config.accessToken);
  const [status, setStatus] = useState<StatusState>({ tone: "idle", text: t("settings.loaded") });
  const [localStatus, setLocalStatus] = useState<StatusState>({ tone: "idle", text: t("settings.localStatusIdle") });
  const [saving, setSaving] = useState(false);
  const [apiProviders, setApiProviders] = useState<ApiProvider[]>(readApiProviders);
  const [selectedProviderId, setSelectedProviderId] = useState(() => readApiProviders()[0]?.id || "");
  const [defaultImageProviderId, setDefaultImageProviderId] = useState(readDefaultImageProviderId);
  const [apiAction, setApiAction] = useState<ApiAction>("");
  const [apiStatus, setApiStatus] = useState<StatusState>({ tone: "idle", text: t("settings.apiActionReady") });
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelPickerFilter, setModelPickerFilter] = useState("");
  const [modelPickerTab, setModelPickerTab] = useState<ApiModelKind | "all">("all");
  const [fetchedModels, setFetchedModels] = useState<FetchedModelEntry[]>([]);
  const [apiSettingsLoaded, setApiSettingsLoaded] = useState(false);
  const [modelScrollbars, setModelScrollbars] = useState<Record<ApiModelKind, { top: number; height: number; visible: boolean }>>({
    image: { top: 0, height: 0, visible: false },
    chat: { top: 0, height: 0, visible: false },
    video: { top: 0, height: 0, visible: false },
  });
  const selectedProvider = apiProviders.find((provider) => provider.id === selectedProviderId) || apiProviders[0] || null;

  useEffect(() => {
    setMode(config.mode);
    setLocalLibraryPath(config.localLibraryPath);
    setImageDownloadPath(config.imageDownloadPath);
    setServerUrl(config.serverUrl);
    setAccessToken(config.accessToken);
  }, [config]);

  useEffect(() => {
    let canceled = false;
    async function loadStoredApiSettings() {
      const settings = await loadApiSettings();
      if (canceled) return;
      setApiProviders(settings.providers);
      setDefaultImageProviderId(settings.defaultImageProviderId);
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
    void saveApiSettings({ providers: apiProviders, defaultImageProviderId });
    if (apiProviders.length && !apiProviders.some((provider) => provider.id === selectedProviderId)) {
      setSelectedProviderId(apiProviders[0].id);
    }
    if (!apiProviders.length && selectedProviderId) setSelectedProviderId("");
    if (apiProviders.length && defaultImageProviderId && !apiProviders.some((provider) => provider.id === defaultImageProviderId)) {
      const nextDefault = apiProviders.find((provider) => provider.imageModels.length)?.id || apiProviders[0].id;
      setDefaultImageProviderId(nextDefault);
    }
    if (!apiProviders.length && defaultImageProviderId) {
      setDefaultImageProviderId("");
    }
  }, [apiProviders, apiSettingsLoaded, defaultImageProviderId, selectedProviderId]);

  useEffect(() => {
    setApiStatus({ tone: "idle", text: t("settings.apiActionReady") });
    setApiAction("");
    setModelPickerOpen(false);
    setFetchedModels([]);
    setModelPickerFilter("");
    setModelPickerTab("all");
  }, [selectedProviderId, t]);

  useEffect(() => {
    window.requestAnimationFrame(() => {
      (["image", "chat", "video"] as ApiModelKind[]).forEach((kind) => {
        const list = document.querySelector<HTMLElement>(`.settings-api-model-list[data-kind="${kind}"]`);
        if (list) updateModelScrollbar(kind, list);
      });
    });
  }, [selectedProvider?.imageModels.length, selectedProvider?.chatModels.length, selectedProvider?.videoModels.length]);

  async function chooseDirectory() {
    const result = await window.forartConfig?.chooseDirectory();
    if (result && !result.canceled) setLocalLibraryPath(result.path);
  }

  async function chooseImageDownloadDirectory() {
    const result = await window.forartConfig?.chooseDirectory();
    if (result && !result.canceled) setImageDownloadPath(result.path);
  }

  async function refreshLocalStatus() {
    setLocalStatus({ tone: "busy", text: t("settings.localStatusBusy") });
    const result = await window.forartConfig?.localServerStatus();
    if (result?.ok) {
      setLocalStatus({
        tone: "ready",
        text: result.managed ? t("settings.localStatusManaged") : t("settings.localStatusExternal"),
      });
      return;
    }
    setLocalStatus({ tone: "error", text: result?.error || t("settings.localStatusDisconnected") });
  }

  async function testRemoteServer() {
    setStatus({ tone: "busy", text: t("settings.testingServer") });
    const result = await window.forartConfig?.testServer(serverUrl);
    if (result?.ok) {
      setStatus({ tone: "ready", text: t("settings.serverOk") });
      return;
    }
    setStatus({ tone: "error", text: result?.error || `${t("settings.connectionFailed")}${result?.status ? ` (${result.status})` : ""}` });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const nextConfig = normalizeConfig({ mode, localLibraryPath, imageDownloadPath, serverUrl, accessToken });

    if (nextConfig.mode === "local" && !nextConfig.localLibraryPath) {
      setStatus({ tone: "error", text: t("settings.localPathRequired") });
      return;
    }

    if (nextConfig.mode === "remote" && !nextConfig.serverUrl) {
      setStatus({ tone: "error", text: t("settings.serverUrlRequired") });
      return;
    }

    setSaving(true);
    setStatus({ tone: "busy", text: t("settings.savingConfig") });
    try {
      const result = await window.forartConfig?.save(nextConfig);
      onConfigChange(result?.config || nextConfig);
      setStatus({ tone: "ready", text: nextConfig.mode === "local" ? t("settings.switchedLocal") : t("settings.switchedRemote") });
      if (nextConfig.mode === "local") await refreshLocalStatus();
    } catch (error) {
      setStatus({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setSaving(false);
    }
  }

  function addApiProvider() {
    setApiProviders((current) => {
      const provider = createApiProvider(current);
      setSelectedProviderId(provider.id);
      return [...current, provider];
    });
  }

  function patchSelectedProvider(patch: Partial<ApiProvider>) {
    if (!selectedProvider) return;
    setApiProviders((current) => current.map((provider) => (provider.id === selectedProvider.id ? normalizeApiProvider({ ...provider, ...patch }, current.filter((item) => item.id !== provider.id)) : provider)));
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
    setApiAction("verify");
    setApiStatus({ tone: "busy", text: t("settings.apiVerifyingAddress") });
    try {
      const models = await requestProviderModels(selectedProvider);
      if (!models.length) {
        setApiStatus({
          tone: "ready",
          text: t("settings.apiVerifyNoModels"),
        });
        return;
      }
      setApiStatus({
        tone: "ready",
        text: t("settings.apiVerifySuccess", { count: models.length }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setApiStatus({
        tone: "error",
        text: message === "base-url-required"
          ? t("settings.apiBaseUrlRequired")
          : message === "base-url-invalid"
            ? t("settings.apiBaseUrlInvalid")
            : t("settings.apiVerifyFailed", { message }),
      });
    } finally {
      setApiAction("");
    }
  }

  async function fetchApiModels() {
    if (!selectedProvider) return;
    setApiAction("fetch");
    setApiStatus({ tone: "busy", text: t("settings.apiFetchingModels") });
    try {
      const models = await requestProviderModels(selectedProvider);
      if (!models.length) {
        setApiStatus({
          tone: "error",
          text: t("settings.apiNoModelsFetched"),
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
        text: t("settings.apiFetchPickerReady", { total: models.length }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setApiStatus({
        tone: "error",
        text: message === "base-url-required"
          ? t("settings.apiBaseUrlRequired")
          : message === "base-url-invalid"
            ? t("settings.apiBaseUrlInvalid")
            : t("settings.apiFetchFailed", { message }),
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
    patchSelectedProvider({
      imageModels: uniqueModels([...(selectedProvider.imageModels || []), ...grouped.image]),
      chatModels: uniqueModels([...(selectedProvider.chatModels || []), ...grouped.chat]),
      videoModels: uniqueModels([...(selectedProvider.videoModels || []), ...grouped.video]),
    });
    setModelPickerOpen(false);
    setApiStatus({
      tone: "ready",
      text: t("settings.apiImportSuccess", {
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
      setSelectedProviderId(next[0]?.id || "");
      if (defaultImageProviderId === selectedProvider.id) {
        const nextDefault = next.find((provider) => provider.imageModels.length)?.id || next[0]?.id || "";
        setDefaultImageProviderId(nextDefault);
      }
      return next;
    });
  }

  function changeDefaultImageProvider(providerId: string) {
    setDefaultImageProviderId(providerId);
  }

  function addModel(kind: ApiModelKind) {
    if (!selectedProvider) return;
    const key = kind === "image" ? "imageModels" : kind === "chat" ? "chatModels" : "videoModels";
    patchSelectedProvider({ [key]: [...selectedProvider[key], ""] } as Partial<ApiProvider>);
  }

  function updateModel(kind: ApiModelKind, index: number, value: string) {
    if (!selectedProvider) return;
    const key = kind === "image" ? "imageModels" : kind === "chat" ? "chatModels" : "videoModels";
    patchSelectedProvider({ [key]: selectedProvider[key].map((model, modelIndex) => (modelIndex === index ? value : model)) } as Partial<ApiProvider>);
  }

  function deleteModel(kind: ApiModelKind, index: number) {
    if (!selectedProvider) return;
    const key = kind === "image" ? "imageModels" : kind === "chat" ? "chatModels" : "videoModels";
    patchSelectedProvider({ [key]: selectedProvider[key].filter((_, modelIndex) => modelIndex !== index) } as Partial<ApiProvider>);
  }

  function updateModelScrollbar(kind: ApiModelKind, element: HTMLElement) {
    const maxScroll = element.scrollHeight - element.clientHeight;
    const visible = maxScroll > 1;
    const trackHeight = element.clientHeight;
    const height = visible ? Math.max(36, Math.round((element.clientHeight / element.scrollHeight) * trackHeight)) : 0;
    const maxTop = Math.max(0, trackHeight - height);
    const top = visible ? Math.round((element.scrollTop / maxScroll) * maxTop) : 0;
    setModelScrollbars((current) => {
      const next = { top, height, visible };
      const previous = current[kind];
      if (previous.top === next.top && previous.height === next.height && previous.visible === next.visible) return current;
      return { ...current, [kind]: next };
    });
  }

  function handleModelListScroll(kind: ApiModelKind, event: UIEvent<HTMLDivElement>) {
    updateModelScrollbar(kind, event.currentTarget);
  }

  function startModelScrollbarDrag(kind: ApiModelKind, event: PointerEvent<HTMLButtonElement>) {
    const list = event.currentTarget.closest(".settings-api-model-list-wrap")?.querySelector<HTMLDivElement>(".settings-api-model-list");
    if (!list) return;
    const listElement = list;
    event.preventDefault();
    event.stopPropagation();
    const startClientY = event.clientY;
    const startScrollTop = listElement.scrollTop;
    const thumb = modelScrollbars[kind];
    const maxThumbTop = Math.max(1, listElement.clientHeight - thumb.height);
    const maxScrollTop = Math.max(1, listElement.scrollHeight - listElement.clientHeight);

    function handlePointerMove(moveEvent: globalThis.PointerEvent) {
      const delta = moveEvent.clientY - startClientY;
      listElement.scrollTop = startScrollTop + (delta / maxThumbTop) * maxScrollTop;
      updateModelScrollbar(kind, listElement);
    }

    function handlePointerUp() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  }

  function renderModelList(kind: ApiModelKind) {
    if (!selectedProvider) return null;
    const key = kind === "image" ? "imageModels" : kind === "chat" ? "chatModels" : "videoModels";
    const title = kind === "image" ? t("settings.imageModels") : kind === "chat" ? t("settings.chatModels") : t("settings.videoModels");
    const models = selectedProvider[key];
    return (
      <section className="settings-api-model-card">
        <div className="settings-api-model-head">
          <div>
            <h3>{title}</h3>
          </div>
          <button type="button" className="settings-api-small-button" onClick={() => addModel(kind)}>
            <Plus size={14} aria-hidden="true" />
            <span>{t("settings.addModel")}</span>
          </button>
        </div>
        <div className="settings-api-model-list-wrap">
          <div className="settings-api-model-list" data-kind={kind} onScroll={(event) => handleModelListScroll(kind, event)} onMouseEnter={(event) => updateModelScrollbar(kind, event.currentTarget)}>
            {models.length ? models.map((model, index) => (
              <div className="settings-api-model-row" key={`${kind}-${index}`}>
                <input value={model} onChange={(event) => updateModel(kind, index, event.target.value)} placeholder={t("settings.modelNamePlaceholder")} />
                <button type="button" aria-label={t("settings.deleteModel")} title={t("settings.deleteModel")} onClick={() => deleteModel(kind, index)}>
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </div>
            )) : <div className="settings-api-empty-row">{t("settings.noModels")}</div>}
          </div>
          {modelScrollbars[kind].visible ? (
            <div className="settings-api-custom-scrollbar" aria-hidden="true">
              <button
                type="button"
                className="settings-api-custom-scrollbar__thumb"
                style={{ height: modelScrollbars[kind].height, transform: `translateY(${modelScrollbars[kind].top}px)` }}
                tabIndex={-1}
                onPointerDown={(event) => startModelScrollbarDrag(kind, event)}
              />
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className="settings-page" aria-label={t("settings.title")}>
      <div className="settings-shell">
        <header className="settings-header">
          <div>
            <h1>{t("settings.title")}</h1>
          </div>
          <div className="settings-status" data-tone={status.tone}>
            {status.text}
          </div>
        </header>

        <nav className="settings-nav" aria-label={t("settings.settingsNavigation")} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "general"}
            className={activeTab === "general" ? "active" : ""}
            onClick={() => setActiveTab("general")}
          >
            <Settings size={16} aria-hidden="true" />
            <span>{t("settings.generalSettings")}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "api"}
            className={activeTab === "api" ? "active" : ""}
            onClick={() => setActiveTab("api")}
          >
            <KeyRound size={16} aria-hidden="true" />
            <span>{t("settings.apiSettings")}</span>
          </button>
        </nav>

        {activeTab === "general" ? (
          <form className="settings-layout" onSubmit={handleSubmit} role="tabpanel" aria-label={t("settings.generalSettings")}>
            <section className="settings-section" aria-label={t("settings.generalSettings")}>
              <div className="settings-section__head">
                <div>
                  <h2>{t("settings.generalSettings")}</h2>
                </div>
              </div>

              <div className="settings-subsection">
                <h3>{t("settings.runMode")}</h3>
                <div className="settings-segmented" role="radiogroup" aria-label={t("settings.runMode")}>
                  <button className={mode === "local" ? "active" : ""} type="button" role="radio" aria-checked={mode === "local"} onClick={() => setMode("local")}>
                    {t("settings.localMode")}
                  </button>
                  <button className={mode === "remote" ? "active" : ""} type="button" role="radio" aria-checked={mode === "remote"} onClick={() => setMode("remote")}>
                    {t("settings.remoteMode")}
                  </button>
                </div>
                <p className="settings-mode-description">
                  {mode === "local" ? t("settings.localModeDescription") : t("settings.remoteModeDescription")}
                </p>
              </div>

              {mode === "local" ? (
                <div className="settings-subsection" aria-label={t("settings.localConfig")}>
                  <div className="settings-subsection__head">
                    <FolderOpen size={20} aria-hidden="true" />
                    <h2>{t("settings.localLibrary")}</h2>
                  </div>

                  <label className="settings-field">
                    <span>{t("settings.libraryPath")}</span>
                    <div className="settings-path-row">
                      <input value={localLibraryPath} onChange={(event) => setLocalLibraryPath(event.target.value)} placeholder="D:/ForartLibrary" />
                      <button type="button" className="settings-icon-button" title={t("setup.chooseDirectory")} aria-label={t("setup.chooseDirectory")} onClick={chooseDirectory}>
                        <FolderOpen size={18} aria-hidden="true" />
                      </button>
                    </div>
                  </label>

                  <div className="settings-inline-status" data-tone={localStatus.tone}>
                    {localStatus.text}
                  </div>
                  <button className="settings-secondary-button" type="button" onClick={refreshLocalStatus}>
                    <RefreshCw size={16} aria-hidden="true" />
                    {t("settings.checkLocalServer")}
                  </button>
                </div>
              ) : (
                <div className="settings-subsection" aria-label={t("settings.serverConfig")}>
                  <div className="settings-subsection__head">
                    <Server size={20} aria-hidden="true" />
                    <h2>{t("settings.remoteServer")}</h2>
                  </div>

                  <label className="settings-field">
                    <span>{t("settings.serverUrl")}</span>
                    <input value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} placeholder="http://192.168.1.20:5175" />
                  </label>

                  <label className="settings-field">
                    <span>{t("settings.accessToken")}</span>
                    <input value={accessToken} onChange={(event) => setAccessToken(event.target.value)} placeholder={t("settings.accessTokenPlaceholder")} />
                  </label>

                  <button className="settings-secondary-button" type="button" onClick={testRemoteServer}>
                    <TestTube2 size={16} aria-hidden="true" />
                    {t("settings.testServer")}
                  </button>
                </div>
              )}

              <div className="settings-subsection" aria-label={t("settings.imageDownloadConfig")}>
                <div className="settings-subsection__head">
                  <FolderOpen size={20} aria-hidden="true" />
                  <h2>{t("settings.imageDownloadPath")}</h2>
                </div>

                <label className="settings-field">
                  <span>{t("settings.imageDownloadDirectory")}</span>
                  <div className="settings-path-row">
                    <input value={imageDownloadPath} onChange={(event) => setImageDownloadPath(event.target.value)} placeholder={t("settings.imageDownloadDefault")} />
                    <button type="button" className="settings-icon-button" title={t("setup.chooseDirectory")} aria-label={t("setup.chooseDirectory")} onClick={chooseImageDownloadDirectory}>
                      <FolderOpen size={18} aria-hidden="true" />
                    </button>
                  </div>
                </label>
                <p className="settings-mode-description">{t("settings.imageDownloadDescription")}</p>
              </div>
            </section>

            <div className="settings-actions">
              <button className="settings-submit" type="submit" disabled={saving}>
                {saving ? t("settings.saving") : t("settings.saveSettings")}
              </button>
            </div>
          </form>
        ) : (
          <div className="settings-api-layout" role="tabpanel" aria-label={t("settings.apiSettings")}>
            <aside className="settings-api-sidebar" aria-label={t("settings.providerList")}>
              <div className="settings-api-sidebar-title">{t("settings.providerList")}</div>
              <div className="settings-api-provider-list">
                {apiProviders.length ? apiProviders.map((provider) => (
                  <div
                    key={provider.id}
                    role="button"
                    tabIndex={0}
                    className={`settings-api-provider-card${provider.id === selectedProvider?.id ? " active" : ""}`}
                    onClick={() => setSelectedProviderId(provider.id)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      setSelectedProviderId(provider.id);
                    }}
                  >
                    <span
                      role="button"
                      tabIndex={0}
                      className={`settings-api-default-button${provider.id === defaultImageProviderId ? " active" : ""}`}
                      aria-pressed={provider.id === defaultImageProviderId}
                      aria-label={t("settings.defaultImageProvider")}
                      title={t("settings.defaultImageProvider")}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        changeDefaultImageProvider(provider.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        event.stopPropagation();
                        changeDefaultImageProvider(provider.id);
                      }}
                    />
                    <span className="settings-api-provider-mark">
                      <KeyRound size={15} aria-hidden="true" />
                    </span>
                    <span className="settings-api-provider-info">
                      <strong>{provider.name || provider.id}</strong>
                      <small>{provider.baseUrl || t("settings.baseUrlNotConfigured")}</small>
                    </span>
                    <span className="settings-api-provider-pill">{provider.protocol}</span>
                  </div>
                )) : <div className="settings-api-provider-empty">{t("settings.noApiProviders")}</div>}
              </div>
              <button type="button" className="settings-api-add-button" onClick={addApiProvider}>
                <Plus size={16} aria-hidden="true" />
                <span>{t("settings.addProvider")}</span>
              </button>
            </aside>

            <main className="settings-api-content">
              {selectedProvider ? (
                <>
                  <header className="settings-api-content-head">
                    <div>
                      <h2>{selectedProvider.name || t("settings.provider")}</h2>
                    </div>
                    <div className="settings-api-content-actions">
                      <button type="button" className="settings-api-action-button settings-api-action-button--danger" onClick={deleteSelectedProvider}>
                        <Trash2 size={15} aria-hidden="true" />
                        <span>{t("settings.deleteProvider")}</span>
                      </button>
                      <button type="button" className="settings-api-action-button settings-api-action-button--primary">
                        <Save size={15} aria-hidden="true" />
                        <span>{t("settings.savedLocally")}</span>
                      </button>
                    </div>
                  </header>

                  <section className="settings-api-block">
                    <div className="settings-api-block-head">
                      <div>
                        <h3>{t("settings.basicInfo")}</h3>
                      </div>
                    </div>
                    <div className="settings-api-form">
                      <label className="settings-field">
                        <span>{t("settings.providerName")}</span>
                        <input value={selectedProvider.name} onChange={(event) => patchSelectedProvider({ name: event.target.value })} placeholder={t("settings.providerNamePlaceholder")} />
                      </label>
                      <label className="settings-field">
                        <span>{t("settings.baseUrl")}</span>
                        <input value={selectedProvider.baseUrl} onChange={(event) => patchSelectedProvider({ baseUrl: event.target.value })} placeholder="https://api.example.com/v1" />
                      </label>
                      <label className="settings-field">
                        <span>{t("settings.apiKey")}</span>
                        <input type="password" value={selectedProvider.apiKey} onChange={(event) => patchSelectedProvider({ apiKey: event.target.value })} placeholder={t("settings.apiKeyPlaceholder")} />
                      </label>
                      <label className="settings-field">
                        <span>{t("settings.protocol")}</span>
                        <select value={selectedProvider.protocol} onChange={(event) => patchSelectedProvider({ protocol: event.target.value as ApiProvider["protocol"] })}>
                          <option value="openai">{t("settings.protocolOpenAI")}</option>
                          <option value="async">{t("settings.protocolAsync")}</option>
                          <option value="gemini">{t("settings.protocolGemini")}</option>
                        </select>
                      </label>
                      <div className="settings-api-test-row">
                        <div className="settings-inline-status settings-api-action-status" data-tone={apiStatus.tone}>
                          {apiStatus.text}
                        </div>
                        <div className="settings-api-test-actions">
                          <button type="button" className="settings-api-action-button" disabled={apiAction !== ""} onClick={verifyApiAddress}>
                            <TestTube2 size={15} aria-hidden="true" />
                            <span>{apiAction === "verify" ? t("settings.apiVerifying") : t("settings.verifyAddress")}</span>
                          </button>
                          <button type="button" className="settings-api-action-button settings-api-action-button--primary" disabled={apiAction !== ""} onClick={fetchApiModels}>
                            <RefreshCw size={15} aria-hidden="true" />
                            <span>{apiAction === "fetch" ? t("settings.apiFetching") : t("settings.fetchModels")}</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </section>

                  {renderModelList("image")}
                  {renderModelList("chat")}
                  {renderModelList("video")}
                </>
              ) : (
                <section className="settings-section settings-section--api" aria-label={t("settings.apiSettings")}>
                  <div className="settings-section__head">
                    <div>
                      <h2>{t("settings.apiSettings")}</h2>
                    </div>
                  </div>
                  <div className="settings-empty-state">
                    <KeyRound size={22} aria-hidden="true" />
                    <p>{t("settings.noApiProviders")}</p>
                    <button type="button" className="settings-api-add-button settings-api-add-button--inline" onClick={addApiProvider}>
                      <Plus size={16} aria-hidden="true" />
                      <span>{t("settings.addProvider")}</span>
                    </button>
                  </div>
                </section>
              )}
            </main>
          </div>
        )}

        {modelPickerOpen && selectedProvider ? (
          <div className="settings-api-modal-backdrop" role="presentation" onMouseDown={() => setModelPickerOpen(false)}>
            <section className="settings-api-model-picker" role="dialog" aria-modal="true" aria-label={t("settings.selectModels")} onMouseDown={(event) => event.stopPropagation()}>
              <header className="settings-api-model-picker-head">
                <div>
                  <h2>{t("settings.selectModels")}</h2>
                  <p>{t("settings.selectModelsDescription", { total: fetchedModelCounts.all })}</p>
                </div>
                <button type="button" className="settings-api-action-button" onClick={() => setModelPickerOpen(false)}>
                  {t("common.actions.cancel")}
                </button>
              </header>

              <div className="settings-api-model-picker-tools">
                <input value={modelPickerFilter} onChange={(event) => setModelPickerFilter(event.target.value)} placeholder={t("settings.searchModels")} />
                <div className="settings-api-picker-tabs" role="tablist" aria-label={t("settings.modelList")}>
                  {(["all", "image", "chat", "video"] as Array<ApiModelKind | "all">).map((kind) => (
                    <button key={kind} type="button" className={modelPickerTab === kind ? "active" : ""} onClick={() => setModelPickerTab(kind)}>
                      <span>{kind === "all" ? t("settings.allModels") : kind === "image" ? t("settings.imageModels") : kind === "chat" ? t("settings.chatModels") : t("settings.videoModels")}</span>
                      <small>{fetchedModelCounts[kind]}</small>
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-api-picker-bulk">
                <span>{t("settings.visibleModelCount", { count: filteredFetchedModels.length })}</span>
                <div>
                  <button type="button" className="settings-api-small-button" onClick={() => selectVisibleFetchedModels(true)}>{t("settings.selectVisible")}</button>
                  <button type="button" className="settings-api-small-button" onClick={() => selectVisibleFetchedModels(false)}>{t("settings.clearVisible")}</button>
                </div>
              </div>

              <div className="settings-api-picker-list">
                {filteredFetchedModels.length ? filteredFetchedModels.map((model) => (
                  <div className={`settings-api-picker-row${model.selected ? " selected" : ""}`} key={model.id}>
                    <label>
                      <input type="checkbox" checked={model.selected} onChange={() => toggleFetchedModel(model.id)} />
                      <span title={model.id}>{model.id}</span>
                    </label>
                    <select value={model.kind} onChange={(event) => patchFetchedModelKind(model.id, event.target.value as ApiModelKind)}>
                      <option value="image">{t("settings.imageModels")}</option>
                      <option value="chat">{t("settings.chatModels")}</option>
                      <option value="video">{t("settings.videoModels")}</option>
                    </select>
                  </div>
                )) : <div className="settings-api-picker-empty">{t("settings.noMatchingModels")}</div>}
              </div>

              <footer className="settings-api-model-picker-foot">
                <div className="settings-api-picker-summary">
                  <span>{t("settings.selectedModelCount", { count: fetchedModelCounts.selected })}</span>
                  <span>{t("settings.imageModels")}: {fetchedModels.filter((model) => model.selected && model.kind === "image").length}</span>
                  <span>{t("settings.chatModels")}: {fetchedModels.filter((model) => model.selected && model.kind === "chat").length}</span>
                  <span>{t("settings.videoModels")}: {fetchedModels.filter((model) => model.selected && model.kind === "video").length}</span>
                </div>
                <button type="button" className="settings-api-action-button settings-api-action-button--primary" disabled={!fetchedModelCounts.selected} onClick={applyFetchedModels}>
                  {t("settings.importSelectedModels")}
                </button>
              </footer>
            </section>
          </div>
        ) : null}
      </div>
    </section>
  );
}
