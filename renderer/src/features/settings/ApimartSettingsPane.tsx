import { RefreshCw, TestTube2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorCopyLine } from "../../components/ErrorCopyLine";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { APIMART_BASE_URLS, APIMART_PROVIDER_ID, type ApiProvider } from "./apiProviders";

export interface ApiPanelStatus {
  tone: "idle" | "ready" | "error" | "busy";
  text: string;
}

interface ApimartSettingsPaneProps {
  provider: ApiProvider;
  fetchingModels: boolean;
  status: ApiPanelStatus;
  onProviderChange: (patch: Partial<ApiProvider>) => void;
  onFetchModels: () => void;
}

type EndpointTest = {
  state: "testing" | "reachable" | "failed";
  latencyMs?: number;
  statusCode?: number;
};

type BalanceState = {
  status: "idle" | "loading" | "ready" | "error";
  remainCredits?: number;
  usedCredits?: number;
};

export function ApimartLogo() {
  return (
    <>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="480 500 1100 1040" fill="currentColor" aria-hidden="true">
        <path d="M 508 528 L 509 1514 L 586 1514 L 588 1512 L 587 610 L 589 607 L 670 607 L 1022 1009 L 1027 1007 L 1388 607 L 1467 607 L 1469 609 L 1470 738 L 1469 1513 L 1551 1513 L 1551 528 L 1350 528 L 1026 901 L 841 687 L 707 528 Z" />
      </svg>
      <span>APIMart</span>
    </>
  );
}

function endpointTone(result: EndpointTest | undefined) {
  if (!result || result.state === "testing") return "idle";
  if (result.state === "failed" || (result.latencyMs || 0) > 700) return "slow";
  if ((result.latencyMs || 0) > 300) return "medium";
  return "fast";
}

