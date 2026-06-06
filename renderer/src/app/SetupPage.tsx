import { FolderOpen, Languages, Monitor, Server } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ForartAppConfig, ForartMode, normalizeConfig } from "./appConfig";
import { SUPPORTED_LANGUAGES, SupportedLanguage } from "../i18n";

interface SetupPageProps {
  initialConfig: ForartAppConfig | null;
  onConfigured: (config: ForartAppConfig) => void;
}

export function SetupPage({ initialConfig, onConfigured }: SetupPageProps) {
  const { i18n, t } = useTranslation();
  const [mode, setMode] = useState<ForartMode>(initialConfig?.mode || "local");
  const [localLibraryPath, setLocalLibraryPath] = useState(initialConfig?.localLibraryPath || "");
  const [serverUrl, setServerUrl] = useState(initialConfig?.serverUrl || "");
  const [accessToken, setAccessToken] = useState(initialConfig?.accessToken || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const canSubmit = useMemo(() => {
    if (mode === "local") return localLibraryPath.trim().length > 0;
    return serverUrl.trim().length > 0;
  }, [localLibraryPath, mode, serverUrl]);

  async function chooseDirectory() {
    setError("");
    const result = await window.forartConfig?.chooseDirectory();
    if (result && !result.canceled) setLocalLibraryPath(result.path);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");

    if (mode === "local" && !localLibraryPath.trim()) {
      setError(t("setup.saveLocalPathRequired"));
      return;
    }

    if (mode === "remote" && !serverUrl.trim()) {
      setError(t("setup.saveServerUrlRequired"));
      return;
    }

    const nextConfig = normalizeConfig({
      mode,
      localLibraryPath,
      serverUrl,
      accessToken,
    });

    setSaving(true);
    try {
      const result = await window.forartConfig?.save(nextConfig);
      onConfigured(result?.config || nextConfig);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }

  function changeLanguage(language: SupportedLanguage) {
    void i18n.changeLanguage(language);
  }

  return (
    <main className="setup-shell">
      <section className="setup-panel" aria-label={t("setup.label")}>
        <div className="setup-head">
          <div className="brand setup-brand" aria-label="Forart">
            <span className="brand-mark" aria-hidden="true" />
            <strong className="brand-name">Forart</strong>
          </div>
          <p>{t("setup.description")}</p>
        </div>

        <form className="setup-form" onSubmit={handleSubmit}>
          <div className="setup-mode-grid" role="radiogroup" aria-label={t("setup.usageMode")}>
            <button
              className={`setup-mode${mode === "local" ? " active" : ""}`}
              type="button"
              aria-pressed={mode === "local"}
              onClick={() => setMode("local")}
            >
              <Monitor size={22} aria-hidden="true" />
              <span>
                <strong>{t("setup.localUse")}</strong>
                <small>{t("setup.localUseDescription")}</small>
              </span>
            </button>

            <button
              className={`setup-mode${mode === "remote" ? " active" : ""}`}
              type="button"
              aria-pressed={mode === "remote"}
              onClick={() => setMode("remote")}
            >
              <Server size={22} aria-hidden="true" />
              <span>
                <strong>{t("setup.remoteUse")}</strong>
                <small>{t("setup.remoteUseDescription")}</small>
              </span>
            </button>
          </div>

          {mode === "local" ? (
            <label className="setup-field">
              <span>{t("setup.localLibraryPath")}</span>
              <div className="setup-path-row">
                <input value={localLibraryPath} onChange={(event) => setLocalLibraryPath(event.target.value)} placeholder="D:/ForartLibrary" />
                <button className="setup-icon-button" type="button" title={t("setup.chooseDirectory")} aria-label={t("setup.chooseDirectory")} onClick={chooseDirectory}>
                  <FolderOpen size={18} aria-hidden="true" />
                </button>
              </div>
            </label>
          ) : (
            <>
              <label className="setup-field">
                <span>{t("setup.serverUrl")}</span>
                <input value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} placeholder="http://192.168.1.20:5175" />
              </label>

              <label className="setup-field">
                <span>{t("setup.accessToken")}</span>
                <input value={accessToken} onChange={(event) => setAccessToken(event.target.value)} placeholder={t("setup.accessTokenPlaceholder")} />
              </label>
            </>
          )}

          <div className="settings-section__head">
            <Languages size={18} aria-hidden="true" />
            <h2>{t("settings.languageSection")}</h2>
          </div>
          <div className="settings-mode-group" role="radiogroup" aria-label={t("settings.language")}>
            {SUPPORTED_LANGUAGES.map((language) => (
              <button
                key={language}
                className={`settings-mode${i18n.language === language ? " active" : ""}`}
                type="button"
                aria-pressed={i18n.language === language}
                onClick={() => changeLanguage(language)}
              >
                <strong>{language === "zh-CN" ? t("settings.chinese") : t("settings.english")}</strong>
              </button>
            ))}
          </div>

          {error ? <div className="setup-error">{error}</div> : null}

          <button className="setup-submit" type="submit" disabled={!canSubmit || saving}>
            {saving ? t("setup.saving") : t("setup.enter")}
          </button>
        </form>
      </section>
    </main>
  );
}
