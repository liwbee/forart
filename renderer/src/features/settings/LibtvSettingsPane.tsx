import { Download, LogIn, LogOut, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LibtvAccountRecord } from "../../app/appConfig";
import { AppSelect as Select } from "../../components/AppSelect";
import { Button } from "../../components/ui/button";
import type { LibtvActionFissionConcurrency } from "./apiProviders";

type LibtvAction = "check" | "install" | "login" | "logout" | "";

interface LibtvAccountSummary {
  memberName: string;
  updatedAt: string;
}

interface LibtvPowerSummary {
  total: number | null;
  remaining: number | null;
}

interface LibtvSettingsPaneProps {
  machineId: string;
  actionFissionConcurrency: LibtvActionFissionConcurrency;
  onMachineIdChange: (machineId: string) => void;
  onActionFissionConcurrencyChange: (concurrency: LibtvActionFissionConcurrency) => void;
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

function summarizeAccount(account: unknown): LibtvAccountSummary {
  const root = asRecord(account);
  const activeAccount = asRecord(root?.activeAccount);
  const memberAccount = asRecord(activeAccount?.memberAccount);
  return {
    memberName: accountText(memberAccount?.memberName, activeAccount?.memberName, root?.memberName),
    updatedAt: new Intl.DateTimeFormat(undefined, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date()),
  };
}

export function LibtvLogo() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="77" height="17" fill="currentColor" viewBox="0 0 76.234 16.79" aria-hidden="true">
      <path d="M16.576 16.616H0l.833-4.418H17.65z" />
      <path d="m0 16.616 2.314-12.27h4.448l-2.316 12.27zM8.27 0h16.936l-.832 4.416H7.544z" />
      <path d="m25.206 0-2.314 12.27-4.512.002L20.76 0zM30.857 14.816 33.09 2.217h2.7l-1.82 10.276h4.968l-.415 2.321h-7.666zM41.025 6.328h2.556l-1.639 8.488h-2.537l1.619-8.488zm.235-2.51c0-.882.701-1.547 1.566-1.547.81 0 1.367.54 1.367 1.315 0 .882-.702 1.547-1.566 1.547-.81 0-1.367-.54-1.367-1.314M53.696 9.488c0 3.077-2.232 5.435-4.933 5.435-1.458 0-2.268-.559-2.735-1.296l-.45 1.189h-2.232L45.56 2.217h2.538l-.738 4.265c.63-.63 1.44-1.025 2.555-1.025 2.214 0 3.78 1.71 3.78 4.03m-2.574.198c0-1.422-.756-2.16-1.87-2.16-1.657 0-2.7 1.547-2.7 3.168 0 1.421.774 2.16 1.89 2.16 1.638 0 2.682-1.548 2.682-3.168zM53.929 2.217h9.934l-.395 2.321H59.85L58.03 14.814h-2.699l1.819-10.276h-3.618zM72.934 2.217h2.879l-6.497 12.599h-3.222L64.042 2.217h2.772l1.368 9.322z" />
    </svg>
  );
}

