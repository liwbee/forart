import { MonitorX } from "lucide-react";
import { useTranslation } from "react-i18next";

interface UnsupportedRuntimePageProps {
  missingBridges: string[];
}

export function UnsupportedRuntimePage({ missingBridges }: UnsupportedRuntimePageProps) {
  const { t } = useTranslation();
  return (
    <main className="setup-shell">
      <section className="setup-panel setup-panel--unsupported" aria-label={t("app:unsupportedRuntimeTitle")}>
        <div className="unsupported-runtime__icon" aria-hidden="true">
          <MonitorX size={30} />
        </div>
        <div className="brand setup-brand" aria-label="Forart">
          <span className="brand-mark" aria-hidden="true" />
          <strong className="brand-name">Forart</strong>
        </div>
        <div className="unsupported-runtime__copy">
          <h1>{t("app:unsupportedRuntimeTitle")}</h1>
          <p>{t("app:unsupportedRuntimeDescription")}</p>
          <p>{t("app:unsupportedRuntimeDiagnostic")}</p>
        </div>
        {missingBridges.length ? (
          <div className="unsupported-runtime__detail">
            {t("app:unsupportedRuntimeMissing", { bridges: missingBridges.join(", ") })}
          </div>
        ) : null}
      </section>
    </main>
  );
}
