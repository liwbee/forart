import { useTranslation } from "react-i18next";
import { ConfirmingDeleteButton } from "../../components/ConfirmingDeleteButton";
import { Input } from "../../components/ui/input";
import type { ApiProvider } from "./apiProviders";

interface TudouSettingsPaneProps {
  provider: ApiProvider;
  onProviderChange: (patch: Partial<ApiProvider>) => void;
  onRemove: () => void;
}

export function TudouLogo() {
  return (
    <>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
        <path d="M19.967 7.946a1.4 1.4 0 1 0 0-2.8a1.4 1.4 0 0 0 0 2.8m.36 5.55a1.83 1.83 0 1 1-3.66 0a1.83 1.83 0 0 1 3.66 0m-8.65 5.51a1.68 1.68 0 1 1-3.36 0a1.68 1.68 0 0 1 3.36 0m-.37 6.03a1.16 1.16 0 1 0 0-2.32a1.16 1.16 0 0 0 0 2.32m14.35-10.38a1.16 1.16 0 1 1-2.32 0a1.16 1.16 0 0 1 2.32 0" />
        <path d="M23.684 2.021A10.706 10.706 0 0 0 10.49 5.374l-5.24 7.14c-4.323 5.888-2.188 14.26 4.42 17.367c5.834 2.746 12.772.206 15.474-5.635a2294 2294 0 0 0 2.413-5.225l1.297-2.817c2.46-5.34.154-11.67-5.171-14.183m-11.58 4.536A8.706 8.706 0 0 1 22.83 3.83c4.335 2.046 6.209 7.196 4.209 11.537l-1.297 2.816v.002c-.65 1.41-.665 1.444-2.413 5.22c-2.237 4.839-7.98 6.938-12.806 4.666c-5.471-2.573-7.237-9.502-3.66-14.374z" />
      </svg>
      <span>Potato</span>
    </>
  );
}

export function TudouSettingsPane({ provider, onProviderChange, onRemove }: TudouSettingsPaneProps) {
  const { t } = useTranslation();

  return (
    <>
      <header className="settings-api-content-head">
        <div>
          <h2>{t("settings:tudouSettings")}</h2>
          <p>{t("settings:tudouDescription")}</p>
        </div>
        <div className="settings-api-content-actions">
          <ConfirmingDeleteButton
            label={t("settings:removeProvider")}
            confirmLabel={t("settings:confirmRemoveProvider")}
            cancelLabel={t("common:actions.cancel")}
            resetKey={provider.id}
            onDelete={onRemove}
          />
        </div>
      </header>

      <section className="settings-api-block">
        <div className="settings-api-block-head"><div><h3>{t("settings:tudouConnection")}</h3></div></div>
        <div className="settings-api-form">
          <label className="settings-field">
            <span>{t("settings:baseUrl")}</span>
            <Input value={provider.baseUrl} readOnly aria-readonly="true" />
          </label>
          <label className="settings-field">
            <span>{t("settings:apiKey")}</span>
            <Input type="password" value={provider.apiKey} onChange={(event) => onProviderChange({ apiKey: event.target.value })} placeholder={t("settings:apiKeyPlaceholder")} />
          </label>
        </div>
      </section>
    </>
  );
}