export function LibtvSettingsPane({
  machineId,
  actionFissionConcurrency,
  onMachineIdChange,
  onActionFissionConcurrencyChange,
}: LibtvSettingsPaneProps) {
  const { t } = useTranslation();
  const [action, setAction] = useState<LibtvAction>("");
  const [status, setStatus] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [available, setAvailable] = useState(false);
  const [account, setAccount] = useState<LibtvAccountSummary | null>(null);
  const [power, setPower] = useState<LibtvPowerSummary | null>(null);
  const [accounts, setAccounts] = useState<LibtvAccountRecord[]>([]);
  const [activeAccountId, setActiveAccountId] = useState("");

  const refreshStatus = useCallback(async () => {
    setAction("check");
    setStatus(t("settings:libtvChecking"));
    try {
      if (!window.libtv?.status || !window.libtv.account) throw new Error(t("settings:libtvBridgeUnavailable"));
      const statusResult = await window.libtv.status();
      setAvailable(Boolean(statusResult.available));
      if (!statusResult.available) {
        setLoggedIn(false); setAccount(null); setPower(null); setAccounts([]); setActiveAccountId("");
        setStatus(statusResult.error || t("settings:libtvUnavailable"));
        return;
      }
      const accountResult = await window.libtv.account();
      setLoggedIn(Boolean(accountResult.loggedIn));
      setAccount(accountResult.loggedIn ? summarizeAccount(accountResult.account) : null);
      if (accountResult.loggedIn && window.libtv.power) {
        const powerResult = await window.libtv.power().catch(() => null);
        setPower(powerResult ? { total: powerResult.total, remaining: powerResult.remaining } : null);
      } else {
        setPower(null);
      }
      if (accountResult.loggedIn && window.libtv.accounts) {
        const accountsResult = await window.libtv.accounts();
        const nextAccounts = accountsResult.accounts || [];
        setAccounts(nextAccounts);
        const active = nextAccounts.find((item) => item.isActive) || nextAccounts[0];
        setActiveAccountId(active?.accountId !== undefined ? String(active.accountId) : "");
      } else {
        setAccounts([]); setActiveAccountId("");
      }
      setStatus(accountResult.loggedIn ? t("settings:libtvLoggedIn") : t("settings:libtvNotLoggedIn"));
    } catch (error) {
      setLoggedIn(false); setAvailable(false); setAccount(null); setPower(null); setAccounts([]); setActiveAccountId("");
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setAction("");
    }
  }, [t]);

  useEffect(() => { void refreshStatus(); }, [refreshStatus]);

  async function installCli() {
    setAction("install");
    try {
      if (!window.libtv?.install) throw new Error(t("settings:libtvBridgeUnavailable"));
      await window.libtv.install();
      await refreshStatus();
    } catch (error) {
      setStatus(t("settings:libtvInstallFailed", { message: error instanceof Error ? error.message : String(error) }));
    } finally { setAction(""); }
  }

  async function loginWeb() {
    setAction("login");
    try {
      if (!window.libtv?.loginWeb) throw new Error(t("settings:libtvBridgeUnavailable"));
      await window.libtv.loginWeb();
      await refreshStatus();
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setAction(""); }
  }

  async function switchAccount(accountId: string) {
    if (!accountId || accountId === activeAccountId) return;
    setAction("check"); setActiveAccountId(accountId);
    try {
      if (!window.libtv?.useAccount) throw new Error(t("settings:libtvBridgeUnavailable"));
      await window.libtv.useAccount(accountId);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally { await refreshStatus(); }
  }

  async function logout() {
    setAction("logout");
    try {
      if (!window.libtv?.logout) throw new Error(t("settings:libtvBridgeUnavailable"));
      await window.libtv.logout();
      setLoggedIn(false); setAccount(null); setPower(null); setAccounts([]); setActiveAccountId("");
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setAction(""); }
  }

  const accountTypeLabel = (item: LibtvAccountRecord) => item.accountType === 2 ? t("settings:libtvTeamAccount") : t("settings:libtvPersonalAccount");
  const pointsValue = typeof power?.remaining === "number" && typeof power.total === "number"
    ? `${power.remaining}/${power.total}`
    : "-";

  return (
    <section className="settings-api-block settings-libtv-card">
      <div className="settings-libtv-brand-panel">
        <span className="settings-api-provider-logo settings-api-provider-logo--head settings-libtv-brand-logo"><LibtvLogo /></span>
        <div className="settings-libtv-install-control">
          {available ? (
            <Button type="button" variant="ghost" disabled={action !== ""} onClick={installCli} aria-label={t("settings:libtvUpdateCli")} title={t("settings:libtvUpdateCli")}>
              <RefreshCw data-icon="inline-start" aria-hidden="true" /><span>{action === "install" ? t("settings:libtvInstallingButton") : t("settings:libtvInstalled")}</span>
            </Button>
          ) : (
            <Button type="button" disabled={action !== ""} onClick={installCli}>
              <Download data-icon="inline-start" aria-hidden="true" /><span>{action === "install" ? t("settings:libtvInstallingButton") : t("settings:libtvInstallCli")}</span>
            </Button>
          )}
        </div>
      </div>
      <div className="settings-libtv-account-panel">
        <div className="settings-libtv-account-controls">
          <label className="settings-libtv-account-switcher">
            <span>{t("settings:libtvAccountName")}</span>
            <Select value={activeAccountId} disabled={action !== "" || !accounts.length} onChange={(accountId) => void switchAccount(accountId)} options={accounts.length ? accounts.map((item) => ({ value: String(item.accountId ?? ""), label: `${item.accountName || item.accountId || "-"} · ${accountTypeLabel(item)}` })) : [{ value: "", label: t("settings:libtvNoAccounts") }]} ariaLabel={t("settings:libtvAccountName")} menuPlacement="bottom" />
          </label>
          <label className="settings-libtv-account-switcher settings-libtv-machine-id">
            <span>{t("settings:libtvMachineId")}</span>
            <input
              value={machineId}
              maxLength={32}
              pattern="[A-Za-z0-9]*"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder={t("settings:libtvMachineIdPlaceholder")}
              title={t("settings:libtvMachineIdDescription")}
              onChange={(event) => onMachineIdChange(event.target.value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 32))}
            />
          </label>
          <label className="settings-libtv-concurrency">
            <span>{t("settings:libtvActionFissionConcurrency")}</span>
            <Select
              value={String(actionFissionConcurrency)}
              size="sm"
              menuPlacement="bottom"
              ariaLabel={t("settings:libtvActionFissionConcurrency")}
              options={Array.from({ length: 10 }, (_, index) => index + 1).map((count) => ({
                value: String(count),
                label: String(count),
              })).concat({ value: "0", label: t("settings:libtvConcurrencyUnlimited") })}
              onChange={(value) => onActionFissionConcurrencyChange(Number(value) as LibtvActionFissionConcurrency)}
            />
          </label>
        </div>
        <div className="settings-libtv-account-grid">
          <div className="settings-cache-metric settings-libtv-metric">
            <span>{t("settings:libtvPointsInfo")}</span>
            <strong title={pointsValue}>{pointsValue}</strong>
          </div>
          <div className="settings-cache-metric settings-libtv-metric">
            <span>{t("settings:libtvPlanInfo")}</span>
            <strong title={account?.memberName || "-"}>{account?.memberName || "-"}</strong>
          </div>
          <div className="settings-cache-metric settings-libtv-metric">
            <span>{t("settings:libtvAccountUpdatedAt")}</span>
            <strong title={account?.updatedAt || "-"}>{account?.updatedAt || "-"}</strong>
          </div>
        </div>
        <div className="settings-api-test-actions">
          {loggedIn ? (
            <>
              <Button type="button" variant="ghost" disabled={action !== ""} onClick={refreshStatus}><RefreshCw data-icon="inline-start" aria-hidden="true" /><span>{action === "check" ? t("settings:libtvCheckingButton") : t("settings:libtvLoggedInShort")}</span></Button>
              <Button type="button" variant="ghost" disabled={action !== ""} onClick={logout}><LogOut data-icon="inline-start" aria-hidden="true" /><span>{t("settings:libtvLogout")}</span></Button>
            </>
          ) : available ? (
            <Button type="button" disabled={action !== ""} onClick={loginWeb}><LogIn data-icon="inline-start" aria-hidden="true" /><span>{action === "login" ? t("settings:libtvLoginWaiting") : t("settings:libtvLoginWeb")}</span></Button>
          ) : null}
        </div>
        {status ? <div className="settings-inline-status" aria-live="polite">{status}</div> : null}
      </div>
    </section>
  );
}
