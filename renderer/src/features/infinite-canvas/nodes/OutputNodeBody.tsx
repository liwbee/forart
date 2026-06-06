import { useTranslation } from "react-i18next";
import type { CanvasNode } from "../types";

export function OutputNodeBody({ node }: { node: CanvasNode }) {
  const { t } = useTranslation();
  const generated = node.generated || [];
  return (
    <div className="ic-node-body ic-output-list">
      {generated.length ? (
        generated.map((item) => (
          <article className="ic-output-card" key={item.id}>
            <strong>{item.title}</strong>
            <p>{item.prompt}</p>
          </article>
        ))
      ) : (
        <div className="ic-empty">{t("infiniteCanvas.outputEmpty")}</div>
      )}
    </div>
  );
}
