import { useTranslation } from "react-i18next";
import { Select } from "../../../components/Select";
import type { CanvasNode } from "../types";

interface LoopNodeBodyProps {
  node: CanvasNode;
  onPatch: (patch: Partial<CanvasNode>) => void;
}

export function LoopNodeBody({ node, onPatch }: LoopNodeBodyProps) {
  const { t } = useTranslation();

  return (
    <div className="ic-node-body nowheel">
      <div className="ic-inline-fields nodrag nopan">
        <label>
          <span>{t("infiniteCanvas.count")}</span>
          <input className="nodrag nopan" type="number" min={1} max={99} value={node.count || 1} onChange={(event) => onPatch({ count: Number(event.target.value) || 1 })} />
        </label>
        <label>
          <span>{t("infiniteCanvas.mode")}</span>
          <Select
            className="nodrag nopan"
            value={node.mode || "serial"}
            options={[
              { value: "serial", label: t("infiniteCanvas.serial") },
              { value: "batch", label: t("infiniteCanvas.batch") },
            ]}
            onChange={(mode) => onPatch({ mode: mode as "serial" | "batch" })}
            ariaLabel={t("infiniteCanvas.mode")}
          />
        </label>
      </div>
      <textarea className="nodrag nopan nowheel" value={node.variablePrompt || ""} placeholder={t("infiniteCanvas.loopVariablePrompt")} onChange={(event) => onPatch({ variablePrompt: event.target.value })} />
      <textarea className="nodrag nopan nowheel" value={node.fixedPrompt || ""} placeholder={t("infiniteCanvas.fixedPrompt")} onChange={(event) => onPatch({ fixedPrompt: event.target.value })} />
    </div>
  );
}
