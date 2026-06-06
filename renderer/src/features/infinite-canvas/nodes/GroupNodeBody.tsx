import { useTranslation } from "react-i18next";
import type { CanvasNode, CanvasNodeType } from "../types";

interface GroupNodeBodyProps {
  node: CanvasNode;
  items: CanvasNode[];
  getKindLabel: (type: CanvasNodeType) => string;
  onPatch: (patch: Partial<CanvasNode>) => void;
}

export function GroupNodeBody({ node, items, getKindLabel, onPatch }: GroupNodeBodyProps) {
  const { t } = useTranslation();

  return (
    <div className="ic-node-body nowheel">
      <input className="nodrag nopan" value={node.title} onChange={(event) => onPatch({ title: event.target.value })} />
      <div className="ic-group-list nowheel">
        {items.length ? items.map((item) => <span key={item.id}>{getKindLabel(item.type)} · {item.title}</span>) : <span>{t("infiniteCanvas.groupEmpty")}</span>}
      </div>
    </div>
  );
}