export function ApimartSettingsPane({ provider, fetchingModels, status, onProviderChange, onFetchModels }: ApimartSettingsPaneProps) {
  const { t } = useTranslation();
  const balanceRequestRef = useRef(0);
  const [testingEndpoints, setTestingEndpoints] = useState(false);
  const [endpointTests, setEndpointTests] = useState<Record<string, EndpointTest>>({});
  const [balance, setBalance] = useState<BalanceState>({ status: "idle" });

  async function testEndpoints() {
    setTestingEndpoints(true);
    setEndpointTests(Object.fromEntries(APIMART_BASE_URLS.map((baseUrl) => [baseUrl, { state: "testing" }])));
    const headers: HeadersInit = { Accept: "application/json" };
    await Promise.all(APIMART_BASE_URLS.map(async (baseUrl) => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 10_000);
      const startedAt = performance.now();
      try {
        const response = await fetch(`${baseUrl}/models`, { method: "GET", headers, cache: "no-store", signal: controller.signal });
        const latencyMs = Math.max(1, Math.round(performance.now() - startedAt));
        void response.body?.cancel().catch(() => undefined);
        setEndpointTests((current) => ({ ...current, [baseUrl]: { state: "reachable", latencyMs, statusCode: response.status } }));
      } catch {
        setEndpointTests((current) => ({ ...current, [baseUrl]: { state: "failed" } }));
      } finally {
        window.clearTimeout(timeout);
      }
    }));
    setTestingEndpoints(false);
  }

  const refreshBalance = useCallback(async (nextProvider: ApiProvider) => {
    if (nextProvider.id !== APIMART_PROVIDER_ID || !nextProvider.apiKey.trim()) {
      setBalance({ status: "idle" });
      return;
    }
    const requestId = balanceRequestRef.current + 1;
    balanceRequestRef.current = requestId;
    setBalance((current) => ({ ...current, status: "loading" }));
    try {
      const requestOptions: RequestInit = {
        method: "GET",
        headers: { Accept: "application/json", Authorization: `Bearer ${nextProvider.apiKey.trim()}` },
        cache: "no-store",
      };
      const [userResponse, tokenResponse] = await Promise.all([
        fetch(`${nextProvider.baseUrl}/user/balance`, requestOptions),
        fetch(`${nextProvider.baseUrl}/balance`, requestOptions),
      ]);
      const [userPayload, tokenPayload] = await Promise.all([
        userResponse.json() as Promise<Record<string, unknown>>,
        tokenResponse.json() as Promise<Record<string, unknown>>,
      ]);
      if (!userResponse.ok || userPayload.success !== true) throw new Error(String(userPayload.message || userResponse.status));
      if (!tokenResponse.ok || tokenPayload.success !== true) throw new Error(String(tokenPayload.message || tokenResponse.status));
      if (balanceRequestRef.current !== requestId) return;
      const toNumber = (value: unknown) => {
        const number = Number(value);
        return Number.isFinite(number) ? number : 0;
      };
      setBalance({ status: "ready", remainCredits: toNumber(userPayload.remain_credits), usedCredits: toNumber(tokenPayload.used_credits) });
    } catch {
      if (balanceRequestRef.current === requestId) setBalance({ status: "error" });
    }
  }, []);

  useEffect(() => {
    if (!provider.apiKey.trim()) {
      balanceRequestRef.current += 1;
      setBalance({ status: "idle" });
      return;
    }
    const timeout = window.setTimeout(() => void refreshBalance(provider), 500);
    return () => {
      window.clearTimeout(timeout);
      balanceRequestRef.current += 1;
    };
  }, [provider, refreshBalance]);

  const formatBalanceValue = (value: number | undefined) => {
    if (balance.status === "loading") return t("settings:apimartBalanceLoading");
    if (balance.status === "error") return t("settings:apimartBalanceUnavailable");
    return balance.status === "ready" ? value?.toLocaleString() : "--";
  };

  return (
    <>
      <header className="settings-api-content-head">
        <div>
          <h2>APImart</h2>
          <p>{t("settings:apimartDescription")}</p>
        </div>
        <div className="settings-apimart-balance" data-state={balance.status}>
          <div className="settings-apimart-balance-metric">
            <span>{t("settings:apimartRemainingCredits")}</span>
            <strong>{formatBalanceValue(balance.remainCredits)}</strong>
          </div>
          <div className="settings-apimart-balance-metric">
            <span>{t("settings:apimartTokenUsedCredits")}</span>
            <strong>{formatBalanceValue(balance.usedCredits)}</strong>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" disabled={!provider.apiKey.trim() || balance.status === "loading"} aria-label={t("settings:apimartRefreshBalance")} title={t("settings:apimartRefreshBalance")} onClick={() => void refreshBalance(provider)}>
            <RefreshCw aria-hidden="true" />
          </Button>
        </div>
      </header>

      <section className="settings-api-block">
        <div className="settings-api-block-head"><div><h3>{t("settings:apimartConnection")}</h3></div></div>
        <div className="settings-api-form">
          <div className="settings-field">
            <div className="settings-apimart-field-head">
              <span>{t("settings:apimartEndpoint")}</span>
              <Button type="button" variant="ghost" size="xs" disabled={testingEndpoints || fetchingModels} onClick={testEndpoints}>
                <TestTube2 data-icon="inline-start" aria-hidden="true" />
                <span>{testingEndpoints ? t("settings:apimartTestingEndpoints") : t("settings:apimartTestEndpoints")}</span>
              </Button>
            </div>
            <div className="settings-apimart-endpoint-list">
              {APIMART_BASE_URLS.map((baseUrl, index) => {
                const result = endpointTests[baseUrl];
                const selected = provider.baseUrl === baseUrl;
                const resultLabel = result?.state === "testing" ? t("settings:apimartTestingShort") : result?.state === "failed" ? t("settings:apimartEndpointFailed") : result?.latencyMs ? `${result.latencyMs}ms` : "";
                return (
                  <Button key={baseUrl} type="button" variant={selected ? "default" : "outline"} className="settings-apimart-endpoint-button" data-latency-tone={endpointTone(result)} aria-pressed={selected} title={result?.statusCode ? `${baseUrl} - HTTP ${result.statusCode}` : baseUrl} onClick={() => onProviderChange({ baseUrl })}>
                    <span className="settings-apimart-endpoint-dot" aria-hidden="true" />
                    <span className="settings-apimart-endpoint-label">{t("settings:apimartEndpointOption", { index: index + 1 })}</span>
                    <span className="settings-apimart-endpoint-result" aria-live="polite">{resultLabel}</span>
                  </Button>
                );
              })}
            </div>
          </div>
          <div className="settings-field">
            <span>{t("settings:apiKey")}</span>
            <div className="settings-apimart-api-key-row">
              <Input type="password" value={provider.apiKey} onChange={(event) => onProviderChange({ apiKey: event.target.value })} placeholder={t("settings:apiKeyPlaceholder")} />
              <Button type="button" className="settings-api-control-button" disabled={fetchingModels || testingEndpoints} onClick={onFetchModels}>
                <RefreshCw data-icon="inline-start" aria-hidden="true" />
                <span>{fetchingModels ? t("settings:apiFetching") : t("settings:fetchModels")}</span>
              </Button>
            </div>
          </div>
          {status.text && (status.tone === "ready" || status.tone === "error") ? status.tone === "error" ? (
            <ErrorCopyLine className="settings-inline-status settings-api-action-status" text={status.text} ariaLive="polite" />
          ) : (
            <div className="settings-inline-status settings-api-action-status" data-tone={status.tone} aria-live="polite">{status.text}</div>
          ) : null}
        </div>
      </section>
    </>
  );
}
