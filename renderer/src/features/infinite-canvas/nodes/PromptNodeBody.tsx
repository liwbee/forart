import { useTranslation } from "react-i18next";
import type { CanvasNode } from "../types";

interface PromptNodeBodyProps {
  node: CanvasNode;
  onPatch: (patch: Partial<CanvasNode>) => void;
}

export function PromptNodeBody({ node, onPatch }: PromptNodeBodyProps) {
  const { t } = useTranslation();

  return (
    <div className="ic-node-body nowheel">
      <textarea className="nodrag nopan nowheel" value={node.text || ""} placeholder={t("infiniteCanvas.promptPlaceholder")} onChange={(event) => onPatch({ text: event.target.value })} />
    </div>
  );
}
