import { useTranslation } from "react-i18next";
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
          <select className="nodrag nopan" value={node.mode || "serial"} onChange={(event) => onPatch({ mode: event.target.value as "serial" | "batch" })}>
            <option value="serial">{t("infiniteCanvas.serial")}</option>
            <option value="batch">{t("infiniteCanvas.batch")}</option>
          </select>
        </label>
      </div>
      <textarea className="nodrag nopan nowheel" value={node.variablePrompt || ""} placeholder={t("infiniteCanvas.loopVariablePrompt")} onChange={(event) => onPatch({ variablePrompt: event.target.value })} />
      <textarea className="nodrag nopan nowheel" value={node.fixedPrompt || ""} placeholder={t("infiniteCanvas.fixedPrompt")} onChange={(event) => onPatch({ fixedPrompt: event.target.value })} />
    </div>
  );
}
