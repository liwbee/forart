import { useTranslation } from "react-i18next";
import { FreeCanvasEditor } from "./FreeCanvasEditor";

export function FreeCanvasPage() {
  const { t } = useTranslation();

  return (
    <section className="library-page free-canvas-page" aria-label={t("freeCanvas:title")}>
      <FreeCanvasEditor />
    </section>
  );
}
